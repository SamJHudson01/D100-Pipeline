#!/usr/bin/env python3
"""Scrape accelerator portfolio/directory pages to find startup companies for the prospect pool.

Uses Firecrawl to scrape portfolio pages and extracts company entries from the
returned markdown.  Results are upserted directly into the SQLite pool database.
"""

import argparse
import os
import re
import sys
from datetime import datetime, timezone
from urllib.parse import urlparse

import requests

try:
    from dotenv import load_dotenv

    env_path = os.path.join(os.path.dirname(__file__), os.pardir, ".env")
    load_dotenv(dotenv_path=env_path)
except ImportError:
    pass

from pool_db import get_db, upsert_company, normalize_domain, make_key

FIRECRAWL_SCRAPE_URL = "https://api.firecrawl.dev/v1/scrape"

DIRECTORIES = [
    {
        "name": "entrepreneur_first",
        "label": "Entrepreneur First",
        "urls": ["https://www.joinef.com/companies/"],
        "enabled": True,
    },
    {
        "name": "seedcamp",
        "label": "Seedcamp",
        "urls": ["https://seedcamp.com/portfolio/"],
        "enabled": True,
    },
    {
        "name": "alchemist",
        "label": "Alchemist Accelerator",
        "urls": ["https://www.alchemistaccelerator.com/portfolio"],
        "enabled": True,
    },
    {
        "name": "techstars",
        "label": "Techstars",
        "urls": ["https://www.techstars.com/portfolio"],
        "enabled": True,
    },
    {
        "name": "antler",
        "label": "Antler",
        "urls": ["https://www.antler.co/portfolio"],
        "enabled": True,
    },
    {
        "name": "startupbootcamp",
        "label": "Startupbootcamp",
        "urls": ["https://www.startupbootcamp.org/portfolio/"],
        "enabled": True,
    },
    {
        "name": "founders_factory",
        "label": "Founders Factory",
        "urls": ["https://foundersfactory.com/portfolio"],
        "enabled": True,
    },
]



# ---------------------------------------------------------------------------
# Scraping
# ---------------------------------------------------------------------------

def scrape_url(url, api_key):
    """Scrape a URL via Firecrawl and return markdown text."""
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    payload = {"url": url, "formats": ["markdown"]}

    resp = requests.post(FIRECRAWL_SCRAPE_URL, json=payload, headers=headers, timeout=60)
    resp.raise_for_status()
    data = resp.json()

    if not data.get("success"):
        raise RuntimeError(f"Firecrawl scrape failed for {url}: {data}")

    return data.get("data", {}).get("markdown", "")


# ---------------------------------------------------------------------------
# Parsing
# ---------------------------------------------------------------------------

def _get_accelerator_domain(directory):
    """Extract the accelerator's own domain from the first URL in its config."""
    parsed = urlparse(directory["urls"][0])
    domain = (parsed.hostname or "").lower()
    if domain.startswith("www."):
        domain = domain[4:]
    return domain


def _extract_description(lines, start_idx):
    """Try to grab a short description from lines near a company entry."""
    desc_parts = []
    for offset in range(1, 8):
        idx = start_idx + offset
        if idx >= len(lines):
            break
        line = lines[idx].strip()
        # Stop at new headers or new link blocks (next company)
        if line.startswith("#") or re.match(r'^\[.+\]\(http', line):
            break
        # Skip empty lines, images, and standalone numbers
        if not line or re.match(r'^!\[', line) or re.match(r'^\d+$', line):
            continue
        # Skip cookie/navigation boilerplate
        if any(w in line.lower() for w in ("cookie", "consent", "privacy", "accept all")):
            continue
        desc_parts.append(line)
        if len(" ".join(desc_parts)) > 200:
            break
    return " ".join(desc_parts).strip()[:500] if desc_parts else ""


SKIP_NAMES = {
    "website", "visit", "more", "view", "learn more", "read more",
    "see all", "back", "home", "about", "contact", "apply", "sign up",
    "login", "log in", "menu", "filter", "featured", "portfolio",
    "companies", "our portfolio", "all companies", "search", "cookie",
    "accept", "reject", "customize", "necessary", "functional",
    "analytics", "performance", "advertisement", "close",
}

SKIP_DOMAINS = {
    "twitter.com", "x.com", "linkedin.com", "facebook.com",
    "instagram.com", "youtube.com", "github.com", "medium.com",
    "crunchbase.com", "angel.co", "wellfound.com",
    "apps.apple.com", "play.google.com", "cookieyes.com",
    "googleapis.com", "gstatic.com", "cloudflare.com",
    "calendly.com", "hubspot.com",
}


