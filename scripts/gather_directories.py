#!/usr/bin/env python3
"""Config-driven directory scraper.

Reads references/directories.yaml and scrapes each configured directory
to add companies to the SQLite prospect pool.  Supports multiple scrape
methods (firecrawl, static HTML, JSON API, CSV, browser) and pagination.
"""

import argparse
import csv
import io
import os
import re
import sys
import time
from datetime import datetime, timezone
from urllib.parse import urlparse

import requests
import yaml

try:
    from dotenv import load_dotenv

    env_path = os.path.join(os.path.dirname(__file__), os.pardir, ".env")
    load_dotenv(dotenv_path=env_path)
except ImportError:
    pass

from pool_db import get_db, upsert_company, make_key, normalize_domain

YAML_PATH = os.path.join(
    os.path.dirname(os.path.abspath(__file__)), os.pardir, "references", "directories.yaml"
)
FIRECRAWL_SCRAPE_URL = "https://api.firecrawl.dev/v1/scrape"

# ---------------------------------------------------------------------------
# Simple CSS-selector-like HTML extraction
# ---------------------------------------------------------------------------

def extract_by_selector(html, selector):
    """Extract text or attribute from HTML using a simple CSS-like selector.

    Supports:
    - ".class-name"         -> elements with this class, return text content
    - ".class-name@href"    -> elements with this class, return href attribute
    - "#id"                 -> element with this id, return text content
    - "tag.class"           -> tag with class
    - "tag"                 -> all matching tags, return text content
    - "tag@attr"            -> all matching tags, return specified attribute
    """
    attr = None
    if "@" in selector:
        selector, attr = selector.rsplit("@", 1)

    if selector.startswith("#"):
        id_val = selector[1:]
        pattern = re.compile(
            r'<[^>]+\bid=["\']' + re.escape(id_val) + r'["\'][^>]*>(.*?)</[^>]+>',
            re.DOTALL | re.IGNORECASE,
        )
    elif "." in selector:
        parts = selector.split(".", 1)
        tag = parts[0] or r"[a-z]\w*"
        cls = parts[1]
        pattern = re.compile(
            r"<" + tag + r'[^>]*\bclass=["\'][^"\']*\b'
            + re.escape(cls)
            + r'\b[^"\']*["\'][^>]*>(.*?)</' + tag + r">",
            re.DOTALL | re.IGNORECASE,
        )
    else:
        tag = selector
        pattern = re.compile(
            r"<" + re.escape(tag) + r"[^>]*>(.*?)</" + re.escape(tag) + r">",
            re.DOTALL | re.IGNORECASE,
        )

    if attr:
        # Re-search for the attribute value within the matched elements
        attr_pattern = re.compile(
            r'\b' + re.escape(attr) + r'=["\']([^"\']+)["\']', re.IGNORECASE
        )
        # Search in the full tag (including attributes), not just inner text
        if selector.startswith("#"):
            id_val = selector[1:]
            tag_pattern = re.compile(
                r'<[^>]+\bid=["\']' + re.escape(id_val) + r'["\'][^>]*>',
                re.DOTALL | re.IGNORECASE,
            )
        elif "." in selector:
            parts = selector.split(".", 1)
            tag = parts[0] or r"[a-z]\w*"
            cls = parts[1]
            tag_pattern = re.compile(
                r"<" + tag + r'[^>]*\bclass=["\'][^"\']*\b'
                + re.escape(cls) + r'\b[^"\']*["\'][^>]*>',
                re.DOTALL | re.IGNORECASE,
            )
        else:
            tag_pattern = re.compile(
                r"<" + re.escape(selector) + r"[^>]*>",
                re.DOTALL | re.IGNORECASE,
            )
        results = []
        for m in tag_pattern.finditer(html):
            am = attr_pattern.search(m.group(0))
            if am:
                results.append(am.group(1))
        return results

    # Return inner-text (strip nested tags)
    results = []
    for m in pattern.finditer(html):
        inner = m.group(1)
        text = re.sub(r"<[^>]+>", "", inner).strip()
        if text:
            results.append(text)
    return results


def _strip_html(text):
    """Remove HTML tags and decode common entities."""
    text = re.sub(r"<[^>]+>", "", text)
    for entity, char in [("&amp;", "&"), ("&lt;", "<"), ("&gt;", ">"),
                         ("&quot;", '"'), ("&#39;", "'"), ("&nbsp;", " ")]:
        text = text.replace(entity, char)
    return text.strip()


