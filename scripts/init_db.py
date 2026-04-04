#!/usr/bin/env python3
"""Initialize the SQLite prospect pool database.

Creates prospects/pool.db with the companies table and indices.
Safe to run multiple times (idempotent). Pass --reset to drop and recreate.
"""

import argparse
import os
import sys

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, SCRIPT_DIR)

from pool_db import get_db

DB_PATH = os.path.join(SCRIPT_DIR, os.pardir, "prospects", "pool.db")

SCHEMA_SQL = """\
CREATE TABLE IF NOT EXISTS companies (
    domain TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    url TEXT,
    description TEXT,
    source TEXT,
    sources TEXT,               -- JSON array of all sources
    source_data TEXT,           -- JSON blob of raw source-specific fields
    state TEXT DEFAULT 'discovered',
    pre_filter_result TEXT,     -- yes/no/maybe
    pre_filter_confidence REAL,
    score INTEGER,
    verdict TEXT,
    team_size INTEGER,
    team_size_source TEXT,
    team_size_confidence TEXT,
    funding_stage TEXT,
    funding_evidence TEXT,
    ats_platform TEXT,
    ats_data TEXT,              -- JSON blob
    enrichment_data TEXT,       -- JSON blob of full enrichment results
    last_enriched TEXT,         -- ISO timestamp
    last_scored TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_state ON companies(state);
CREATE INDEX IF NOT EXISTS idx_source ON companies(source);
"""

VALID_STATES = [
    "discovered",
    "pre_filtered",
    "pre_filter_rejected",
    "enriched",
    "qualified",
    "nurture",
    "disqualified",
    "contacted",
    "stale",
    "dead",
]


def init_db(reset=False):
    """Create (or reset) the pool database."""
    db_path = os.path.normpath(DB_PATH)
    os.makedirs(os.path.dirname(db_path), exist_ok=True)

    conn = get_db()

    if reset:
        conn.execute("DROP TABLE IF EXISTS companies")
        print("Dropped existing companies table", file=sys.stderr)

    conn.executescript(SCHEMA_SQL)
    conn.commit()
    conn.close()

    print(f"Pool database ready at {db_path}", file=sys.stderr)
    print(f"Valid states: {', '.join(VALID_STATES)}", file=sys.stderr)


def main():
    parser = argparse.ArgumentParser(
        description="Initialize the SQLite prospect pool database"
    )
    parser.add_argument(
        "--reset",
        action="store_true",
        help="Drop and recreate the companies table",
    )
    args = parser.parse_args()

    init_db(reset=args.reset)


if __name__ == "__main__":
    main()
