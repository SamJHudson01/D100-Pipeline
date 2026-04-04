#!/usr/bin/env python3
"""Query HN Algolia API for recent Show HN posts that may be startups worth prospecting."""

import argparse
import json
import os
import re
import sys
from datetime import datetime, timedelta, timezone

import requests

try:
    from dotenv import load_dotenv

    env_path = os.path.join(os.path.dirname(__file__), os.pardir, ".env")
    load_dotenv(dotenv_path=env_path)
except ImportError:
    pass

HN_ALGOLIA_URL = "http://hn.algolia.com/api/v1/search"
HN_ITEM_URL = "https://news.ycombinator.com/item?id="
MIN_POINTS = 5


def parse_title(title):
    """Extract company name and product URL from a Show HN title.

    Common formats:
      Show HN: CompanyName - description
      Show HN: CompanyName (product.com) - description
      Launch HN: CompanyName - description
    """
    # Strip the "Show HN:" or "Launch HN:" prefix
    cleaned = re.sub(r"^(Show|Launch)\s+HN:\s*", "", title).strip()

    company_name = None
    product_url = None

    # Try to pull a URL out of parentheses, e.g. "(https://foo.com)" or "(foo.com)"
    paren_match = re.search(r"\(([^)]*\.[a-z]{2,}[^)]*)\)", cleaned, re.IGNORECASE)
    if paren_match:
        raw_url = paren_match.group(1).strip()
        product_url = raw_url if raw_url.startswith("http") else "https://" + raw_url

    # Company name is whatever comes before the first delimiter (dash, parenthesis, colon)
    name_match = re.split(r"\s*[\u2013\u2014\-\(\:\|]", cleaned, maxsplit=1)
    if name_match and name_match[0].strip():
        company_name = name_match[0].strip()

    return company_name, product_url


def fetch_show_hn(days=7):
    """Fetch recent Show HN posts from HN Algolia API."""
    since = datetime.now(timezone.utc) - timedelta(days=days)
    timestamp = int(since.timestamp())

    params = {
        "query": "Show HN",
        "tags": "story",
        "numericFilters": f"created_at_i>{timestamp},points>={MIN_POINTS}",
        "hitsPerPage": 200,
    }

    resp = requests.get(HN_ALGOLIA_URL, params=params, timeout=30)
    resp.raise_for_status()
    return resp.json().get("hits", [])


def process_hits(hits):
    """Transform raw API hits into prospecting records."""
    results = []
    for hit in hits:
        title = hit.get("title", "")
        if not title:
            continue

        company_name, product_url = parse_title(title)

        # Use story URL, then fall back to product_url extracted from title
        url = hit.get("url") or product_url

        record = {
            "source": "hn",
            "company_name": company_name,
            "url": url,
            "hn_url": HN_ITEM_URL + str(hit.get("objectID", "")),
            "title": title,
            "points": hit.get("points", 0),
            "author": hit.get("author", ""),
            "discovered_at": hit.get("created_at", datetime.now(timezone.utc).isoformat()),
        }
        results.append(record)

    # Sort by points descending so the most popular appear first
    results.sort(key=lambda r: r["points"], reverse=True)
    return results


def main():
    parser = argparse.ArgumentParser(description="Gather Show HN posts for prospecting.")
    parser.add_argument("--days", type=int, default=7, help="Look back N days (default: 7)")
    args = parser.parse_args()

    try:
        hits = fetch_show_hn(days=args.days)
    except requests.RequestException as exc:
        print(f"Error fetching from HN Algolia API: {exc}", file=sys.stderr)
        sys.exit(1)

    results = process_hits(hits)
    json.dump(results, sys.stdout, indent=2, ensure_ascii=False)
    print()  # trailing newline


if __name__ == "__main__":
    main()
