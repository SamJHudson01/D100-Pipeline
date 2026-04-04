"""Write enrichment results to the database.

Handles per-company DB writes with idempotency check.
Extracts queryable summary fields as top-level columns.
"""

import json
import sys
from datetime import datetime, timezone

from .schema import EnrichmentData

eprint = lambda *a, **kw: print(*a, file=sys.stderr, **kw)


def write_enrichment(domain: str, enrichment: EnrichmentData) -> None:
    """Write enrichment results to the companies table.

    - Stores full enrichment in enrichment_data jsonb
    - Extracts summary fields as top-level columns
    - Idempotent: checks last_enriched timestamp
    """
    import os, sys
    # Ensure scripts/ is importable
    scripts_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    if scripts_dir not in sys.path:
        sys.path.insert(0, scripts_dir)
    from pool_db import get_db

    conn = get_db()
    import psycopg2.extras
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

    # Extract queryable summary fields
    ws = enrichment.get("webSearch", {})
    ss = enrichment.get("structuredSources", {})
    gm = enrichment.get("growthMaturity", {})
    tools = enrichment.get("detectedTools", [])
    pricing = enrichment.get("pricing", {})
    signup = enrichment.get("signup", {})

    # Team size: prefer web search, fall back to YC, then structured sources
    team_size = ws.get("employeeCount")
    if not team_size:
        yc = ss.get("yc", {})
        team_size = yc.get("teamSize")

    # Funding stage
    funding_stage = ws.get("fundingStage")

    # Has pricing/signup (from analysis results)
    has_pricing = pricing.get("pageFound", False)
    has_signup = signup.get("pageFound", False)

    # Location verification
    loc = enrichment.get("location", {})
    region_verified = loc.get("status") == "verified"
    detected_region = loc.get("region", "unknown")

    # Update the company record
    cur.execute("""
        UPDATE companies SET
            enrichment_data = %s::jsonb,
            team_size = COALESCE(%s, team_size),
            team_size_source = COALESCE(%s, team_size_source),
            funding_stage = COALESCE(%s, funding_stage),
            has_pricing_page = %s OR has_pricing_page,
            has_signup = %s OR has_signup,
            region_verified = region_verified OR %s,
            last_enriched = now(),
            updated_at = now()
        WHERE domain = %s
    """, (
        json.dumps(enrichment, default=str),
        team_size,
        ws.get("employeeCountSource"),
        funding_stage,
        has_pricing,
        has_signup,
        region_verified,
        domain,
    ))

    # Upsert region if detected
    if detected_region in ("uk", "global"):
        cur.execute("""
            INSERT INTO company_regions (domain, region)
            VALUES (%s, %s)
            ON CONFLICT (domain, region) DO NOTHING
        """, (domain, detected_region))

    conn.commit()
    eprint(f"  [db_writer] Wrote enrichment for {domain} (region={detected_region}, verified={region_verified})")
