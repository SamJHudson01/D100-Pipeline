#!/usr/bin/env python3
"""Crawl ProductHunt website for trending launches worth prospecting.

Scrapes producthunt.com homepage and /all pages using Firecrawl API (preferred)
or plain requests with a browser User-Agent as fallback.  No OAuth token needed.
"""

import argparse
import json
import os
import re
import sys
from datetime import datetime, timezone

import requests

try:
    from dotenv import load_dotenv

    env_path = os.path.join(os.path.dirname(__file__), os.pardir, ".env")
    load_dotenv(dotenv_path=env_path)
except ImportError:
    pass

FIRECRAWL_SCRAPE_URL = "https://api.firecrawl.dev/v1/scrape"
PH_HOME_URL = "https://www.producthunt.com/"
PH_ALL_URL = "https://www.producthunt.com/all"
MAX_RESULTS = 30

BROWSER_UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
)


# ---------------------------------------------------------------------------
# Scraping helpers
# ---------------------------------------------------------------------------

def _scrape_firecrawl(url, api_key):
    """Scrape a URL via Firecrawl API and return markdown text."""
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    payload = {"url": url, "formats": ["markdown"]}

    resp = requests.post(FIRECRAWL_SCRAPE_URL, json=payload, headers=headers, timeout=60)
    resp.raise_for_status()
    data = resp.json()

    if not data.get("success"):
        raise RuntimeError(f"Firecrawl scrape failed for {url}: {data}")

    return data.get("data", {}).get("markdown", "")


def _scrape_requests(url):
    """Scrape a URL with plain requests and a browser User-Agent."""
    headers = {"User-Agent": BROWSER_UA}
    resp = requests.get(url, headers=headers, timeout=30)
    resp.raise_for_status()
    return resp.text


def scrape_page(url, api_key=None):
    """Scrape a page, preferring Firecrawl when an API key is available.

    Returns the page content as a string (markdown from Firecrawl, or raw HTML).
    """
    if api_key:
        try:
            return _scrape_firecrawl(url, api_key), "firecrawl"
        except Exception as exc:
            print(f"Firecrawl failed for {url}, falling back to requests: {exc}", file=sys.stderr)

    return _scrape_requests(url), "requests"


# ---------------------------------------------------------------------------
# Parsing helpers
# ---------------------------------------------------------------------------

def _parse_markdown(md_text):
    """Parse Firecrawl markdown output to extract product listings.

    ProductHunt markdown from Firecrawl typically contains lines like:
      [Product Name](https://www.producthunt.com/posts/product-slug)
      Tagline text
      123 (vote count)

    We look for PH post links and gather surrounding context.
    """
    products = []
    seen_slugs = set()

    # Find all producthunt.com product links (both /posts/ and /products/)
    link_pattern = re.compile(
        r'\[([^\]]+)\]\((https?://(?:www\.)?producthunt\.com/(?:posts|products)/[a-zA-Z0-9_-]+)\)'
    )

    lines = md_text.split("\n")

    for i, line in enumerate(lines):
        for match in link_pattern.finditer(line):
            name = match.group(1).strip()
            ph_url = match.group(2).strip()

            # Deduplicate by slug
            slug = ph_url.rstrip("/").split("/")[-1]
            if slug in seen_slugs:
                continue
            seen_slugs.add(slug)

            # Strip rank prefix like "1\. " or "12\. "
            name = re.sub(r'^\d+\\?\.\s*', '', name).strip()

            # Skip navigation / non-product links
            if name.lower() in ("", "view", "visit", "website", "more", "see all"):
                continue

            # Check if tagline is appended after the link on the same line
            # e.g., [1\. Product](url)Your AI analyst for business performance
            tagline = ""
            after_link = line[match.end():].strip()
            if after_link and len(after_link) > 5 and not after_link.startswith("["):
                tagline = after_link

            votes = 0
            website_url = ""
            topics = []
            standalone_numbers = []

            context_lines = lines[i + 1: i + 10]
            for ctx_line in context_lines:
                ctx = ctx_line.strip()
                if not ctx:
                    continue

                # Topic links: [Topic](producthunt.com/topics/...)
                topic_matches = re.findall(r'\[([^\]]+)\]\(https?://(?:www\.)?producthunt\.com/topics/', ctx)
                if topic_matches:
                    topics.extend(topic_matches)
                    continue

                # Standalone number (could be comments or votes)
                if re.match(r'^\d+$', ctx):
                    standalone_numbers.append(int(ctx))
                    continue

                # Tagline: first non-empty, non-numeric, non-link, non-image line
                if not tagline and not re.match(r'^\[', ctx) and not re.match(r'^!\[', ctx) and not re.match(r'^\d+$', ctx) and len(ctx) > 5:
                    tagline = ctx

            # PH format: two standalone numbers — first is comments, second is votes
            if len(standalone_numbers) >= 2:
                votes = standalone_numbers[1]
            elif len(standalone_numbers) == 1:
                votes = standalone_numbers[0]

            products.append({
                "source": "producthunt",
                "company_name": name,
                "url": website_url or ph_url,
                "ph_url": ph_url,
                "tagline": tagline,
                "votes": votes,
                "maker_name": None,
                "maker_twitter": None,
                "topics": topics,
                "discovered_at": datetime.now(timezone.utc).isoformat(),
            })

    return products


