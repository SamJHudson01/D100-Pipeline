#!/usr/bin/env python3
"""Enrich a company by checking public ATS (Applicant Tracking System) boards.

Checks Greenhouse, Lever, and Ashby for public job boards associated with
a company, extracts all open roles, and categorizes them.  This is the single
most valuable enrichment for detecting "growth hire absence."

All three platforms expose free, public, no-auth APIs.
"""
import argparse, hashlib, json, os, re, sys
from datetime import datetime, timezone, timedelta

try:
    from dotenv import load_dotenv
    load_dotenv(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".env"))
except ImportError:
    pass

import requests

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
CACHE_DIR = os.path.join(SCRIPT_DIR, "..", "prospects", "cache", "ats")
CACHE_MAX_AGE = timedelta(days=7)
REQUEST_TIMEOUT = 10

# Suffixes to strip when deriving slugs from company names
COMPANY_SUFFIXES = re.compile(
    r"\s*,?\s*\b(inc|llc|ltd|co|corp|corporation|incorporated|limited|lp|plc|gmbh|ag|sa|sas|srl|pty)\b\.?\s*$",
    re.IGNORECASE,
)

# ---------------------------------------------------------------------------
# Role categorisation keywords
# ---------------------------------------------------------------------------

GROWTH_MARKETING_KEYWORDS = [
    "growth", "marketing", "demand gen", "cmo", "content marketing",
    "seo", "paid acquisition", "performance marketing", "brand",
    "communications", "pr", "social media",
]

ENGINEERING_KEYWORDS = ["engineer", "developer", "sre", "devops", "architect"]

PRODUCT_KEYWORDS = ["product manager", "product designer", "ux", "ui"]

SALES_KEYWORDS = [
    "sales", "account executive", "sdr", "bdr", "account manager",
]

eprint = lambda *a, **kw: print(*a, file=sys.stderr, **kw)


# ---------------------------------------------------------------------------
# Cache helpers
# ---------------------------------------------------------------------------

def _cache_key(domain_slug):
    return hashlib.sha256(domain_slug.encode()).hexdigest()


def _cache_path(domain_slug):
    os.makedirs(CACHE_DIR, exist_ok=True)
    return os.path.join(CACHE_DIR, f"{_cache_key(domain_slug)}.json")


def load_cache(domain_slug):
    path = _cache_path(domain_slug)
    if not os.path.exists(path):
        return None
    try:
        with open(path) as f:
            data = json.load(f)
        ts = datetime.fromisoformat(data.get("checked_at", "2000-01-01T00:00:00+00:00"))
        if datetime.now(timezone.utc) - ts < CACHE_MAX_AGE:
            eprint(f"ATS cache hit for {domain_slug}")
            return data
    except (json.JSONDecodeError, ValueError, OSError) as e:
        eprint(f"ATS cache read error: {e}")
    return None


def save_cache(domain_slug, result):
    path = _cache_path(domain_slug)
    try:
        with open(path, "w") as f:
            json.dump(result, f, indent=2, default=str)
    except OSError as e:
        eprint(f"ATS cache write error: {e}")


# ---------------------------------------------------------------------------
# Slug derivation
# ---------------------------------------------------------------------------

def derive_slugs(company_name, url=None):
    """Return a list of candidate board slugs to try (deduplicated, order preserved)."""
    slugs = []

    # From company name: lowercase, strip suffixes, spaces -> hyphens
    cleaned = COMPANY_SUFFIXES.sub("", company_name)
    name_slug = re.sub(r"[^a-z0-9]+", "-", cleaned.lower()).strip("-")
    if name_slug:
        slugs.append(name_slug)

    # From URL: domain without TLD
    if url:
        domain = url.lower().strip()
        if not domain.startswith(("http://", "https://")):
            domain = "https://" + domain
        from urllib.parse import urlparse
        netloc = urlparse(domain).netloc.removeprefix("www.")
        # domain without TLD: "acme.com" -> "acme", "app.acme.io" -> "app-acme"
        parts = netloc.rsplit(".", 1)[0] if "." in netloc else netloc
        domain_slug = re.sub(r"[^a-z0-9]+", "-", parts).strip("-")
        if domain_slug and domain_slug not in slugs:
            slugs.append(domain_slug)

    # Also try the full domain without any dots as a slug variant
    if url:
        bare = re.sub(r"[^a-z0-9]+", "", netloc.rsplit(".", 1)[0]) if "." in netloc else netloc
        if bare and bare not in slugs:
            slugs.append(bare)

    return slugs


