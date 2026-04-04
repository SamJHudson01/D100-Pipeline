"""Location verification enricher — determines UK vs global from existing data.

Tier 3 (parallel). Uses homepage content from Tier 2 and infrastructure
from Tier 1 to verify company location. Zero extra API calls.
"""

import re
import sys

from .registry import register
from .schema import EnrichmentContext

eprint = lambda *a, **kw: print(*a, file=sys.stderr, **kw)

# UK city names (top 50 by population + major tech hubs)
UK_CITIES = {
    "london", "manchester", "birmingham", "leeds", "glasgow", "liverpool",
    "edinburgh", "bristol", "sheffield", "cardiff", "belfast", "nottingham",
    "newcastle", "leicester", "brighton", "oxford", "cambridge", "reading",
    "coventry", "hull", "derby", "southampton", "portsmouth", "swansea",
    "exeter", "bath", "york", "dundee", "aberdeen", "warwick", "guildford",
    "sunderland", "wolverhampton", "plymouth", "stoke", "norwich", "luton",
    "slough", "milton keynes", "swindon", "basingstoke", "cheltenham",
}

# Strong UK signals (high confidence — any one of these confirms UK)
UK_STRONG_PATTERNS = [
    r"registered in england",
    r"registered in scotland",
    r"registered in wales",
    r"registered in northern ireland",
    r"companies house",
    r"company\s+(?:number|no\.?|#)\s*\d{6,8}",
    r"VAT\s+(?:number|no\.?|#|registration)\s*(?:GB)?\s*\d",
    r"\bICO\s+registration\b",
    r"\bFCA\s+(?:registered|authorised|regulated)\b",
]

# Medium UK signals (need 2+ to confirm)
UK_MEDIUM_PATTERNS = [
    r"\b(?:United Kingdom|UK)\b(?!\s*(?:dollar|USD))",
    r"\b(?:England|Scotland|Wales|Northern Ireland)\b",
    r"\b£\d",  # GBP pricing
    r"\bGBP\b",
    r"\+44[\s\(]",  # UK phone number
    r"\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b",  # UK postcode
]


def _check_tld(domain: str) -> str | None:
    """Check if domain TLD indicates UK."""
    if domain.endswith(".co.uk") or domain.endswith(".uk") or domain.endswith(".org.uk"):
        return "uk_tld"
    return None


def _check_content(content: str) -> tuple[str, list[str]]:
    """Scan homepage content for location signals.

    Returns (region, evidence_list).
    """
    if not content:
        return "unknown", []

    content_lower = content.lower()
    evidence = []

    # Check strong patterns (any one confirms UK)
    for pattern in UK_STRONG_PATTERNS:
        m = re.search(pattern, content_lower)
        if m:
            evidence.append(f"strong: {m.group()}")
            return "uk", evidence

    # Check for UK city mentions in address-like contexts
    for city in UK_CITIES:
        # Look for city in address context (near postcode, comma-separated, etc.)
        city_patterns = [
            rf"\b{re.escape(city)}\b[,\s]+(?:[A-Z]{{1,2}}\d[A-Z\d]?\s*\d[A-Z]{{2}})",  # city + postcode
            rf"\b{re.escape(city)}\b[,\s]+(?:united kingdom|uk|england|scotland|wales)\b",
            rf"(?:based in|located in|headquartered in|hq in|offices? in)\s+{re.escape(city)}\b",
        ]
        for cp in city_patterns:
            if re.search(cp, content_lower):
                evidence.append(f"city_address: {city}")
                return "uk", evidence

    # Check medium patterns (need 2+)
    medium_hits = []
    for pattern in UK_MEDIUM_PATTERNS:
        m = re.search(pattern, content)
        if m:
            medium_hits.append(f"medium: {m.group()}")

    if len(medium_hits) >= 2:
        evidence.extend(medium_hits)
        return "uk", evidence

    # Check for UK cities mentioned at all (weaker signal)
    city_mentions = []
    for city in UK_CITIES:
        if re.search(rf"\b{re.escape(city)}\b", content_lower):
            city_mentions.append(city)

    if city_mentions:
        evidence.append(f"city_mentions: {', '.join(city_mentions[:3])}")
        if len(city_mentions) >= 1 and len(medium_hits) >= 1:
            evidence.extend(medium_hits)
            return "uk", evidence

    return "unknown", evidence


@register("location", tier=3)
def location(ctx: EnrichmentContext) -> dict:
    """Determine company location from existing enrichment data."""
    domain = ctx.get("domain", "")
    result = ctx.get("result", {})

    evidence = []
    region = "unknown"

    # 1. Check TLD
    tld_signal = _check_tld(domain)
    if tld_signal:
        evidence.append(tld_signal)
        region = "uk"

    # 2. Check homepage content (from Tier 2 website scrape)
    homepage = result.get("homepage", {})
    content = homepage.get("markdown") or homepage.get("html") or ""
    if not content:
        # Try context directly (some enrichers store it differently)
        content = ctx.get("homepage_content", "")

    content_region, content_evidence = _check_content(content)
    evidence.extend(content_evidence)
    if content_region == "uk":
        region = "uk"

    # 3. Check web search results for location mentions
    ws = result.get("webSearch", {})

    # Check hqLocation from web_search extraction
    hq = ws.get("hqLocation", "")
    if hq and "uk" in hq.lower():
        evidence.append(f"hqLocation: {hq}")
        region = "uk"

    news = ws.get("latestNews", [])
    if news:
        combined_news = " ".join(item.get("title", "") for item in news)
        news_region, news_evidence = _check_content(combined_news)
        evidence.extend(news_evidence)
        if news_region == "uk":
            region = "uk"

    status = "verified" if region != "unknown" else "unverified"
    eprint(f"  [location] {domain}: {region} ({status}, {len(evidence)} signals)")

    return {
        "location": {
            "region": region,
            "status": status,
            "evidence": evidence,
        }
    }
