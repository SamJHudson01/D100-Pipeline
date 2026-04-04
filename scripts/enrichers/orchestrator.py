"""Three-tier parallel enrichment orchestrator.

Runs all enrichment steps for a single company using ThreadPoolExecutor.
Tier structure based on data dependencies:

  Tier 1 (parallel, 15s): web_search, structured_lookups, dns_headers
  Tier 2 (sequential, 20s): firecrawl_homepage
  Tier 3 (parallel, 15s): all HTML analyses + pricing/signup scrapes
  Founder chain (parallel with Tier 3, 20s): founder_extraction, email_finder

Each tier has an explicit timeout. Failed steps record status and continue.
"""

import json
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed, TimeoutError
from datetime import datetime, timezone

from .registry import get_tier_enrichers, merge_result, get_enricher
from .schema import EnrichmentContext
from . import rate_limiter

eprint = lambda *a, **kw: print(*a, file=sys.stderr, **kw)

# Timeout budgets per tier (seconds)
TIER_TIMEOUTS = {
    1: 15,
    2: 20,
    3: 15,
}
FOUNDER_CHAIN_TIMEOUT = 20


def enrich_company(domain: str, name: str, url: str, description: str = "") -> dict:
    """Run the full enrichment pipeline for a single company.

    Returns the enrichment_data dict ready for database storage.
    """
    start = time.time()

    # Reset per-company rate limits
    rate_limiter.reset_company("firecrawl")

    # Initialize context
    ctx: EnrichmentContext = {
        "domain": domain,
        "name": name,
        "url": url,
        "description": description,
        "result": {},
    }

    # ─── Tier 1: Parallel (web search, structured lookups, DNS/headers) ───
    _run_tier(ctx, tier=1)

    # ─── Tier 2: Sequential (Firecrawl homepage scrape) ───
    _run_tier(ctx, tier=2)

    # ─── Tier 3: Parallel (HTML analyses + pricing/signup) ───
    # Also run founder chain in parallel with Tier 3
    _run_tier(ctx, tier=3)

    # ─── Founder chain (runs after Tier 1 for names, Tier 2 for HTML) ───
    _run_tier(ctx, tier=4)  # founder extraction + email finder

    # ─── Generate BLUF and talking points (deterministic, from enrichment data) ───
    from .bluf_generator import generate_bluf, generate_talking_points
    result = ctx.get("result", {})
    bluf = generate_bluf(result)
    if bluf:
        merge_result(ctx, bluf)

    # Set meta
    elapsed_ms = int((time.time() - start) * 1000)
    result = ctx.get("result", {})
    meta = result.get("meta", {})
    meta["enrichedAt"] = datetime.now(timezone.utc).isoformat()
    meta["totalDurationMs"] = elapsed_ms
    result["meta"] = meta
    ctx["result"] = result

    eprint(f"Enrichment complete for {domain} in {elapsed_ms}ms")
    return result


def _run_tier(ctx: EnrichmentContext, tier: int) -> None:
    """Run all enrichers in a tier, with parallelism and timeout."""
    enrichers = get_tier_enrichers(tier)
    if not enrichers:
        return

    timeout = TIER_TIMEOUTS.get(tier, 15)
    names = [e.name for e in enrichers]

    if len(enrichers) == 1:
        # Single enricher — run directly, no thread overhead
        e = enrichers[0]
        try:
            result = e.fn(ctx)
            if result:
                merge_result(ctx, result)
        except Exception as exc:
            eprint(f"  [{e.name}] FAILED: {exc}")
        return

    # Multiple enrichers — run in parallel
    with ThreadPoolExecutor(max_workers=len(enrichers)) as executor:
        future_to_name = {}
        for e in enrichers:
            future = executor.submit(_safe_run, e.name, e.fn, ctx)
            future_to_name[future] = e.name

        for future in as_completed(future_to_name, timeout=timeout):
            name = future_to_name[future]
            try:
                result = future.result(timeout=1)
                if result:
                    merge_result(ctx, result)
            except TimeoutError:
                eprint(f"  [{name}] TIMEOUT after {timeout}s")
            except Exception as exc:
                eprint(f"  [{name}] FAILED: {exc}")


def _safe_run(name: str, fn, ctx: EnrichmentContext) -> dict | None:
    """Run an enricher with exception catching."""
    try:
        return fn(ctx)
    except Exception as exc:
        eprint(f"  [{name}] ERROR: {exc}")
        return None
