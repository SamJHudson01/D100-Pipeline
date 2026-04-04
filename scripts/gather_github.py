#!/usr/bin/env python3
"""Query GitHub API for recently created orgs that might be startups worth prospecting."""

import argparse
import json
import os
import sys
from datetime import datetime, timedelta, timezone

try:
    from dotenv import load_dotenv

    env_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".env")
    load_dotenv(env_path)
except ImportError:
    pass

import requests

SEARCH_URL = "https://api.github.com/search/repositories"
MAX_RESULTS = 50


def build_headers():
    headers = {"Accept": "application/vnd.github+json"}
    token = os.environ.get("GITHUB_TOKEN")
    if token:
        headers["Authorization"] = f"Bearer {token}"
    return headers


def check_rate_limit(response):
    remaining = response.headers.get("X-RateLimit-Remaining")
    if remaining is not None and int(remaining) < 5:
        print(
            f"Rate limit nearly exhausted ({remaining} remaining). Stopping.",
            file=sys.stderr,
        )
        return False
    return True


def search_repos(headers, days, min_stars):
    """Search for recently created repos with some traction and a homepage set."""
    since = (datetime.now(timezone.utc) - timedelta(days=days)).strftime("%Y-%m-%d")
    query = f"created:>={since} stars:{min_stars}..100"

    repos = []
    page = 1
    per_page = 30

    while len(repos) < MAX_RESULTS:
        params = {
            "q": query,
            "sort": "stars",
            "order": "desc",
            "per_page": per_page,
            "page": page,
        }
        try:
            resp = requests.get(SEARCH_URL, headers=headers, params=params, timeout=15)
            resp.raise_for_status()
        except requests.RequestException as e:
            print(f"Search request failed: {e}", file=sys.stderr)
            break

        if not check_rate_limit(resp):
            break

        data = resp.json()
        items = data.get("items", [])
        if not items:
            break

        repos.extend(items)
        page += 1

        if len(items) < per_page:
            break

    return repos[:MAX_RESULTS]


def fetch_org(org_login, headers):
    """Fetch organization details."""
    url = f"https://api.github.com/orgs/{org_login}"
    try:
        resp = requests.get(url, headers=headers, timeout=10)
        if resp.status_code == 404:
            return None
        resp.raise_for_status()
        if not check_rate_limit(resp):
            return None
        return resp.json()
    except requests.RequestException as e:
        print(f"Failed to fetch org {org_login}: {e}", file=sys.stderr)
        return None


def fetch_public_member_count(org_login, headers):
    """Get public member count via the members endpoint."""
    url = f"https://api.github.com/orgs/{org_login}/public_members"
    try:
        resp = requests.get(
            url, headers=headers, params={"per_page": 1}, timeout=10
        )
        if resp.status_code != 200:
            return 0
        # GitHub returns member count info via pagination; parse Link header or just count
        # For simplicity, use a per_page=1 request and check the last page from Link header
        link = resp.headers.get("Link", "")
        if 'rel="last"' in link:
            # Extract last page number
            for part in link.split(","):
                if 'rel="last"' in part:
                    page_num = part.split("page=")[-1].split(">")[0]
                    return int(page_num)
        return len(resp.json())
    except (requests.RequestException, ValueError):
        return 0


def gather(days, min_stars):
    headers = build_headers()
    now = datetime.now(timezone.utc).isoformat()

    repos = search_repos(headers, days, min_stars)

    seen_orgs = {}
    results = []

    for repo in repos:
        owner = repo.get("owner", {})
        if owner.get("type") != "Organization":
            continue

        org_login = owner.get("login")
        if not org_login or org_login in seen_orgs:
            continue

        homepage = repo.get("homepage") or ""
        if not homepage:
            continue

        org_data = fetch_org(org_login, headers)
        if org_data is None:
            continue

        website = org_data.get("blog") or homepage
        member_count = fetch_public_member_count(org_login, headers)

        entry = {
            "source": "github",
            "company_name": org_data.get("name") or org_login,
            "url": website,
            "github_url": f"https://github.com/{org_login}",
            "description": org_data.get("description") or repo.get("description") or "",
            "public_members": member_count,
            "public_repos": org_data.get("public_repos", 0),
            "primary_language": repo.get("language") or "",
            "created_at": org_data.get("created_at", ""),
            "discovered_at": now,
        }

        seen_orgs[org_login] = True
        results.append(entry)

        if len(results) >= MAX_RESULTS:
            break

    return results


def main():
    parser = argparse.ArgumentParser(
        description="Find recently created GitHub orgs that may be startups."
    )
    parser.add_argument(
        "--days", type=int, default=30, help="Look back N days (default: 30)"
    )
    parser.add_argument(
        "--min-stars", type=int, default=5, help="Minimum stars (default: 5)"
    )
    args = parser.parse_args()

    results = gather(args.days, args.min_stars)
    json.dump(results, sys.stdout, indent=2)
    print(file=sys.stdout)


if __name__ == "__main__":
    main()
