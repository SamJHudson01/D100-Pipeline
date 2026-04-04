#!/usr/bin/env python3
"""Multi-source funding detection for a single company.

Checks pool source data, SEC EDGAR Form D filings, and website content
for evidence of venture funding. Outputs a JSON funding report to stdout.
"""

import argparse
import json
import os
import re
import sys
from datetime import datetime, timezone

import requests

try:
    from dotenv import load_dotenv

    env_path = os.path.join(os.path.dirname(__file__), os.pardir, ".env")
    load_dotenv(dotenv_path=env_path)
except ImportError:
    pass

from pool_db import get_db, normalize_domain

EDGAR_SEARCH_URL = "https://efts.sec.gov/LATEST/search-index"
EDGAR_HEADERS = {
    "User-Agent": "TestKarma Prospect Qualifier sam@testkarma.com",
    "Accept": "application/json",
}

KNOWN_INVESTORS = [
    "Y Combinator", "YC", "Sequoia", "a16z", "Andreessen", "Benchmark",
    "Accel", "First Round", "Bessemer", "Point Nine", "Precursor", "Floodgate",
    "Greylock", "Lightspeed", "Founders Fund", "Kleiner", "Index Ventures",
    "GV", "NEA", "Khosla", "SV Angel", "Initialized", "Tiger Global",
]

# Stage keywords mapped to funding stages
STAGE_PATTERNS = [
    (r"\bpre[- ]?seed\b", "Pre-Seed"),
    (r"\bseed\b", "Seed"),
    (r"\bseries\s*a\b", "Series A"),
    (r"\bseries\s*b\b", "Series B"),
    (r"\bseries\s*c\b", "Series C"),
    (r"\bseries\s*d\b", "Series D"),
    (r"\bangel\b", "Angel"),
]

eprint = lambda *a, **kw: print(*a, file=sys.stderr, **kw)


# ---------------------------------------------------------------------------
# Source 1: Pool source data
# ---------------------------------------------------------------------------

def check_pool_data(company_name):
    """Check if pool source_data contains funding-related info."""
    result = {
        "has_data": False,
        "funding_stage": None,
        "funding_amount": None,
        "evidence": None,
    }

    try:
        conn = get_db()
    except Exception as exc:
        eprint(f"Pool DB unavailable: {exc}")
        return result

    try:
        import psycopg2.extras
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        # Search by name (case-insensitive partial match)
        cur.execute(
            "SELECT * FROM companies WHERE LOWER(name) LIKE %s",
            (f"%{company_name.lower()}%",),
        )
        rows = cur.fetchall()

        if not rows:
            return result

        for row in rows:
            raw_sd = row["source_data"] or {}
            if isinstance(raw_sd, str):
                try:
                    source_data = json.loads(raw_sd)
                except json.JSONDecodeError:
                    continue
            else:
                source_data = raw_sd

            # YC companies: batch and stage fields
            yc_data = source_data.get("yc", {})
            if yc_data and isinstance(yc_data, dict):
                batch = yc_data.get("batch")
                stage = yc_data.get("stage")
                if batch or stage:
                    result["has_data"] = True
                    result["funding_stage"] = stage or "Seed"
                    result["evidence"] = f"YC batch {batch}" + (f", stage: {stage}" if stage else "")
                    return result

            # SBIR companies: award_amount
            sbir_data = source_data.get("sbir", {})
            if sbir_data and isinstance(sbir_data, dict):
                amount = sbir_data.get("award_amount")
                if amount:
                    result["has_data"] = True
                    result["funding_amount"] = amount
                    result["funding_stage"] = "Grant"
                    result["evidence"] = f"SBIR award: ${amount:,}" if isinstance(amount, (int, float)) else f"SBIR award: {amount}"
                    return result

    except Exception as exc:
        eprint(f"Pool data check error: {exc}")
    finally:
        conn.close()

    return result


# ---------------------------------------------------------------------------
# Source 2: SEC EDGAR per-company lookup
# ---------------------------------------------------------------------------

