#!/usr/bin/env python3
"""Migrate data from SQLite pool.db to Neon Postgres.

Reads all rows from the local SQLite database and batch-inserts them into
Neon within a single transaction. Verifies row counts before committing.

Usage:
    python scripts/migrate_to_neon.py [--dry-run]
"""

import argparse
import os
import sqlite3
import sys

from dotenv import load_dotenv

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
load_dotenv(os.path.join(SCRIPT_DIR, os.pardir, ".env"))

import psycopg2
from psycopg2.extras import execute_values

SQLITE_PATH = os.path.join(SCRIPT_DIR, os.pardir, "prospects", "pool.db")

# SQLite INTEGER 0/1 columns that become Postgres BOOLEAN
BOOL_COLUMNS = {
    "dismissed", "pinned", "dream100", "sequence_paused",
    "has_new_signal", "has_pricing_page", "has_signup", "has_growth_hire",
}


def migrate(dry_run=False):
    if not os.path.exists(SQLITE_PATH):
        print(f"SQLite database not found: {SQLITE_PATH}", file=sys.stderr)
        sys.exit(1)

    db_url = os.environ.get("DATABASE_URL")
    if not db_url:
        print("DATABASE_URL not set", file=sys.stderr)
        sys.exit(1)

    # Connect to both databases
    sqlite_conn = sqlite3.connect(SQLITE_PATH)
    sqlite_conn.row_factory = sqlite3.Row
    pg_conn = psycopg2.connect(db_url)

    try:
        pg_cur = pg_conn.cursor()

        # ─── Companies ────────────────────────────────────────────────────
        print("Reading companies from SQLite...")
        sqlite_rows = sqlite_conn.execute("SELECT * FROM companies").fetchall()
        sqlite_companies_count = len(sqlite_rows)
        print(f"  Found {sqlite_companies_count} companies")

        # Get column names from SQLite
        col_names = [desc[0] for desc in sqlite_conn.execute("SELECT * FROM companies LIMIT 0").description]

        # Build Postgres INSERT
        pg_cols = ", ".join(f'"{c}"' for c in col_names)
        template = "(" + ", ".join(["%s"] * len(col_names)) + ")"

        # Convert rows, mapping INTEGER booleans to Python bools
        pg_values = []
        for row in sqlite_rows:
            values = []
            for col_name in col_names:
                val = row[col_name]
                if col_name in BOOL_COLUMNS:
                    val = bool(val) if val is not None else False
                values.append(val)
            pg_values.append(tuple(values))

        print("Inserting companies into Neon...")
        execute_values(
            pg_cur,
            f'INSERT INTO "companies" ({pg_cols}) VALUES %s',
            pg_values,
            template=template,
            page_size=1000,
        )

        # ─── Company Regions ──────────────────────────────────────────────
        print("Reading company_regions from SQLite...")
        region_rows = sqlite_conn.execute("SELECT domain, region FROM company_regions").fetchall()
        sqlite_regions_count = len(region_rows)
        print(f"  Found {sqlite_regions_count} regions")

        print("Inserting company_regions into Neon...")
        execute_values(
            pg_cur,
            'INSERT INTO "company_regions" ("domain", "region") VALUES %s',
            [(r["domain"], r["region"]) for r in region_rows],
            page_size=1000,
        )

        # ─── Touchpoints (if any) ────────────────────────────────────────
        tp_rows = sqlite_conn.execute("SELECT * FROM touchpoints").fetchall()
        if tp_rows:
            tp_cols = [desc[0] for desc in sqlite_conn.execute("SELECT * FROM touchpoints LIMIT 0").description]
            tp_pg_cols = ", ".join(f'"{c}"' for c in tp_cols)
            tp_template = "(" + ", ".join(["%s"] * len(tp_cols)) + ")"
            execute_values(
                pg_cur,
                f'INSERT INTO "touchpoints" ({tp_pg_cols}) VALUES %s',
                [tuple(r[c] for c in tp_cols) for r in tp_rows],
                template=tp_template,
            )
            print(f"  Migrated {len(tp_rows)} touchpoints")

        # ─── Pipeline Runs (if any) ──────────────────────────────────────
        pr_rows = sqlite_conn.execute("SELECT * FROM pipeline_runs").fetchall()
        if pr_rows:
            pr_cols = [desc[0] for desc in sqlite_conn.execute("SELECT * FROM pipeline_runs LIMIT 0").description]
            pr_pg_cols = ", ".join(f'"{c}"' for c in pr_cols)
            pr_template = "(" + ", ".join(["%s"] * len(pr_cols)) + ")"
            execute_values(
                pg_cur,
                f'INSERT INTO "pipeline_runs" ({pr_pg_cols}) VALUES %s',
                [tuple(r[c] for c in pr_cols) for r in pr_rows],
                template=pr_template,
            )
            print(f"  Migrated {len(pr_rows)} pipeline runs")

        # ─── Verify Counts ───────────────────────────────────────────────
        print("\nVerifying row counts...")
        pg_cur.execute('SELECT COUNT(*) FROM "companies"')
        pg_companies = pg_cur.fetchone()[0]
        pg_cur.execute('SELECT COUNT(*) FROM "company_regions"')
        pg_regions = pg_cur.fetchone()[0]

        print(f"  Companies:  SQLite={sqlite_companies_count}  Postgres={pg_companies}")
        print(f"  Regions:    SQLite={sqlite_regions_count}  Postgres={pg_regions}")

        if pg_companies != sqlite_companies_count:
            print(f"\n  MISMATCH: companies count differs!", file=sys.stderr)
            pg_conn.rollback()
            sys.exit(1)

        if pg_regions != sqlite_regions_count:
            print(f"\n  MISMATCH: company_regions count differs!", file=sys.stderr)
            pg_conn.rollback()
            sys.exit(1)

        if dry_run:
            print("\n  DRY RUN — rolling back")
            pg_conn.rollback()
        else:
            pg_conn.commit()
            print(f"\n  Migration committed successfully")

        # Quick sanity check on the view
        if not dry_run:
            pg_cur.execute('SELECT COUNT(*), AVG("effective_score") FROM "companies_scored"')
            view_count, avg_score = pg_cur.fetchone()
            print(f"  companies_scored view: {view_count} rows, avg effective_score={avg_score:.1f}")

    except Exception as e:
        pg_conn.rollback()
        print(f"\nERROR: {e}", file=sys.stderr)
        raise
    finally:
        sqlite_conn.close()
        pg_conn.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Migrate SQLite data to Neon Postgres")
    parser.add_argument("--dry-run", action="store_true", help="Verify without committing")
    args = parser.parse_args()
    migrate(dry_run=args.dry_run)
