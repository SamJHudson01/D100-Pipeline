"""Structured source lookups — YC cross-reference, GitHub org, Google News.

Uses free APIs:
- YC data already in pool (cross-reference by domain)
- GitHub org search (5,000 req/hr with token)
- Google News RSS (free, no auth)
"""

import os
import re
import sys

import requests

from .registry import register
from .schema import EnrichmentContext
from . import rate_limiter

eprint = lambda *a, **kw: print(*a, file=sys.stderr, **kw)

GITHUB_TOKEN = os.environ.get("GITHUB_TOKEN", "")
GITHUB_HEADERS = {"Accept": "application/vnd.github.v3+json"}
if GITHUB_TOKEN:
    GITHUB_HEADERS["Authorization"] = f"token {GITHUB_TOKEN}"


def _github_org_search(name: str, domain: str) -> dict | None:
    """Search for a GitHub organization matching the company."""
    if not rate_limiter.check("github"):
        eprint("  GitHub rate limited")
        return None

    # Try org name derived from domain or company name
    slugs = [
        domain.split(".")[0],  # e.g., "elyos" from "elyos.ai"
        re.sub(r'[^a-z0-9-]', '', name.lower().replace(' ', '-')),
    ]

    for slug in slugs:
        if not slug or len(slug) < 2:
            continue
        try:
            resp = requests.get(
                f"https://api.github.com/orgs/{slug}",
                headers=GITHUB_HEADERS,
                timeout=10,
            )
            rate_limiter.record("github")

            # Update rate limit from headers
            remaining = resp.headers.get("X-RateLimit-Remaining")
            if remaining:
                rate_limiter.update_from_headers("github", int(remaining))

            if resp.status_code == 200:
                data = resp.json()
                return {
                    "publicRepos": data.get("public_repos", 0),
                    "members": data.get("public_members_count") or data.get("followers", 0),
                    "primaryLanguages": [],  # Would need separate repos API call
                }
        except Exception as e:
            eprint(f"  GitHub org lookup failed for '{slug}': {e}")
            rate_limiter.record("github")

    return None


def _yc_cross_reference(domain: str) -> dict | None:
    """Check if this domain matches a YC company in our pool."""
    try:
        import os as _os
        _scripts_dir = _os.path.dirname(_os.path.dirname(_os.path.abspath(__file__)))
        if _scripts_dir not in sys.path:
            sys.path.insert(0, _scripts_dir)
        from pool_db import get_db
        conn = get_db()
        import psycopg2.extras
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute(
            "SELECT source, source_data FROM companies WHERE domain = %s",
            (domain,)
        )
        row = cur.fetchone()
        if not row:
            return None

        source = row.get("source", "")
        source_data = row.get("source_data") or {}
        if isinstance(source_data, str):
            import json
            source_data = json.loads(source_data)

        # Check if this came from YC
        if "yc" in source.lower() or "y combinator" in source.lower():
            yc_data = source_data.get("yc-oss") or source_data.get("yc") or {}
            if yc_data:
                return {
                    "batch": yc_data.get("batch", ""),
                    "status": yc_data.get("status", ""),
                    "industries": yc_data.get("industries", []),
                    "teamSize": yc_data.get("team_size"),
                }
            return {"status": "Active", "batch": ""}

        return None
    except Exception as e:
        eprint(f"  YC cross-reference failed: {e}")
        return None


@register("structured_lookups", tier=1)
def structured_lookups(ctx: EnrichmentContext) -> dict:
    """Cross-reference against YC, GitHub, and other structured sources."""
    domain = ctx.get("domain", "")
    name = ctx.get("name", "")

    sources: dict = {}

    # YC cross-reference
    yc = _yc_cross_reference(domain)
    if yc:
        sources["yc"] = yc
        eprint(f"  YC match: batch={yc.get('batch')}")

    # GitHub org
    github = _github_org_search(name, domain)
    if github:
        sources["github"] = github
        eprint(f"  GitHub org: {github.get('publicRepos')} repos")

    if not sources:
        return {}

    return {"structuredSources": sources}