def name_matches(our_name, edgar_name):
    """Check if all significant words in our company name appear in the EDGAR name.

    Basic string matching: split our name into words, check if each word
    appears in the EDGAR display name (case-insensitive). Skip very short
    words (<=2 chars) like 'AI', 'Co' unless the name is short.
    """
    our_words = our_name.lower().split()
    edgar_lower = edgar_name.lower()

    # For very short names (1-2 words), require all words
    # For longer names, require at least 2/3 of meaningful words
    meaningful = [w for w in our_words if len(w) > 2]
    if not meaningful:
        meaningful = our_words

    if not meaningful:
        return False

    matched = sum(1 for w in meaningful if w in edgar_lower)
    threshold = max(1, len(meaningful) * 2 // 3)
    return matched >= threshold


def check_sec_edgar(company_name):
    """Query SEC EDGAR EFTS for Form D filings matching the company name."""
    result = {
        "has_data": False,
        "filing_date": None,
        "offering_amount": None,
        "edgar_name": None,
        "evidence": None,
    }

    try:
        params = {
            "q": f'"{company_name}"',
            "forms": "D",
        }
        resp = requests.get(
            EDGAR_SEARCH_URL, params=params, headers=EDGAR_HEADERS, timeout=30
        )
        resp.raise_for_status()
        data = resp.json()
    except requests.RequestException as exc:
        eprint(f"EDGAR query failed: {exc}")
        return result

    hits = data.get("hits", {})
    if isinstance(hits, dict):
        hits = hits.get("hits", [])
    elif not isinstance(hits, list):
        hits = []

    for hit in hits:
        source = hit.get("_source", hit)
        names = source.get("display_names", [])
        edgar_name = names[0] if names else source.get("entity_name", "")

        if not edgar_name:
            continue

        if not name_matches(company_name, edgar_name):
            continue

        # Found a match
        filing_date = (
            source.get("file_date")
            or source.get("filing_date")
            or source.get("date_filed")
        )

        result["has_data"] = True
        result["edgar_name"] = edgar_name
        result["filing_date"] = filing_date

        evidence_parts = [f"SEC EDGAR Form D filing by '{edgar_name}'"]
        if filing_date:
            evidence_parts.append(f"filed {filing_date}")

        result["evidence"] = ", ".join(evidence_parts)
        return result

    return result


# ---------------------------------------------------------------------------
# Source 3: Website content parsing
# ---------------------------------------------------------------------------

def parse_dollar_amount(text):
    """Extract a dollar amount from text like '$3M', '$3 million', '$500K'.

    Returns the amount as an integer, or None.
    """
    # Match patterns like $3M, $3.5M, $500K, $3 million, $500,000
    patterns = [
        (r"\$(\d+(?:\.\d+)?)\s*[Mm](?:illion|M\b|m\b)", lambda m: int(float(m.group(1)) * 1_000_000)),
        (r"\$(\d+(?:\.\d+)?)\s*[Bb](?:illion|B\b|b\b)", lambda m: int(float(m.group(1)) * 1_000_000_000)),
        (r"\$(\d+(?:\.\d+)?)\s*[Kk]", lambda m: int(float(m.group(1)) * 1_000)),
        (r"\$(\d{1,3}(?:,\d{3})+)", lambda m: int(m.group(1).replace(",", ""))),
        (r"\$(\d+(?:\.\d+)?)\s*million", lambda m: int(float(m.group(1)) * 1_000_000)),
    ]

    for pattern, converter in patterns:
        match = re.search(pattern, text, re.IGNORECASE)
        if match:
            try:
                return converter(match)
            except (ValueError, TypeError):
                pass
    return None


def check_website_content(page_content):
    """Scan website content for funding indicators."""
    result = {
        "has_data": False,
        "funding_stage": None,
        "funding_amount": None,
        "funding_date": None,
        "investors": [],
        "evidence": None,
    }

    if not page_content:
        return result

    text = page_content
    text_lower = text.lower()

    evidence_snippets = []
    found_investors = []

    # Check for known investor names
    for investor in KNOWN_INVESTORS:
        if investor.lower() in text_lower:
            found_investors.append(investor)

    # Check for funding phrases
    funding_phrases = [
        r"backed\s+by\b",
        r"funded\s+by\b",
        r"invested\s+(?:in\s+)?by\b",
        r"raised\s+\$[\d.,]+\s*[MmBbKk]",
        r"\$[\d.,]+\s*[MmKk]?\s*(?:seed|series|funding|round|investment)",
        r"(?:seed|series\s*[a-d]|angel|pre-seed)\s+(?:round|funding|investment)",
        r"portfolio\s+(?:company|companies)",
    ]

    for phrase_pattern in funding_phrases:
        matches = list(re.finditer(phrase_pattern, text, re.IGNORECASE))
        for match in matches:
            # Extract context around the match (up to 200 chars)
            start = max(0, match.start() - 50)
            end = min(len(text), match.end() + 150)
            snippet = text[start:end].strip()
            # Clean up whitespace
            snippet = re.sub(r"\s+", " ", snippet)
            if snippet and snippet not in evidence_snippets:
                evidence_snippets.append(snippet)

    # Detect funding stage from content
    detected_stage = None
    for pattern, stage in STAGE_PATTERNS:
        if re.search(pattern, text, re.IGNORECASE):
            detected_stage = stage
            break

    # Detect dollar amounts near funding keywords
    funding_amount = None
    amount_patterns = [
        r"raised\s+(\$[\d.,]+\s*[MmBbKk](?:illion)?)",
        r"(\$[\d.,]+\s*[MmBbKk](?:illion)?)\s+(?:seed|series|funding|round|investment)",
        r"(\$[\d.,]+\s*[MmBbKk](?:illion)?)\s+(?:in\s+)?(?:total\s+)?funding",
    ]

    for pattern in amount_patterns:
        match = re.search(pattern, text, re.IGNORECASE)
        if match:
            amount_text = match.group(1)
            funding_amount = parse_dollar_amount(amount_text)
            if funding_amount:
                break

    # If no amount found from patterns, try general dollar amount detection
    # only if we have other funding signals
    if not funding_amount and (found_investors or detected_stage or evidence_snippets):
        funding_amount = parse_dollar_amount(text)

    # Determine if we actually found funding evidence
    has_funding = bool(found_investors) or bool(evidence_snippets) or detected_stage is not None

    if has_funding:
        result["has_data"] = True
        result["funding_stage"] = detected_stage
        result["funding_amount"] = funding_amount
        result["investors"] = found_investors

        # Build evidence string
        evidence_parts = []
        if evidence_snippets:
            evidence_parts.append(evidence_snippets[0])
        elif found_investors:
            evidence_parts.append(f"Mentions investors: {', '.join(found_investors[:5])}")

        result["evidence"] = "; ".join(evidence_parts[:3]) if evidence_parts else None

    return result


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def determine_confidence(sources_with_data):
    """Determine confidence level based on number and type of corroborating sources."""
    count = len(sources_with_data)
    if count == 0:
        return "UNKNOWN"
    if count >= 2:
        return "HIGH"
    if "sec_edgar" in sources_with_data:
        return "HIGH"
    return "MEDIUM"


def main():
    parser = argparse.ArgumentParser(
        description="Multi-source funding detection for a single company."
    )
    parser.add_argument(
        "--company-name",
        required=True,
        help="Company name to look up",
    )
    parser.add_argument(
        "--url",
        default=None,
        help="Company website URL (optional)",
    )
    parser.add_argument(
        "--page-content",
        action="store_true",
        default=False,
        help="Read page content from stdin",
    )
    args = parser.parse_args()

    company_name = args.company_name.strip()
    sources_checked = []
    sources_with_data = []

    # Aggregated results
    funding_stage = None
    funding_amount = None
    funding_date = None
    investors = []
    evidence_parts = []

    # --- Source 1: Pool data ---
    sources_checked.append("pool_data")
    eprint(f"Checking pool data for '{company_name}'...")
    pool_result = check_pool_data(company_name)
    if pool_result["has_data"]:
        sources_with_data.append("pool_data")
        funding_stage = funding_stage or pool_result.get("funding_stage")
        funding_amount = funding_amount or pool_result.get("funding_amount")
        if pool_result.get("evidence"):
            evidence_parts.append(f"Pool: {pool_result['evidence']}")
        eprint(f"  Pool data: found — {pool_result.get('evidence', 'no details')}")
    else:
        eprint("  Pool data: no funding info found")

    # --- Source 2: SEC EDGAR ---
    sources_checked.append("sec_edgar")
    eprint(f"Checking SEC EDGAR for '{company_name}'...")
    edgar_result = check_sec_edgar(company_name)
    if edgar_result["has_data"]:
        sources_with_data.append("sec_edgar")
        funding_date = funding_date or edgar_result.get("filing_date")
        if edgar_result.get("offering_amount"):
            funding_amount = funding_amount or edgar_result["offering_amount"]
        if edgar_result.get("evidence"):
            evidence_parts.append(f"EDGAR: {edgar_result['evidence']}")
        eprint(f"  EDGAR: found — {edgar_result.get('evidence', 'no details')}")
    else:
        eprint("  EDGAR: no matching Form D filings")

    # --- Source 3: Website content ---
    sources_checked.append("website_content")
    page_content = None
    if args.page_content:
        try:
            page_content = sys.stdin.read()
        except Exception as exc:
            eprint(f"  Could not read stdin: {exc}")

    if page_content:
        eprint(f"Checking website content ({len(page_content)} chars)...")
        web_result = check_website_content(page_content)
        if web_result["has_data"]:
            sources_with_data.append("website_content")
            funding_stage = funding_stage or web_result.get("funding_stage")
            funding_amount = funding_amount or web_result.get("funding_amount")
            investors.extend(web_result.get("investors", []))
            if web_result.get("evidence"):
                evidence_parts.append(f"Website: {web_result['evidence']}")
            eprint(f"  Website: found funding signals")
        else:
            eprint("  Website: no funding signals found")
    else:
        eprint("  Website content: not provided (use --page-content to read from stdin)")

    # --- Build output ---
    funding_detected = len(sources_with_data) > 0
    confidence = determine_confidence(sources_with_data)

    # Deduplicate investors
    seen_inv = set()
    unique_investors = []
    for inv in investors:
        inv_key = inv.lower()
        if inv_key not in seen_inv:
            seen_inv.add(inv_key)
            unique_investors.append(inv)

    output = {
        "funding_detected": funding_detected,
        "funding_stage": funding_stage if funding_detected else None,
        "funding_amount": funding_amount if funding_detected else None,
        "funding_date": funding_date if funding_detected else None,
        "investors": unique_investors if funding_detected else [],
        "evidence": "; ".join(evidence_parts) if evidence_parts else None,
        "confidence": confidence,
        "sources_checked": sources_checked,
        "sources_with_data": sources_with_data,
        "checked_at": datetime.now(timezone.utc).isoformat(),
    }

    json.dump(output, sys.stdout, indent=2, ensure_ascii=False)
    print()  # trailing newline

    eprint(
        f"Funding check complete: detected={funding_detected}, "
        f"confidence={confidence}, sources={len(sources_with_data)}/{len(sources_checked)}"
    )


if __name__ == "__main__":
    main()
