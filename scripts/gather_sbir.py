#!/usr/bin/env python3
"""Download and parse SBIR.gov award data for software-related NSF Phase I awards.

Queries the SBIR public API for recent NSF Phase I awards matching software-related
keywords, then upserts qualifying companies into the SQLite prospect pool.
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

import psycopg2.extras

from pool_db import get_db, normalize_domain, upsert_company

SBIR_API_URL = "https://api.www.sbir.gov/public/api/awards"

DEFAULT_KEYWORDS = [
    "software",
    "SaaS",
    "platform",
    "cloud",
    "machine learning",
    "artificial intelligence",
    "app",
    "dashboard",
    "analytics",
]

HEADERS = {
    "User-Agent": "TestKarma Prospect Qualifier sam@testkarma.com",
    "Accept": "application/json",
}


def fetch_awards(keyword, years=2):
    """Fetch SBIR awards from the public API for a single keyword.

    Returns a list of award dicts from the API response.
    """
    params = {
        "keyword": keyword,
        "agency": "NSF",
        "rows": 500,
    }

    import time
    time.sleep(2)  # Rate limit: space requests to avoid 429s

    try:
        resp = requests.get(SBIR_API_URL, params=params, headers=HEADERS, timeout=60)
        resp.raise_for_status()
    except requests.RequestException as exc:
        print(f"  SBIR API error for '{keyword}': {exc}", file=sys.stderr)
        return []

    # The API may return a JSON array or an object with a results key
    data = resp.json()
    if isinstance(data, list):
        awards = data
    elif isinstance(data, dict):
        awards = data.get("results", data.get("awards", data.get("data", [])))
        if not isinstance(awards, list):
            awards = []
    else:
        awards = []

    return awards


def is_recent(award, years=2):
    """Check if an award was granted within the last N years."""
    ref_date = datetime(2026, 3, 18, tzinfo=timezone.utc)
    cutoff = ref_date.replace(year=ref_date.year - years)

    # Try multiple date field names
    date_str = (
        award.get("awardDate")
        or award.get("award_date")
        or award.get("date")
        or award.get("Award Year", "")
    )

    if not date_str:
        return False

    # Handle year-only values
    date_str = str(date_str).strip()
    if re.match(r"^\d{4}$", date_str):
        try:
            year = int(date_str)
            return year >= cutoff.year
        except ValueError:
            return False

    # Try common date formats
    for fmt in ("%Y-%m-%d", "%m/%d/%Y", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%dT%H:%M:%SZ"):
        try:
            dt = datetime.strptime(date_str, fmt).replace(tzinfo=timezone.utc)
            return dt >= cutoff
        except ValueError:
            continue

    return False


def is_phase_one(award):
    """Check if this is a Phase I award."""
    phase = str(award.get("phase", award.get("Phase", ""))).strip()
    return phase in ("1", "I", "Phase I", "Phase 1", "PHASE I", "PHASE 1")


def matches_software_keywords(award, extra_keywords=None):
    """Check if the award abstract or title contains software-related keywords."""
    keywords = list(DEFAULT_KEYWORDS)
    if extra_keywords:
        keywords.extend(extra_keywords)

    title = str(award.get("awardTitle", award.get("award_title", award.get("title", "")))).lower()
    abstract = str(award.get("abstract", award.get("Abstract", ""))).lower()
    text = title + " " + abstract

    for kw in keywords:
        if kw.lower() in text:
            return True
    return False


def extract_company_url(award):
    """Try to find a company website URL from the award data."""
    for field in ("companyUrl", "company_url", "url", "website", "Company URL"):
        val = award.get(field)
        if val and isinstance(val, str) and "." in val:
            url = val.strip()
            if not url.startswith(("http://", "https://")):
                url = "https://" + url
            return url

    # Check if company name field contains a URL
    company = str(award.get("company", award.get("Company", award.get("firm", "")))).strip()
    url_match = re.search(r'(https?://[^\s]+|www\.[^\s]+)', company)
    if url_match:
        url = url_match.group(1)
        if not url.startswith("http"):
            url = "https://" + url
        return url

    return None



def extract_amount(award):
    """Extract award amount as an integer."""
    for field in ("awardAmount", "award_amount", "amount", "Award Amount"):
        val = award.get(field)
        if val is not None:
            try:
                return int(float(str(val).replace(",", "").replace("$", "")))
            except (ValueError, TypeError):
                pass
    return None


def extract_date(award):
    """Extract award date as a string."""
    for field in ("awardDate", "award_date", "date", "Award Year"):
        val = award.get(field)
        if val:
            return str(val).strip()
    return None


def main():
    parser = argparse.ArgumentParser(
        description="Fetch SBIR NSF Phase I awards and add software startups to the prospect pool."
    )
    parser.add_argument(
        "--keyword",
        action="append",
        default=[],
        help="Additional keyword(s) to search for (can be repeated)",
    )
    parser.add_argument(
        "--years",
        type=int,
        default=2,
        help="Only include awards from the last N years (default: 2)",
    )
    args = parser.parse_args()

    extra_keywords = args.keyword if args.keyword else None

    # Query the API for each default keyword and deduplicate
    seen_companies = set()
    all_awards = []

    for kw in DEFAULT_KEYWORDS + (extra_keywords or []):
        awards = fetch_awards(kw, years=args.years)
        print(f"  SBIR '{kw}': {len(awards)} raw results", file=sys.stderr)

        for award in awards:
            # Build a dedup key from company name + award title
            company = str(
                award.get("company", award.get("Company", award.get("firm", "")))
            ).strip()
            title = str(
                award.get("awardTitle", award.get("award_title", award.get("title", "")))
            ).strip()
            dedup_key = (company.lower(), title.lower())

            if dedup_key in seen_companies:
                continue
            seen_companies.add(dedup_key)

            # Filter: Phase I, recent, software-related
            if not is_phase_one(award):
                continue
            if not is_recent(award, years=args.years):
                continue
            if not matches_software_keywords(award, extra_keywords):
                continue

            all_awards.append(award)

    print(f"SBIR: {len(all_awards)} awards passed filters", file=sys.stderr)

    # Upsert into pool database
    conn = get_db()
    added = 0
    updated = 0
    skipped = 0

    try:
        for award in all_awards:
            company_name = str(
                award.get("company", award.get("Company", award.get("firm", "")))
            ).strip()

            if not company_name:
                skipped += 1
                continue

            url = extract_company_url(award)
            domain = normalize_domain(url) if url else None

            if not domain:
                # Generate a synthetic domain from company name for dedup purposes
                slug = re.sub(r"[^a-z0-9]+", "-", company_name.lower()).strip("-")
                domain = f"{slug}.sbir-unknown.gov"

            title = str(
                award.get("awardTitle", award.get("award_title", award.get("title", "")))
            ).strip()
            abstract = str(award.get("abstract", award.get("Abstract", ""))).strip()
            description = title
            if abstract:
                description = f"{title} -- {abstract[:500]}"

            city = award.get("city", award.get("City", ""))
            state = award.get("state", award.get("State", award.get("stateCode", "")))
            amount = extract_amount(award)
            award_date = extract_date(award)

            source_data = {
                "award_title": title,
                "award_amount": amount,
                "award_date": award_date,
                "city": city,
                "state": state,
                "abstract": (abstract[:500] if abstract else None),
                "phase": "Phase I",
                "agency": "NSF",
            }

            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                cur.execute(
                    "SELECT 1 FROM companies WHERE domain = %s", (domain,)
                )
                existing = cur.fetchone()

            upsert_company(
                conn,
                domain=domain,
                name=company_name,
                url=url or "",
                description=description,
                source="sbir",
                source_data=source_data,
            )

            if existing:
                updated += 1
            else:
                added += 1

        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()

    print(
        f"SBIR: {added} added to pool, {updated} updated existing, {skipped} skipped (no name)",
        file=sys.stderr,
    )


if __name__ == "__main__":
    main()