def _parse_html(html_text):
    """Parse raw HTML from ProductHunt to extract product listings.

    Falls back to regex-based extraction when Firecrawl is unavailable.
    """
    products = []
    seen_slugs = set()

    # Find product post links: /posts/product-slug
    link_pattern = re.compile(
        r'href="(/posts/([a-zA-Z0-9_-]+))"'
    )

    for match in link_pattern.finditer(html_text):
        path = match.group(1)
        slug = match.group(2)

        if slug in seen_slugs:
            continue
        seen_slugs.add(slug)

        ph_url = f"https://www.producthunt.com{path}"

        # Try to extract the product name from nearby context
        # Look for data attributes or text near the link
        name = slug.replace("-", " ").title()

        # Try to find a title attribute or aria-label
        before_context = html_text[max(0, match.start() - 500):match.start()]
        after_context = html_text[match.end():match.end() + 500]

        # Look for title/aria-label
        title_match = re.search(r'(?:title|aria-label)="([^"]+)"', before_context + after_context)
        if title_match:
            candidate = title_match.group(1).strip()
            if len(candidate) > 1 and len(candidate) < 100:
                name = candidate

        # Look for vote counts nearby
        votes = 0
        vote_match = re.search(r'(\d+)\s*(?:upvote|vote)', after_context, re.IGNORECASE)
        if vote_match:
            votes = int(vote_match.group(1))
        else:
            # Look for standalone numbers that could be votes
            num_match = re.search(r'>(\d{1,5})<', after_context)
            if num_match:
                votes = int(num_match.group(1))

        # Look for tagline
        tagline = ""
        tagline_match = re.search(r'<(?:p|span|div)[^>]*>([^<]{10,200})</(?:p|span|div)>', after_context)
        if tagline_match:
            tagline = tagline_match.group(1).strip()

        products.append({
            "source": "producthunt",
            "company_name": name,
            "url": ph_url,
            "ph_url": ph_url,
            "tagline": tagline,
            "votes": votes,
            "maker_name": None,
            "maker_twitter": None,
            "topics": [],
            "discovered_at": datetime.now(timezone.utc).isoformat(),
        })

    return products


def parse_content(content, source_type):
    """Route to the appropriate parser based on how the content was fetched."""
    if source_type == "firecrawl":
        return _parse_markdown(content)
    else:
        return _parse_html(content)


# ---------------------------------------------------------------------------
# Main logic
# ---------------------------------------------------------------------------

def fetch_products(api_key=None, pages=3):
    """Scrape ProductHunt homepage and /all pages, return product records."""
    all_products = []
    seen_slugs = set()

    urls = [PH_HOME_URL]
    for page_num in range(1, pages + 1):
        url = PH_ALL_URL if page_num == 1 else f"{PH_ALL_URL}?page={page_num}"
        if url not in urls:
            urls.append(url)

    for url in urls:
        try:
            content, source_type = scrape_page(url, api_key=api_key)
        except Exception as exc:
            print(f"Error scraping {url}: {exc}", file=sys.stderr)
            continue

        products = parse_content(content, source_type)

        for p in products:
            slug = p["ph_url"].rstrip("/").split("/")[-1]
            if slug not in seen_slugs:
                seen_slugs.add(slug)
                all_products.append(p)

    # Sort by votes descending
    all_products.sort(key=lambda r: r["votes"], reverse=True)
    return all_products[:MAX_RESULTS]


def main():
    parser = argparse.ArgumentParser(description="Gather trending ProductHunt launches for prospecting.")
    parser.add_argument(
        "--days", type=int, default=7,
        help="Look-back window hint (crawling only sees currently visible pages; default: 7)",
    )
    parser.add_argument(
        "--pages", type=int, default=3,
        help="Number of /all pages to scrape (default: 3)",
    )
    args = parser.parse_args()

    api_key = os.environ.get("FIRECRAWL_API_KEY", "").strip() or None

    if not api_key:
        print("FIRECRAWL_API_KEY not set — will use requests fallback.", file=sys.stderr)

    try:
        results = fetch_products(api_key=api_key, pages=args.pages)
    except Exception as exc:
        print(f"Error gathering ProductHunt data: {exc}", file=sys.stderr)
        sys.exit(1)

    json.dump(results, sys.stdout, indent=2, ensure_ascii=False)
    print()  # trailing newline


if __name__ == "__main__":
    main()