# ---------------------------------------------------------------------------
# Scraper methods
# ---------------------------------------------------------------------------

def scrape_firecrawl(url, config):
    """Scrape via Firecrawl API. Returns list of company dicts."""
    api_key = os.environ.get("FIRECRAWL_API_KEY", "").strip()
    if not api_key:
        print("  FIRECRAWL_API_KEY not set — skipping firecrawl scrape", file=sys.stderr)
        return []

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    payload = {"url": url, "formats": ["html"]}

    resp = requests.post(FIRECRAWL_SCRAPE_URL, json=payload, headers=headers, timeout=90)
    resp.raise_for_status()
    data = resp.json()

    global _firecrawl_credits_used
    _firecrawl_credits_used += 1

    if not data.get("success"):
        print(f"  Firecrawl returned failure for {url}", file=sys.stderr)
        return []

    html = data.get("data", {}).get("html", "")
    if not html:
        return []

    return _extract_companies_from_html(html, config)


def scrape_static_html(url, config):
    """Scrape server-rendered pages with plain requests."""
    headers = {
        "User-Agent": (
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
            "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        ),
    }
    resp = requests.get(url, headers=headers, timeout=30)
    resp.raise_for_status()
    return _extract_companies_from_html(resp.text, config)


def scrape_api(url, config):
    """Query a JSON API endpoint and extract companies."""
    resp = requests.get(url, timeout=30)
    resp.raise_for_status()
    data = resp.json()

    field_mapping = config.get("field_mapping", {})
    results_path = field_mapping.get("results_path", "")

    # Navigate to the results list
    items = data
    if results_path:
        for key in results_path.split("."):
            if isinstance(items, dict):
                items = items.get(key, [])
            elif isinstance(items, list) and key.isdigit():
                items = items[int(key)]

    if not isinstance(items, list):
        items = [items]

    companies = []
    name_field = field_mapping.get("name", "name")
    url_field = field_mapping.get("url", "url")
    desc_field = field_mapping.get("description", "description")

    for item in items:
        if not isinstance(item, dict):
            continue
        name = _resolve_json_path(item, name_field)
        company_url = _resolve_json_path(item, url_field)
        description = _resolve_json_path(item, desc_field)
        if name:
            companies.append({
                "name": str(name),
                "url": str(company_url) if company_url else None,
                "description": str(description) if description else "",
            })
    return companies


def scrape_csv(url, config):
    """Download and parse a CSV/XLSX file."""
    resp = requests.get(url, timeout=30)
    resp.raise_for_status()

    field_mapping = config.get("field_mapping", {})
    name_col = field_mapping.get("name", "name")
    url_col = field_mapping.get("url", "url")
    desc_col = field_mapping.get("description", "description")

    # Detect format
    content_type = resp.headers.get("Content-Type", "")
    if url.endswith(".xlsx") or "spreadsheet" in content_type:
        # Write to temp file for xlsx — requires openpyxl which we don't mandate
        print("  XLSX format detected — not supported without openpyxl", file=sys.stderr)
        return []

    # Parse as CSV
    text = resp.text
    reader = csv.DictReader(io.StringIO(text))
    companies = []
    for row in reader:
        name = row.get(name_col, "").strip()
        if not name:
            continue
        companies.append({
            "name": name,
            "url": row.get(url_col, "").strip() or None,
            "description": row.get(desc_col, "").strip() or "",
        })
    return companies


def scrape_browser(url, config):
    """Placeholder for browser-based scraping (handled by SKILL.md orchestration)."""
    print(f"  {config.get('label', url)}: requires browser scraping — skipping in batch mode", file=sys.stderr)
    return []


SCRAPE_DISPATCH = {
    "firecrawl": scrape_firecrawl,
    "static_html": scrape_static_html,
    "api": scrape_api,
    "csv": scrape_csv,
    "browser": scrape_browser,
}


# ---------------------------------------------------------------------------
# HTML company extraction helpers
# ---------------------------------------------------------------------------

def _extract_companies_from_html(html, config):
    """Extract companies from HTML using field_mapping selectors."""
    field_mapping = config.get("field_mapping", {})
    name_sel = field_mapping.get("name", "")
    url_sel = field_mapping.get("url", "")
    desc_sel = field_mapping.get("description", "")

    if not name_sel:
        return _extract_companies_fallback(html)

    names = extract_by_selector(html, name_sel)
    urls = extract_by_selector(html, url_sel) if url_sel else []
    descs = extract_by_selector(html, desc_sel) if desc_sel else []

    companies = []
    for i, name in enumerate(names):
        name = _strip_html(name)
        if not name or len(name) < 2:
            continue
        company_url = urls[i] if i < len(urls) else None
        description = _strip_html(descs[i]) if i < len(descs) else ""
        companies.append({"name": name, "url": company_url, "description": description})
    return companies


def _extract_companies_fallback(html):
    """Fallback: extract companies from links on the page."""
    link_pattern = re.compile(r'<a[^>]+href=["\']([^"\']+)["\'][^>]*>(.*?)</a>', re.DOTALL | re.IGNORECASE)
    companies = []
    seen = set()
    for m in link_pattern.finditer(html):
        url = m.group(1).strip()
        text = _strip_html(m.group(2))
        if not text or len(text) < 2 or len(text) > 80:
            continue
        if not url.startswith("http"):
            continue
        domain = normalize_domain(url)
        if not domain or domain in seen:
            continue
        seen.add(domain)
        companies.append({"name": text, "url": url, "description": ""})
    return companies


def _resolve_json_path(obj, path):
    """Resolve a dotted JSON path like 'data.name' against a dict."""
    if not path:
        return None
    for key in path.split("."):
        if isinstance(obj, dict):
            obj = obj.get(key)
        elif isinstance(obj, list) and key.isdigit():
            idx = int(key)
            obj = obj[idx] if idx < len(obj) else None
        else:
            return None
    return obj


# ---------------------------------------------------------------------------
# Pagination
# ---------------------------------------------------------------------------

def handle_pagination(base_url, config, scrape_fn):
    """Handle paginated directories."""
    pagination = config.get("pagination", {})
    ptype = pagination.get("type", "none")

    if ptype == "none":
        return scrape_fn(base_url, config)
    elif ptype == "query_param":
        param = pagination.get("param_name", "page")
        max_pages = pagination.get("max_pages", 50)
        all_companies = []
        for page in range(1, max_pages + 1):
            sep = "&" if "?" in base_url else "?"
            url = f"{base_url}{sep}{param}={page}"
            companies = scrape_fn(url, config)
            if not companies:
                break
            all_companies.extend(companies)
            time.sleep(1.5)  # Rate limiting
        return all_companies
    elif ptype in ("scroll", "load_more"):
        # These need browser — just scrape the first page
        return scrape_fn(base_url, config)
    else:
        print(f"  Unknown pagination type: {ptype}", file=sys.stderr)
        return scrape_fn(base_url, config)


# ---------------------------------------------------------------------------
# Core pipeline
# ---------------------------------------------------------------------------

_firecrawl_credits_used = 0


def load_config():
    """Load and return the directories.yaml config."""
    with open(YAML_PATH, "r") as f:
        return yaml.safe_load(f)


def should_refresh(directory_config):
    """Check if a directory needs re-scraping based on last_scraped and refresh_interval_days."""
    last_scraped = directory_config.get("last_scraped")
    interval = directory_config.get("refresh_interval_days", 7)
    if not last_scraped:
        return True
    if isinstance(last_scraped, str):
        last_scraped = datetime.fromisoformat(last_scraped)
    if not last_scraped.tzinfo:
        last_scraped = last_scraped.replace(tzinfo=timezone.utc)
    now = datetime.now(timezone.utc)
    return (now - last_scraped).days >= interval


def process_directory(dir_config, conn, dry_run=False):
    """Process a single directory config entry. Returns (extracted, added) counts."""
    label = dir_config.get("label", dir_config.get("name", "unknown"))
    method = dir_config.get("scrape_method", "firecrawl")
    url = dir_config.get("url", "")
    source = f"directory_{dir_config.get('name', 'unknown')}"

    scrape_fn = SCRAPE_DISPATCH.get(method)
    if not scrape_fn:
        print(f"  {label}: unknown scrape_method '{method}' — skipping", file=sys.stderr)
        return 0, 0

    if dry_run:
        print(f"  [dry-run] Would scrape {label} via {method}: {url}", file=sys.stderr)
        return 0, 0

    if not should_refresh(dir_config):
        print(f"  {label}: recently scraped — skipping", file=sys.stderr)
        return 0, 0

    try:
        companies = handle_pagination(url, dir_config, scrape_fn)
    except Exception as exc:
        print(f"  {label}: scrape error: {exc}", file=sys.stderr)
        return 0, 0

    extracted = len(companies)
    added = 0

    for company in companies:
        name = company.get("name", "").strip()
        company_url = company.get("url")
        description = company.get("description", "")

        key = make_key(name, company_url)
        if not key:
            continue

        try:
            upsert_company(
                conn,
                domain=key,
                name=name,
                url=company_url,
                description=description,
                source=source,
                source_data={
                    "directory": dir_config.get("name"),
                    "directory_label": label,
                    "discovered_at": datetime.now(timezone.utc).isoformat(),
                },
            )
            added += 1
        except Exception as exc:
            print(f"  Error upserting {key}: {exc}", file=sys.stderr)

    conn.commit()
    return extracted, added


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main():
    global _firecrawl_credits_used

    parser = argparse.ArgumentParser(
        description="Config-driven directory scraper for the prospect pool."
    )
    parser.add_argument(
        "--wave", type=int, default=None,
        help="Run only directories in a specific wave (default: all enabled)",
    )
    parser.add_argument(
        "--directory", type=str, default=None,
        help="Run a single directory by name",
    )
    parser.add_argument(
        "--list", action="store_true", dest="list_dirs",
        help="List all configured directories and exit",
    )
    parser.add_argument(
        "--dry-run", action="store_true", dest="dry_run",
        help="Show what would be scraped without actually scraping",
    )
    args = parser.parse_args()

    # Load config
    try:
        config = load_config()
    except FileNotFoundError:
        print(f"Config not found: {YAML_PATH}", file=sys.stderr)
        sys.exit(1)
    except yaml.YAMLError as exc:
        print(f"Error parsing {YAML_PATH}: {exc}", file=sys.stderr)
        sys.exit(1)

    directories = config.get("directories", [])

    # --list: show all directories and exit
    if args.list_dirs:
        for d in directories:
            enabled = "enabled" if d.get("enabled", True) else "disabled"
            wave = d.get("wave", "-")
            method = d.get("scrape_method", "?")
            print(
                f"  {d.get('name', '?'):25s} wave={wave}  {method:15s} [{enabled}]  {d.get('label', '')}",
                file=sys.stderr,
            )
        sys.exit(0)

    # Filter directories
    if args.directory:
        dirs = [d for d in directories if d.get("name") == args.directory]
        if not dirs:
            print(f"Unknown directory: {args.directory}", file=sys.stderr)
            print("Available:", ", ".join(d.get("name", "?") for d in directories), file=sys.stderr)
            sys.exit(1)
    elif args.wave is not None:
        dirs = [d for d in directories if d.get("enabled", True) and d.get("wave") == args.wave]
    else:
        dirs = [d for d in directories if d.get("enabled", True)]

    if not dirs:
        print("No directories matched the given filters.", file=sys.stderr)
        sys.exit(0)

    conn = get_db()
    grand_extracted = 0
    grand_added = 0
    results = []

    for dir_config in dirs:
        label = dir_config.get("label", dir_config.get("name", "unknown"))
        print(f"Processing {label}...", file=sys.stderr)
        try:
            extracted, added = process_directory(dir_config, conn, dry_run=args.dry_run)
        except Exception as exc:
            print(f"  FAILED: {exc}", file=sys.stderr)
            extracted, added = 0, 0
        grand_extracted += extracted
        grand_added += added
        results.append((label, extracted, added))
        if extracted > 0:
            print(f"  {label}: {extracted} extracted, {added} added to pool", file=sys.stderr)

    conn.close()

    # Summary
    print(f"\n--- Summary ---", file=sys.stderr)
    for label, extracted, added in results:
        print(f"  {label:30s}  extracted={extracted:4d}  added={added:4d}", file=sys.stderr)
    print(f"  {'TOTAL':30s}  extracted={grand_extracted:4d}  added={grand_added:4d}", file=sys.stderr)
    if _firecrawl_credits_used:
        print(f"  Firecrawl credits used: {_firecrawl_credits_used}", file=sys.stderr)


if __name__ == "__main__":
    main()
