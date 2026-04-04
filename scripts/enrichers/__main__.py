"""Entry point for enrichment pipeline.

Usage:
    python -m enrichers --domain elyos.ai --name "Elyos AI" --url "https://elyos.ai"
    python -m enrichers --domain elyos.ai --name "Elyos AI" --url "https://elyos.ai" --research /tmp/research_elyos.ai.json

When --research is provided, the LLM's web research JSON is merged into the
enrichment result, providing founder names, team size, funding, etc. that
the automated pipeline can't reliably find on its own.
"""

import argparse
import json
import sys
import os

# Ensure scripts/ is importable
SCRIPT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, SCRIPT_DIR)

# Load env
try:
    from dotenv import load_dotenv
    load_dotenv(os.path.join(SCRIPT_DIR, os.pardir, ".env"))
except ImportError:
    pass

# Import all enrichers to register them
from enrichers import dns_headers, web_search, structured_lookups, website_scrape, homepage_analysis
from enrichers import tool_detection, email_finder, linkedin_finder, location
from enrichers.orchestrator import enrich_company
from enrichers.db_writer import write_enrichment


def main():
    parser = argparse.ArgumentParser(description="Enrich a single company")
    parser.add_argument("--domain", required=True, help="Company domain")
    parser.add_argument("--name", required=True, help="Company name")
    parser.add_argument("--url", required=True, help="Company website URL")
    parser.add_argument("--description", default="", help="Company description")
    parser.add_argument("--research", default=None, help="Path to LLM research JSON from web search")
    parser.add_argument("--dry-run", action="store_true", help="Skip DB write")
    args = parser.parse_args()

    # Run automated enrichment
    result = enrich_company(args.domain, args.name, args.url, args.description)

    # Merge LLM research if provided (this overrides automated results where both exist)
    if args.research and os.path.exists(args.research):
        with open(args.research) as f:
            research = json.load(f)
        _merge_research(result, research)

    # Write to database
    if not args.dry_run:
        write_enrichment(args.domain, result)

    # Output result
    print(json.dumps(result, indent=2, default=str))


def _merge_research(result: dict, research: dict) -> None:
    """Merge LLM web research into the enrichment result.

    Research JSON shape (all fields optional):
    {
        "founders": [{"name": "...", "title": "...", "linkedinUrl": "..."}],
        "teamSize": 20,
        "teamSizeSource": "Crunchbase",
        "fundingStage": "Series A",
        "fundingAmount": "$13M",
        "fundingDate": "2026-01-15",
        "fundingSource": "TechCrunch article",
        "foundedYear": 2023,
        "hqLocation": "London, UK",
        "recentNews": [{"title": "...", "source": "...", "date": "..."}],
        "growthHireStatus": "hiring" | "has_team" | "none"
    }
    """
    # Merge into webSearch section
    ws = result.get("webSearch", {})
    if not ws:
        ws = {"status": "success"}

    if research.get("teamSize"):
        ws["employeeCount"] = research["teamSize"]
        ws["employeeCountSource"] = research.get("teamSizeSource", "web_research")

    if research.get("fundingStage"):
        ws["fundingStage"] = research["fundingStage"]
    if research.get("fundingAmount"):
        ws["fundingAmount"] = research["fundingAmount"]
    if research.get("fundingDate"):
        ws["fundingDate"] = research["fundingDate"]
    if research.get("fundingSource"):
        ws["fundingSource"] = research["fundingSource"]

    if research.get("foundedYear"):
        ws["foundedYear"] = research["foundedYear"]
    if research.get("hqLocation"):
        ws["hqLocation"] = research["hqLocation"]

    if research.get("recentNews"):
        # Research news replaces automated RSS — it's curated and has URLs
        ws["latestNews"] = research["recentNews"][:5]

    ws["status"] = "success"
    ws["searchResultsFound"] = True
    result["webSearch"] = ws

    # Merge founders into keyPeople
    if research.get("founders"):
        existing_people = result.get("keyPeople", [])
        existing_names = {p["name"].lower() for p in existing_people}
        for founder in research["founders"]:
            if founder["name"].lower() not in existing_names:
                person = {
                    "name": founder["name"],
                    "source": "web_research",
                    "role": founder.get("role", "founder"),
                }
                if founder.get("title"):
                    person["title"] = founder["title"]
                if founder.get("linkedinUrl"):
                    person["linkedinUrl"] = founder["linkedinUrl"]
                if founder.get("twitterHandle"):
                    person["twitterHandle"] = founder["twitterHandle"]
                existing_people.append(person)
                existing_names.add(founder["name"].lower())
        result["keyPeople"] = existing_people


if __name__ == "__main__":
    main()
