"""LinkedIn profile finder — Google search for founder LinkedIn URLs.

Tier 4 (runs after key people are discovered in Tiers 1-2).
Uses Google search to find LinkedIn profile URLs for each key person.
No LinkedIn scraping — only extracts the URL from Google results.
"""

import re
import sys
from urllib.parse import quote_plus

import requests

from .registry import register
from .schema import EnrichmentContext

eprint = lambda *a, **kw: print(*a, file=sys.stderr, **kw)

HEADERS = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"}

LINKEDIN_PROFILE_RE = re.compile(
    r'https?://(?:www\.)?linkedin\.com/in/([a-zA-Z0-9_-]+)',
)


def _google_search_linkedin(person_name: str, company_name: str) -> str | None:
    """Search Google for a person's LinkedIn profile URL.

    Returns the first linkedin.com/in/ URL found, or None.
    """
    query = f'"{person_name}" "{company_name}" site:linkedin.com/in'
    url = f"https://www.google.com/search?q={quote_plus(query)}&num=5&hl=en"

    try:
        resp = requests.get(url, headers=HEADERS, timeout=10)
        resp.raise_for_status()

        # Extract LinkedIn URLs from Google results HTML
        matches = LINKEDIN_PROFILE_RE.findall(resp.text)
        if matches:
            # Return the first unique profile URL
            profile_slug = matches[0]
            linkedin_url = f"https://www.linkedin.com/in/{profile_slug}"
            eprint(f"    Found LinkedIn for {person_name}: {linkedin_url}")
            return linkedin_url

    except Exception as e:
        eprint(f"    LinkedIn search failed for {person_name}: {e}")

    return None


@register("linkedin_finder", tier=4)
def linkedin_finder(ctx: EnrichmentContext) -> dict:
    """Find LinkedIn profile URLs for discovered key people."""
    result = ctx.get("result", {})
    key_people = result.get("keyPeople", [])
    company_name = ctx.get("name", "")

    if not key_people or not company_name:
        return {}

    updated_people = []
    any_updated = False

    for person in key_people:
        # Skip if already has a LinkedIn URL
        if person.get("linkedinUrl"):
            continue

        name = person.get("name", "")
        if not name:
            continue

        linkedin_url = _google_search_linkedin(name, company_name)
        if linkedin_url:
            person["linkedinUrl"] = linkedin_url
            any_updated = True
            updated_people.append(name)

    if updated_people:
        eprint(f"  [linkedin_finder] Found {len(updated_people)} LinkedIn profiles")
        # Return the full updated keyPeople list so merge_result replaces it
        return {"keyPeople": key_people}

    eprint(f"  [linkedin_finder] No LinkedIn profiles found for {len(key_people)} people")
    return {}