def parse_portfolio_markdown(md_text, directory):
    """Parse markdown from a portfolio page and extract company entries.

    Uses multiple extraction strategies:
      1. Markdown links [Name](url) pointing to external domains
      2. Markdown headers (### Name) followed by description text
    Companies without a URL are still included — URL can be found during enrichment.
    """
    accel_domain = _get_accelerator_domain(directory)
    companies = []
    seen_keys = set()
    lines = md_text.split("\n")

    link_pattern = re.compile(r'\[([^\]]+)\]\((https?://[^\)]+)\)')
    header_pattern = re.compile(r'^#{1,4}\s+(.+)$')

    for i, line in enumerate(lines):
        # --- Strategy 1: Markdown links [Name](url) ---
        for match in link_pattern.finditer(line):
            name = match.group(1).strip()
            url = match.group(2).strip()

            if not name or len(name) < 2:
                continue
            if name.lower() in SKIP_NAMES:
                continue

            parsed = urlparse(url)
            link_domain = (parsed.hostname or "").lower().removeprefix("www.")

            if link_domain and accel_domain and link_domain == accel_domain:
                continue
            if any(link_domain.endswith(sd) for sd in SKIP_DOMAINS):
                continue
            if url.startswith("#") or url.startswith("javascript:"):
                continue

            key = make_key(name, url)
            if not key or key in seen_keys:
                continue
            seen_keys.add(key)

            description = _extract_description(lines, i)
            companies.append({"name": name, "url": url, "domain": key, "description": description})

        # --- Strategy 2: Markdown headers ### Company Name ---
        hm = header_pattern.match(line.strip())
        if hm:
            name = hm.group(1).strip()
            # Strip markdown formatting
            name = re.sub(r'\*+', '', name).strip()
            name = re.sub(r'\[([^\]]+)\]\([^\)]*\)', r'\1', name).strip()

            if not name or len(name) < 2 or len(name) > 60:
                continue
            if name.lower() in SKIP_NAMES:
                continue
            # Skip if it looks like a section title (all lowercase common words)
            if name.lower() in ("featured", "our companies", "our portfolio", "all",
                                "filter by", "sort by", "search results"):
                continue

            key = make_key(name)
            if not key or key in seen_keys:
                continue

            description = _extract_description(lines, i)
            # Skip if description is empty or too short (likely a section header, not a company)
            if len(description) < 10:
                continue

            seen_keys.add(key)

            # Check if nearby lines have an external URL
            url = None
            for offset in range(1, 6):
                if i + offset >= len(lines):
                    break
                nearby = lines[i + offset].strip()
                link_match = link_pattern.search(nearby)
                if link_match:
                    candidate_url = link_match.group(2)
                    cd = (urlparse(candidate_url).hostname or "").lower().removeprefix("www.")
                    if cd and cd != accel_domain and not any(cd.endswith(sd) for sd in SKIP_DOMAINS):
                        url = candidate_url
                        key = make_key(name, url)  # upgrade key to domain-based
                        break

            companies.append({"name": name, "url": url, "domain": key, "description": description})

    return companies


# ---------------------------------------------------------------------------
# Directory processing
# ---------------------------------------------------------------------------

def process_directory(directory, api_key, conn):
    """Scrape and process a single accelerator directory. Returns count of companies added."""
    label = directory["label"]
    dir_name = directory["name"]
    source = f"accelerator_{dir_name}"

    total_extracted = 0
    total_added = 0

    for url in directory["urls"]:
        try:
            md_text = scrape_url(url, api_key)
        except Exception as exc:
            print(f"  Error scraping {url}: {exc}", file=sys.stderr)
            continue

        if not md_text:
            print(f"  No markdown returned for {url}", file=sys.stderr)
            continue

        companies = parse_portfolio_markdown(md_text, directory)
        total_extracted += len(companies)

        for company in companies:
            key = company["domain"]
            if not key:
                continue
            try:
                upsert_company(
                    conn,
                    domain=key,
                    name=company["name"],
                    url=company.get("url"),
                    description=company["description"],
                    source=source,
                    source_data={
                        "accelerator": dir_name,
                        "accelerator_label": label,
                        "discovered_at": datetime.now(timezone.utc).isoformat(),
                    },
                )
                total_added += 1
            except Exception as exc:
                print(f"  Error upserting {key}: {exc}", file=sys.stderr)

    conn.commit()
    return total_extracted, total_added


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(
        description="Scrape accelerator portfolio pages for startup prospecting."
    )
    parser.add_argument(
        "--directory",
        type=str,
        default=None,
        help="Run only a single directory by name (e.g. seedcamp)",
    )
    parser.add_argument(
        "--list",
        action="store_true",
        dest="list_dirs",
        help="List all configured directories and exit",
    )
    args = parser.parse_args()

    # --list: show directories and exit
    if args.list_dirs:
        for d in DIRECTORIES:
            status = "enabled" if d["enabled"] else "disabled"
            print(f"  {d['name']:25s} {d['label']:30s} [{status}]", file=sys.stderr)
        sys.exit(0)

    api_key = os.environ.get("FIRECRAWL_API_KEY", "").strip() or None
    if not api_key:
        print("FIRECRAWL_API_KEY not set -- cannot scrape accelerator pages.", file=sys.stderr)
        sys.exit(1)

    # Determine which directories to process
    if args.directory:
        dirs = [d for d in DIRECTORIES if d["name"] == args.directory]
        if not dirs:
            print(f"Unknown directory: {args.directory}", file=sys.stderr)
            print("Available directories:", file=sys.stderr)
            for d in DIRECTORIES:
                print(f"  {d['name']}", file=sys.stderr)
            sys.exit(1)
    else:
        dirs = [d for d in DIRECTORIES if d["enabled"]]

    conn = get_db()
    grand_extracted = 0
    grand_added = 0

    for directory in dirs:
        print(f"Processing {directory['label']}...", file=sys.stderr)
        try:
            extracted, added = process_directory(directory, api_key, conn)
        except Exception as exc:
            print(f"  FAILED: {exc}", file=sys.stderr)
            continue
        grand_extracted += extracted
        grand_added += added
        print(
            f"  {directory['label']}: {extracted} companies extracted, {added} added to pool",
            file=sys.stderr,
        )

    conn.close()

    print(
        f"\nTotal: {grand_extracted} companies extracted, {grand_added} added to pool",
        file=sys.stderr,
    )


if __name__ == "__main__":
    main()
