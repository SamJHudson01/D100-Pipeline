#!/usr/bin/env python3
"""Fetch Y Combinator company directory and add matching companies to the prospect pool.

Uses the YC open-source API (yc-oss) which returns all YC companies as a single
JSON array.  Filters by status, team size, and batch recency, then upserts into
the pool database.
"""

import argparse
import json
import os
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

YC_API_URL = "https://yc-oss.github.io/api/companies/all.json"


def recent_batches(n=6, ref_date=None):
    """Return the last *n* YC batch names (e.g. ['Winter 2026', 'Summer 2025', ...]).

    YC runs two batches per year: Winter (W) starts in January and Summer (S)
    starts around June.  The API uses full names like "Winter 2026", "Summer 2025".
    """
    if ref_date is None:
        ref_date = datetime.now(timezone.utc)

    year = ref_date.year
    month = ref_date.month

    # Current or most-recent batch
    if month >= 6:
        current_season, current_year = "Summer", year
    else:
        current_season, current_year = "Winter", year

    batches = []
    season, yr = current_season, current_year
    while len(batches) < n:
        batches.append(f"{season} {yr}")
        if season == "Summer":
            season = "Winter"
        else:
            season = "Summer"
            yr -= 1

    return batches


def fetch_companies():
    """Fetch the full YC company list from the public API."""
    resp = requests.get(YC_API_URL, timeout=60)
    resp.raise_for_status()
    return resp.json()


def main():
    parser = argparse.ArgumentParser(
        description="Fetch YC companies and add qualifying ones to the prospect pool."
    )
    parser.add_argument(
        "--max-team-size", type=int, default=50,
        help="Maximum team size to include (default: 50)",
    )
    parser.add_argument(
        "--batches", type=int, default=6,
        help="Number of recent batches to include (default: 6)",
    )
    args = parser.parse_args()

    # Determine which batches qualify
    ref_date = datetime(2026, 3, 18, tzinfo=timezone.utc)
    allowed_batches = recent_batches(n=args.batches, ref_date=ref_date)
    batch_order = {b: i for i, b in enumerate(allowed_batches)}

    print(f"YC: targeting batches {', '.join(allowed_batches)}", file=sys.stderr)

    # Fetch all companies
    try:
        companies = fetch_companies()
    except requests.RequestException as exc:
        print(f"YC: error fetching company list: {exc}", file=sys.stderr)
        sys.exit(1)

    total = len(companies)

    # Filter
    matched = []
    for c in companies:
        if c.get("status") != "Active":
            continue
        team_size = c.get("team_size") or 0
        if team_size < 1 or team_size > args.max_team_size:
            continue
        batch = c.get("batch", "")
        if batch not in batch_order:
            continue
        matched.append(c)

    # Upsert into pool database
    conn = get_db()
    added = 0
    updated = 0

    try:
        for c in matched:
            url = c.get("website") or c.get("url") or ""
            domain = normalize_domain(url)
            if not domain:
                continue

            name = c.get("name") or ""
            description = c.get("one_liner") or c.get("long_description") or ""

            source_data = {
                "batch": c.get("batch"),
                "stage": c.get("stage"),
                "team_size": c.get("team_size"),
                "industries": c.get("industries"),
                "tags": c.get("tags"),
                "isHiring": c.get("isHiring"),
            }

            # Check if company already exists to track added vs updated
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                cur.execute(
                    "SELECT 1 FROM companies WHERE domain = %s", (domain,)
                )
                existing = cur.fetchone()

            upsert_company(
                conn,
                domain=domain,
                name=name,
                url=url,
                description=description,
                source="yc",
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
        f"YC: {total} total, {len(matched)} matched filters, "
        f"{added} added to pool, {updated} updated existing",
        file=sys.stderr,
    )


if __name__ == "__main__":
    main()