# ---------------------------------------------------------------------------
# ATS platform checks
# ---------------------------------------------------------------------------

def check_greenhouse(slug):
    """Check Greenhouse boards API. Returns (jobs_list, board_url) or (None, None)."""
    board_url = f"https://boards-api.greenhouse.io/v1/boards/{slug}/jobs"
    try:
        resp = requests.get(board_url, timeout=REQUEST_TIMEOUT)
        if resp.status_code == 200:
            data = resp.json()
            jobs = data.get("jobs", [])
            titles = [j.get("title", "") for j in jobs if j.get("title")]
            return titles, board_url
    except Exception as e:
        eprint(f"Greenhouse check failed for {slug}: {e}")
    return None, None


def check_lever(slug):
    """Check Lever postings API. Returns (jobs_list, board_url) or (None, None)."""
    board_url = f"https://api.lever.co/v0/postings/{slug}"
    try:
        resp = requests.get(board_url, timeout=REQUEST_TIMEOUT)
        if resp.status_code == 200:
            data = resp.json()
            if isinstance(data, list):
                titles = [j.get("text", "") for j in data if j.get("text")]
                return titles, board_url
    except Exception as e:
        eprint(f"Lever check failed for {slug}: {e}")
    return None, None


def check_ashby(slug):
    """Check Ashby posting API. Returns (jobs_list, board_url) or (None, None)."""
    board_url = f"https://api.ashbyhq.com/posting-api/job-board/{slug}"
    try:
        resp = requests.get(board_url, timeout=REQUEST_TIMEOUT)
        if resp.status_code == 200:
            data = resp.json()
            jobs = data.get("jobs", [])
            titles = [j.get("title", "") for j in jobs if j.get("title")]
            return titles, board_url
    except Exception as e:
        eprint(f"Ashby check failed for {slug}: {e}")
    return None, None


ATS_CHECKERS = [
    ("greenhouse", check_greenhouse),
    ("lever", check_lever),
    ("ashby", check_ashby),
]


# ---------------------------------------------------------------------------
# Website source fallback — look for ATS links in page HTML
# ---------------------------------------------------------------------------

ATS_LINK_PATTERNS = [
    ("greenhouse", re.compile(r"boards\.greenhouse\.io/([a-z0-9_-]+)", re.IGNORECASE)),
    ("lever", re.compile(r"jobs\.lever\.co/([a-z0-9_-]+)", re.IGNORECASE)),
    ("ashby", re.compile(r"jobs\.ashbyhq\.com/([a-z0-9_-]+)", re.IGNORECASE)),
]


def check_website_for_ats(url):
    """Scrape the company website looking for ATS board links.

    Returns (platform, slug) or (None, None).
    """
    if not url:
        return None, None
    if not url.startswith(("http://", "https://")):
        url = "https://" + url
    try:
        resp = requests.get(url, timeout=REQUEST_TIMEOUT, allow_redirects=True,
            headers={
                "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                              "AppleWebKit/537.36 (KHTML, like Gecko) "
                              "Chrome/120.0.0.0 Safari/537.36",
            })
        resp.raise_for_status()
        html = resp.text
        for platform, pattern in ATS_LINK_PATTERNS:
            m = pattern.search(html)
            if m:
                return platform, m.group(1).lower()
    except Exception as e:
        eprint(f"Website ATS link check failed for {url}: {e}")
    return None, None


# ---------------------------------------------------------------------------
# Role categorisation
# ---------------------------------------------------------------------------

