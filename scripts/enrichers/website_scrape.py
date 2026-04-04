"""Website scrape enricher — Firecrawl homepage scrape.

Tier 2 (sequential). Provides homepage HTML/markdown to the context
for Tier 3 analysers. Also extracts team size and founder info from
about/team pages.
"""

import os
import re
import sys
from urllib.parse import urljoin

import requests

from .registry import register
from .schema import EnrichmentContext
from . import cache as enrichment_cache
from . import rate_limiter

eprint = lambda *a, **kw: print(*a, file=sys.stderr, **kw)

FIRECRAWL_API_KEY = os.environ.get("FIRECRAWL_API_KEY", "")
BROWSER_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"


def _scrape_firecrawl(url: str) -> tuple[str, str, str]:
    """Scrape via Firecrawl. Returns (markdown, html, method)."""
    if not FIRECRAWL_API_KEY or not rate_limiter.check("firecrawl"):
        return "", "", "skipped"
    try:
        resp = requests.post("https://api.firecrawl.dev/v1/scrape",
            json={"url": url, "formats": ["markdown", "html"]},
            headers={"Authorization": f"Bearer {FIRECRAWL_API_KEY}",
                     "Content-Type": "application/json"},
            timeout=30)
        resp.raise_for_status()
        rate_limiter.record("firecrawl")
        data = resp.json().get("data", {})
        return data.get("markdown", ""), data.get("html", ""), "firecrawl"
    except Exception as e:
        eprint(f"  Firecrawl failed: {e}")
        rate_limiter.record("firecrawl")
        return "", "", "firecrawl_failed"


def _scrape_requests(url: str) -> tuple[str, str]:
    """Fallback scrape with requests. Returns (text, html)."""
    try:
        resp = requests.get(url, timeout=15, allow_redirects=True,
                          headers={"User-Agent": BROWSER_UA})
        resp.raise_for_status()
        html = resp.text
        # Strip scripts and styles for text
        text = re.sub(r"<script[^>]*>.*?</script>", "", html, flags=re.DOTALL | re.IGNORECASE)
        text = re.sub(r"<style[^>]*>.*?</style>", "", text, flags=re.DOTALL | re.IGNORECASE)
        text = re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", text)).strip()
        return text, html
    except Exception as e:
        eprint(f"  Requests fallback failed: {e}")
        return "", ""


def _extract_team_size(content: str) -> tuple[int | None, str | None]:
    """Parse content for team size mentions."""
    if not content:
        return None, None
    patterns = [
        r"(\d{1,4})\+?\s*(?:team members|employees|people|staff)",
        r"team\s*(?:of|:)\s*(\d{1,4})",
        r"(\d{1,4})\+?\s*(?:person|member)\s*team",
        r"we\s*(?:are|\'re)\s*(?:a\s*)?(\d{1,4})\s*(?:person|people|member)",
    ]
    for pat in patterns:
        m = re.search(pat, content, re.IGNORECASE)
        if m:
            count = int(m.group(1))
            if 1 <= count <= 500:
                return count, f"Page: '{m.group(0).strip()[:50]}'"
    return None, None


def _extract_founders_from_page(content: str) -> list[dict]:
    """Extract founder names and titles from team/about page content."""
    founders = []
    # Look for "Founder", "CEO", "CTO", "Co-founder" near names
    pattern = re.compile(
        r'(?:^|\n)\s*(?:#{1,4}\s+)?([A-Z][a-z]+(?:\s[A-Z][a-z]+)+)\s*\n?\s*'
        r'(?:.*?(?:Founder|Co-?[Ff]ounder|CEO|CTO|COO|Chief))',
        re.MULTILINE
    )
    for m in pattern.finditer(content):
        name = m.group(1).strip()
        if len(name.split()) >= 2 and len(name) < 50:
            # Determine role
            title_text = m.group(0).lower()
            role = "founder"
            if "ceo" in title_text:
                role = "ceo"
            elif "cto" in title_text:
                role = "cto"
            elif "coo" in title_text:
                role = "coo"

            # Extract title
            title_match = re.search(r'((?:Co-?)?(?:Founder|CEO|CTO|COO|Chief\s+\w+\s*\w*)\s*(?:&\s*\w+)?)', m.group(0))
            title = title_match.group(1).strip() if title_match else None

            founders.append({
                "name": name,
                "role": role,
                "title": title,
                "source": "about_page",
            })

    return founders[:5]


