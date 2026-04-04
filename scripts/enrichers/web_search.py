"""Web search enrichment — firmographics via Perplexity Sonar.

Uses Perplexity's sonar model via OpenRouter for web-grounded company
data extraction. Gets team size, location, funding from LinkedIn,
Crunchbase, PitchBook in a single API call.

~$0.15 per 1,000 companies.

This enricher runs FIRST in the pipeline (Tier 1).
"""

import sys

from .registry import register
from .schema import EnrichmentContext
from .perplexity_lookup import lookup

eprint = lambda *a, **kw: print(*a, file=sys.stderr, **kw)


@register("web_search", tier=1)
def web_search(ctx: EnrichmentContext) -> dict:
    """Search for company firmographics via Perplexity Sonar."""
    name = ctx.get("name", "")
    domain = ctx.get("domain", "")
    description = ctx.get("description", "")

    if not name:
        return {"webSearch": {"status": "skipped"}}

    result = {"status": "success"}

    data = lookup(domain, name, description)

    if data:
        result["searchResultsFound"] = True
        if data.get("teamSize"):
            result["employeeCount"] = data["teamSize"]
            result["employeeCountSource"] = data.get("teamSizeSource", "perplexity")
        if data.get("hqLocation"):
            result["hqLocation"] = data["hqLocation"]
        if data.get("fundingAmount"):
            result["fundingAmount"] = data["fundingAmount"]
        if data.get("fundingStage"):
            result["fundingStage"] = data["fundingStage"]
        if data.get("foundedYear"):
            result["foundedYear"] = data["foundedYear"]
    else:
        result["searchResultsFound"] = False

    return {"webSearch": result}
