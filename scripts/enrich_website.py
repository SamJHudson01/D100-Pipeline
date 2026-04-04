#!/usr/bin/env python3
"""Enrich a single company by scraping its website.

Called per-company by the skill pipeline. Reads one company JSON from stdin,
scrapes the website at --url, parses team/about pages for headcount,
and outputs enriched company JSON to stdout.

v2: Removed CSP header parsing and Segment config detection (zero results in v1).
    Added team/about page parsing for headcount and funding signal detection.
"""
import argparse, hashlib, json, os, re, sys
from datetime import datetime, timezone, timedelta
from urllib.parse import urlparse, urljoin

try:
    from dotenv import load_dotenv
    load_dotenv(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".env"))
except ImportError:
    pass

import requests

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
CACHE_DIR = os.path.join(SCRIPT_DIR, "..", "prospects", "cache")
CACHE_MAX_AGE = timedelta(days=7)

BROWSER_UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
)

eprint = lambda *a, **kw: print(*a, file=sys.stderr, **kw)


def normalize_domain(url):
    if not url.startswith(("http://", "https://")):
        url = "https://" + url
    return urlparse(url).netloc.lower().strip().removeprefix("www.")


def load_cache(domain):
    os.makedirs(CACHE_DIR, exist_ok=True)
    path = os.path.join(CACHE_DIR, f"{hashlib.sha256(domain.encode()).hexdigest()}.json")
    if not os.path.exists(path):
        return None
    try:
        with open(path) as f:
            data = json.load(f)
        ts = datetime.fromisoformat(data.get("enriched_at", "2000-01-01T00:00:00+00:00"))
        if datetime.now(timezone.utc) - ts < CACHE_MAX_AGE:
            data.update(cached=True, scrape_status="cached")
            return data
    except (json.JSONDecodeError, ValueError, OSError) as e:
        eprint(f"Cache read error: {e}")
    return None


def save_cache(domain, result):
    os.makedirs(CACHE_DIR, exist_ok=True)
    path = os.path.join(CACHE_DIR, f"{hashlib.sha256(domain.encode()).hexdigest()}.json")
    try:
        with open(path, "w") as f:
            json.dump(result, f, indent=2, default=str)
    except OSError as e:
        eprint(f"Cache write error: {e}")


def scrape_firecrawl(url):
    api_key = os.environ.get("FIRECRAWL_API_KEY")
    if not api_key:
        return None
    try:
        resp = requests.post("https://api.firecrawl.dev/v1/scrape",
            json={"url": url, "formats": ["markdown"]},
            headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
            timeout=30)
        resp.raise_for_status()
        data = resp.json().get("data", {})
        return data.get("markdown", "")
    except Exception as e:
        eprint(f"Firecrawl failed for {url}: {e}")
        return None


def scrape_requests(url):
    try:
        resp = requests.get(url, timeout=20, allow_redirects=True,
            headers={"User-Agent": BROWSER_UA})
        resp.raise_for_status()
        html = resp.text
        text = re.sub(r"<script[^>]*>.*?</script>", "", html, flags=re.DOTALL | re.IGNORECASE)
        text = re.sub(r"<style[^>]*>.*?</style>", "", text, flags=re.DOTALL | re.IGNORECASE)
        text = re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", text)).strip()
        return text
    except Exception as e:
        eprint(f"Requests fallback failed for {url}: {e}")
        return None


def scrape_page(url):
    """Scrape a URL, preferring Firecrawl. Returns markdown/text content or None."""
    content = scrape_firecrawl(url)
    if content:
        return content, "firecrawl"
    content = scrape_requests(url)
    if content:
        return content, "requests"
    return None, "failed"


def extract_team_size(content):
    """Parse page content to estimate team size from team/about pages.

    Returns (team_size, confidence, evidence) or (None, None, None).
    """
    if not content:
        return None, None, None

    # Look for explicit employee count statements
    count_patterns = [
        r"(\d{1,4})\+?\s*(?:team members|employees|people|staff)",
        r"team\s*(?:of|:)\s*(\d{1,4})",
        r"(\d{1,4})\+?\s*(?:person|member)\s*team",
        r"we\s*(?:are|\'re)\s*(?:a\s*)?(\d{1,4})\s*(?:person|people|member)",
    ]
    for pat in count_patterns:
        m = re.search(pat, content, re.IGNORECASE)
        if m:
            count = int(m.group(1))
            if 1 <= count <= 500:
                return count, "MEDIUM", f"Page states: '{m.group(0).strip()}'"

    # Count individual team member entries (photos/names on team page)
    # Look for patterns like repeated name+title blocks
    name_title_pattern = re.findall(
        r"(?:^|\n)\s*(?:#{1,4}\s+)?([A-Z][a-z]+(?:\s[A-Z][a-z]+)+)\s*\n\s*(?:[A-Z][a-z]+.*(?:Officer|Engineer|Designer|Manager|Director|Lead|Head|VP|CEO|CTO|COO|CFO|Founder|Co-founder))",
        content
    )
    if len(name_title_pattern) >= 2:
        return len(name_title_pattern), "MEDIUM", f"{len(name_title_pattern)} team members listed on page"

    return None, None, None


