#!/usr/bin/env python3
"""Shared pool database utilities module.

Provides helpers for interacting with the Neon Postgres prospect pool database.
Other scripts import this module rather than managing connections directly.

Connection string is read from DATABASE_URL environment variable.
"""

import json
import os
import re
import sys

import psycopg2
import psycopg2.extras

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))

try:
    from dotenv import load_dotenv
    load_dotenv(os.path.join(SCRIPT_DIR, os.pardir, ".env"))
except ImportError:
    pass

VALID_STATES = {
    "discovered",
    "pre_filtered",
    "pre_filter_rejected",
    "enriched",
    "qualified",
    "nurture",
    "skip",
    "disqualified",
    "contacted",
    "stale",
    "dead",
}

VALID_TRANSITIONS = {
    "discovered": {"pre_filtered", "pre_filter_rejected"},
    "pre_filtered": {"enriched", "disqualified"},
    "pre_filter_rejected": {"discovered"},  # signal-triggered re-entry only
    "enriched": {"qualified", "nurture", "skip", "disqualified"},
    "qualified": {"contacted", "stale", "dead", "discovered"},
    "nurture": {"discovered", "stale", "dead"},
    "skip": {"discovered", "dead"},
    "disqualified": {"discovered", "dead"},
    "contacted": {"stale", "dead"},
    "stale": {"discovered", "dead"},
    "dead": set(),
}

# Columns that update_state is allowed to write (prevents SQL injection via kwargs)
ALLOWED_UPDATE_COLUMNS = {
    "score", "original_score", "verdict",
    "pre_filter_result", "pre_filter_confidence",
    "team_size", "team_size_source", "team_size_confidence",
    "funding_stage", "funding_evidence",
    "ats_platform", "ats_data", "enrichment_data",
    "last_enriched", "last_scored", "scored_at",
    "snoozed_until", "dismissed", "pinned",
    "dream100", "sequence_step", "sequence_started_at", "sequence_paused", "last_touch_date",
    "has_new_signal", "signal_type", "signal_date",
    "has_pricing_page", "has_signup", "has_growth_hire", "total_ats_roles",
    "last_run_id",
}


def get_db():
    """Get a connection to the Neon Postgres database."""
    db_url = os.environ.get("DATABASE_URL")
    if not db_url:
        print("ERROR: DATABASE_URL not set", file=sys.stderr)
        sys.exit(1)
    conn = psycopg2.connect(db_url)
    conn.autocommit = True
    return conn


def _cursor(conn):
    """Return a dict-like cursor."""
    return conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)


def normalize_domain(url):
    """Extract and normalize domain from URL."""
    if not url:
        return None
    from urllib.parse import urlparse

    if not url.startswith(("http://", "https://")):
        url = "https://" + url
    parsed = urlparse(url)
    domain = (parsed.hostname or "").lower()
    if domain.startswith("www."):
        domain = domain[4:]
    return domain or None


def make_key(name, url=None):
    """Generate a pool key from URL domain or company name."""
    domain = normalize_domain(url)
    if domain:
        return domain
    slug = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
    return f"nourl:{slug}" if slug else None


def upsert_company(conn, domain, name, url, description, source,
                   source_data=None):
    """Insert or update a company using INSERT ON CONFLICT for atomicity.

    Uses Postgres jsonb operators:
    - || for merging source_data (right-side wins, same as old json_patch)
    - Subquery with jsonb_array_elements_text + jsonb_agg for merging sources array
    """
    sources_json = json.dumps([source])
    sd_json = json.dumps({source: source_data} if source_data else {})

    with _cursor(conn) as cur:
        cur.execute("""
            INSERT INTO companies (domain, name, url, description, source, sources,
                                   source_data)
            VALUES (%s, %s, %s, %s, %s, %s::jsonb, %s::jsonb)
            ON CONFLICT(domain) DO UPDATE SET
                sources = (
                    SELECT jsonb_agg(DISTINCT val)
                    FROM (
                        SELECT jsonb_array_elements_text(COALESCE(companies.sources, '[]'::jsonb)) AS val
                        UNION
                        SELECT jsonb_array_elements_text(COALESCE(excluded.sources, '[]'::jsonb)) AS val
                    ) merged
                ),
                description = COALESCE(NULLIF(excluded.description, ''), companies.description),
                source_data = COALESCE(companies.source_data, '{}'::jsonb) || COALESCE(excluded.source_data, '{}'::jsonb),
                updated_at = now()
        """, (domain, name, url, description, source, sources_json, sd_json))