def _matches(title_lower, keywords):
    return any(kw in title_lower for kw in keywords)


def categorize_roles(titles):
    growth, engineering, product, sales, other = [], [], [], [], []
    for title in titles:
        lower = title.lower()
        if _matches(lower, GROWTH_MARKETING_KEYWORDS):
            growth.append(title)
        elif _matches(lower, ENGINEERING_KEYWORDS):
            engineering.append(title)
        elif _matches(lower, PRODUCT_KEYWORDS):
            product.append(title)
        elif _matches(lower, SALES_KEYWORDS):
            sales.append(title)
        else:
            other.append(title)
    return growth, engineering, product, sales, other


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def _empty_result():
    return {
        "ats_platform": None,
        "board_slug": None,
        "board_url": None,
        "total_roles": 0,
        "roles": [],
        "growth_marketing_roles": [],
        "engineering_roles": [],
        "product_roles": [],
        "sales_roles": [],
        "has_growth_hire": False,
        "scrape_status": "no_ats_found",
        "checked_at": datetime.now(timezone.utc).isoformat(),
    }


def main():
    parser = argparse.ArgumentParser(description="Enrich a company by checking public ATS job boards")
    parser.add_argument("--company-name", required=True, help="Company name")
    parser.add_argument("--url", default=None, help="Company website URL")
    args = parser.parse_args()

    company_name = args.company_name.strip()
    company_url = args.url.strip() if args.url else None

    # Build a stable cache key from the domain (or company name if no URL)
    if company_url:
        from urllib.parse import urlparse
        raw = company_url if company_url.startswith(("http://", "https://")) else "https://" + company_url
        domain_slug = urlparse(raw).netloc.lower().removeprefix("www.").replace(".", "-")
    else:
        domain_slug = re.sub(r"[^a-z0-9]+", "-", company_name.lower()).strip("-")

    # Cache check
    cached = load_cache(domain_slug)
    if cached:
        print(json.dumps(cached, indent=2, default=str))
        return

    slugs = derive_slugs(company_name, company_url)
    eprint(f"ATS check for '{company_name}' — candidate slugs: {slugs}")

    # Phase 1: try each slug against each ATS platform
    found_platform, found_slug, found_url, found_titles = None, None, None, None

    for slug in slugs:
        for platform, checker in ATS_CHECKERS:
            titles, board_url = checker(slug)
            if titles is not None:
                found_platform = platform
                found_slug = slug
                found_url = board_url
                found_titles = titles
                eprint(f"Found {platform} board for slug '{slug}' — {len(titles)} roles")
                break
        if found_platform:
            break

    # Phase 2: if nothing found yet, check the website HTML for ATS links
    if not found_platform and company_url:
        ws_platform, ws_slug = check_website_for_ats(company_url)
        if ws_platform and ws_slug:
            eprint(f"Found ATS link on website: {ws_platform}/{ws_slug}")
            # Now fetch the actual board via the appropriate checker
            checker = dict(ATS_CHECKERS).get(ws_platform)
            if checker:
                titles, board_url = checker(ws_slug)
                if titles is not None:
                    found_platform = ws_platform
                    found_slug = ws_slug
                    found_url = board_url
                    found_titles = titles

    # Build result
    if not found_platform:
        result = _empty_result()
    else:
        growth, engineering, product, sales, other = categorize_roles(found_titles)
        result = {
            "ats_platform": found_platform,
            "board_slug": found_slug,
            "board_url": found_url,
            "total_roles": len(found_titles),
            "roles": found_titles,
            "growth_marketing_roles": growth,
            "engineering_roles": engineering,
            "product_roles": product,
            "sales_roles": sales,
            "has_growth_hire": len(growth) > 0,
            "scrape_status": "success",
            "checked_at": datetime.now(timezone.utc).isoformat(),
        }

    save_cache(domain_slug, result)
    print(json.dumps(result, indent=2, default=str))


if __name__ == "__main__":
    main()