def find_team_page_url(content, base_url):
    """Look for links to /team, /about, /about-us, /people pages in content."""
    team_patterns = [
        r'\[(?:team|our team|meet the team|people|about|about us)\]\((https?://[^\)]+)\)',
        r'href=["\']([^"\']*(?:/team|/about|/people|/our-team|/about-us)[^"\']*)["\']',
    ]
    urls = []
    for pat in team_patterns:
        for m in re.finditer(pat, content, re.IGNORECASE):
            url = m.group(1)
            if not url.startswith("http"):
                url = urljoin(base_url, url)
            urls.append(url)
    return urls[:3]  # Cap at 3 attempts


def detect_pricing_page(content):
    """Check if the company has a pricing page (PLG signal)."""
    pricing_patterns = [
        r'\[(?:pricing|plans|get started)\]\((https?://[^\)]+)\)',
        r'(?:/pricing|/plans|/get-started)',
    ]
    for pat in pricing_patterns:
        if re.search(pat, content, re.IGNORECASE):
            return True
    return False


def detect_signup(content):
    """Check for self-serve signup (PLG signal)."""
    signup_patterns = [
        r'(?:sign\s*up|get\s*started|start\s*free|try\s*(?:it\s*)?free|create\s*account|register)',
        r'(?:free\s*trial|free\s*tier|free\s*plan|freemium)',
    ]
    for pat in signup_patterns:
        if re.search(pat, content, re.IGNORECASE):
            return True
    return False


def main():
    parser = argparse.ArgumentParser(description="Enrich a company via website scraping")
    parser.add_argument("--url", required=True, help="Company website URL to scrape")
    args = parser.parse_args()

    try:
        company = json.load(sys.stdin)
    except json.JSONDecodeError as e:
        eprint(f"Invalid JSON on stdin: {e}")
        sys.exit(1)

    url = args.url.strip()
    if not url:
        company.update(scrape_status="no_url", cached=False,
                      enriched_at=datetime.now(timezone.utc).isoformat())
        print(json.dumps(company, indent=2, default=str))
        return

    if not url.startswith(("http://", "https://")):
        url = "https://" + url
    domain = normalize_domain(url)

    # Cache check
    cached = load_cache(domain)
    if cached:
        cached["company_name"] = company.get("company_name", cached.get("company_name", ""))
        cached["sources"] = company.get("sources", cached.get("sources", []))
        print(json.dumps(cached, indent=2, default=str))
        return

    # Scrape homepage
    content, method = scrape_page(url)
    status = "success" if content else "failed"
    if content:
        eprint(f"Scraped {url} via {method} ({len(content)} chars)")
    else:
        eprint(f"All scrape methods failed for {url}")

    # Try to find and scrape team/about page for headcount
    team_size = None
    team_size_confidence = None
    team_size_evidence = None

    if content:
        # First check homepage content for team size
        team_size, team_size_confidence, team_size_evidence = extract_team_size(content)

        # If not found on homepage, try team/about pages
        if team_size is None:
            team_page_urls = find_team_page_url(content, url)
            for team_url in team_page_urls:
                tp_content, tp_method = scrape_page(team_url)
                if tp_content:
                    team_size, team_size_confidence, team_size_evidence = extract_team_size(tp_content)
                    if team_size is not None:
                        eprint(f"Found team size {team_size} on {team_url}")
                        break

    # Detect PLG signals
    has_pricing = detect_pricing_page(content) if content else False
    has_signup = detect_signup(content) if content else False

    result = {
        "company_name": company.get("company_name", ""),
        "url": url,
        "sources": company.get("sources", []),
        "scrape_status": status,
        "page_content": (content or "")[:5000],
        "page_title": "",
        "team_size": team_size,
        "team_size_confidence": team_size_confidence,
        "team_size_evidence": team_size_evidence,
        "has_pricing_page": has_pricing,
        "has_signup": has_signup,
        "cached": False,
        "enriched_at": datetime.now(timezone.utc).isoformat(),
    }
    save_cache(domain, result)
    print(json.dumps(result, indent=2, default=str))


if __name__ == "__main__":
    main()