def get_pool_stats(conn, region=None):
    """Return dict of state counts, optionally filtered by region."""
    with _cursor(conn) as cur:
        if region:
            cur.execute("""
                SELECT c.state, COUNT(*) as cnt FROM companies c
                INNER JOIN company_regions cr ON c.domain = cr.domain
                WHERE cr.region = %s
                GROUP BY c.state
            """, (region,))
        else:
            cur.execute(
                "SELECT state, COUNT(*) as cnt FROM companies GROUP BY state"
            )
        return {r["state"]: r["cnt"] for r in cur.fetchall()}


def pick_candidates(conn, count=20, region=None, exclude_states=None):
    """Pick N candidates at random, optionally filtered by region."""
    if exclude_states is None:
        exclude_states = [
            "enriched", "qualified", "nurture", "disqualified",
            "contacted", "stale", "dead", "pre_filter_rejected",
        ]

    with _cursor(conn) as cur:
        if region:
            cur.execute(
                """SELECT c.* FROM companies c
                   INNER JOIN company_regions cr ON c.domain = cr.domain
                   WHERE cr.region = %s AND c.state != ALL(%s)
                   ORDER BY random() LIMIT %s""",
                (region, exclude_states, count),
            )
        else:
            cur.execute(
                """SELECT * FROM companies WHERE state != ALL(%s)
                   ORDER BY random() LIMIT %s""",
                (exclude_states, count),
            )
        return [dict(r) for r in cur.fetchall()]


def update_state(conn, domain, state, **kwargs):
    """Update a company's state and optional fields.

    Validates state transitions and restricts column names to an allowlist.
    """
    if state not in VALID_STATES:
        raise ValueError(f"Invalid state: {state}")

    with _cursor(conn) as cur:
        # Validate transition
        cur.execute("SELECT state FROM companies WHERE domain = %s", (domain,))
        current = cur.fetchone()
        if current:
            current_state = current["state"]
            if current_state != state and state not in VALID_TRANSITIONS.get(current_state, set()):
                raise ValueError(
                    f"Invalid transition: {current_state} → {state} for {domain}"
                )

        # Build UPDATE with allowlisted columns only
        sets = ["state = %s", "updated_at = now()"]
        vals = [state]
        for k, v in kwargs.items():
            if k not in ALLOWED_UPDATE_COLUMNS:
                raise ValueError(f"Column not allowed in update: {k}")
            sets.append(f"{k} = %s")
            vals.append(v)
        vals.append(domain)
        cur.execute(
            f"UPDATE companies SET {', '.join(sets)} WHERE domain = %s", vals
        )


def upsert_region(conn, domain, region):
    """Add a region mapping for a company (idempotent)."""
    with _cursor(conn) as cur:
        cur.execute("""
            INSERT INTO company_regions (domain, region)
            VALUES (%s, %s)
            ON CONFLICT (domain, region) DO NOTHING
        """, (domain, region))


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Pool database utilities")
    sub = parser.add_subparsers(dest="command")

    pick_p = sub.add_parser("pick", help="Pick random candidates")
    pick_p.add_argument("--count", type=int, default=20)
    pick_p.add_argument("--region", type=str, default=None)

    sub.add_parser("stats", help="Show pool stats")

    args = parser.parse_args()
    conn = get_db()

    if args.command == "pick":
        candidates = pick_candidates(conn, count=args.count, region=args.region)
        print(json.dumps(candidates, indent=2, default=str))
    elif args.command == "stats":
        stats = get_pool_stats(conn)
        total = sum(stats.values())
        print(f"Total: {total}")
        for state, count in sorted(stats.items(), key=lambda x: -x[1]):
            print(f"  {state}: {count}")
    else:
        parser.print_help()

    conn.close()