@register("website_scrape", tier=2)
def website_scrape(ctx: EnrichmentContext) -> dict:
    """Scrape homepage, extract team size and founders, set HTML in context."""
    url = ctx.get("url", "")
    domain = ctx.get("domain", "")
    if not url:
        return {}

    # Check cache
    cached = enrichment_cache.get("website", domain)
    if cached:
        markdown = cached.get("markdown", "")
        html = cached.get("html", "")
        eprint(f"  [website_scrape] cached for {domain}")
    else:
        # Scrape homepage (Firecrawl disabled — no credits)
        # markdown, html, method = _scrape_firecrawl(url)
        # if not markdown and not html:
        text, html = _scrape_requests(url)
        markdown = text
        method = "requests"

        if markdown or html:
            eprint(f"  [website_scrape] {domain} via {method} ({len(markdown or html)} chars)")
            enrichment_cache.set("website", domain, {
                "markdown": markdown[:10000],
                "html": html[:20000],
            })
        else:
            eprint(f"  [website_scrape] FAILED for {domain}")

    # Store HTML in context for Tier 3 analysers (NOT in result — never stored in DB)
    ctx["homepage_markdown"] = markdown or ""
    ctx["homepage_html"] = html or ""

    # Record meta
    meta = ctx.get("result", {}).get("meta", {})
    pages = meta.get("pagesScraped", [])
    pages.append("/")
    meta["pagesScraped"] = pages
    if "firecrawl" in (cached or {}).get("_method", "") or (not cached and rate_limiter.check("firecrawl")):
        meta["firecrawlCreditsUsed"] = meta.get("firecrawlCreditsUsed", 0) + (0 if cached else 1)

    output = {"meta": meta}

    # Extract team size from homepage
    content = markdown or html or ""
    team_size, team_evidence = _extract_team_size(content)

    # Try about/team page if not found on homepage
    if team_size is None and content:
        team_urls = re.findall(
            r'(?:\[(?:team|our team|about|about us|people)\]\((https?://[^\)]+)\)|'
            r'href=["\']([^"\']*(?:/team|/about|/people|/our-team|/about-us)[^"\']*)["\'])',
            content, re.IGNORECASE
        )
        for match in team_urls[:2]:
            team_url = match[0] or match[1]
            if not team_url.startswith("http"):
                team_url = urljoin(url, team_url)
            try:
                resp = requests.get(team_url, timeout=10, headers={"User-Agent": BROWSER_UA})
                if resp.status_code == 200:
                    tp_text = resp.text
                    team_size, team_evidence = _extract_team_size(tp_text)

                    # Also extract founders from team page
                    founders = _extract_founders_from_page(tp_text)
                    if founders:
                        output["keyPeople"] = founders

                    if team_size:
                        break
            except Exception:
                continue

    # Also extract founders from homepage
    if "keyPeople" not in output:
        founders = _extract_founders_from_page(content)
        if founders:
            output["keyPeople"] = founders

    # Update webSearch with team size if found and not already set
    ws = ctx.get("result", {}).get("webSearch", {})
    if team_size and not ws.get("employeeCount"):
        if "webSearch" not in output:
            output["webSearch"] = dict(ws)
        output["webSearch"]["employeeCount"] = team_size
        output["webSearch"]["employeeCountSource"] = f"website: {team_evidence}"

    return output
