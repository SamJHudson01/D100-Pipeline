#!/usr/bin/env python3
"""Example gathering script — use this as a template for your own sources.

Gathering scripts populate the prospect pool by calling pool_db.upsert_company()
for each company found. The upsert is atomic (INSERT ON CONFLICT) so running the
same script twice is safe — duplicates are merged, not created.

To add a new source:
  1. Copy this file to scripts/gather_yoursource.py
  2. Implement your data collection logic (API call, CSV import, web scrape, etc.)
  3. Call upsert_company() for each company found
  4. Run: python scripts/gather_yoursource.py

The only required fields are domain and name. Everything else is optional.
"""

import os
import sys

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, SCRIPT_DIR)

try:
    from dotenv import load_dotenv
    load_dotenv(os.path.join(SCRIPT_DIR, os.pardir, ".env"))
except ImportError:
    pass

from pool_db import get_db, upsert_company


def gather():
    """Replace this with your actual data collection logic."""

    # Example: a hardcoded list. In practice, you'd call an API, parse a CSV,
    # scrape a directory, query another database, etc.
    companies = [
        {
            "domain": "example.com",
            "name": "Example Corp",
            "url": "https://example.com",
            "description": "A sample company for testing the pipeline.",
            "source": "manual",           # Tag for filtering in the dashboard
            "source_data": {              # Optional metadata from this source
                "found_via": "manual entry",
                "notes": "Added as a test company",
            },
        },
        # Add more companies here, or generate them from your data source
    ]

    conn = get_db()
    added = 0

    for company in companies:
        try:
            upsert_company(
                conn,
                domain=company["domain"],
                name=company["name"],
                url=company.get("url", f"https://{company['domain']}"),
                description=company.get("description", ""),
                source=company.get("source", "manual"),
                source_data=company.get("source_data"),
            )
            added += 1
        except Exception as e:
            print(f"  Error upserting {company['domain']}: {e}", file=sys.stderr)

    conn.commit()
    conn.close()
    print(f"Done. Upserted {added} companies from example source.")


if __name__ == "__main__":
    gather()
