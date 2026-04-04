"""Rate limit accounting for external APIs.

Tracks usage in a JSON file. Checks budget before making API calls.
Services: GitHub (5,000/hr), Firecrawl (3/company).
"""

import json
import os
import sys
from datetime import datetime, timezone, timedelta

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
RATE_FILE = os.path.join(SCRIPT_DIR, "..", "..", "prospects", "rate_limits.json")

eprint = lambda *a, **kw: print(*a, file=sys.stderr, **kw)

# Limits per service
LIMITS = {
    "github": {"max": 5000, "window": "hour"},
    "firecrawl": {"max": 3, "window": "company"},  # per-company, reset by caller
}


def _load() -> dict:
    if os.path.exists(RATE_FILE):
        try:
            with open(RATE_FILE) as f:
                return json.load(f)
        except (json.JSONDecodeError, OSError):
            pass
    return {}


def _save(data: dict) -> None:
    os.makedirs(os.path.dirname(RATE_FILE), exist_ok=True)
    with open(RATE_FILE, "w") as f:
        json.dump(data, f, indent=2, default=str)


def check(service: str) -> bool:
    """Return True if the service has budget remaining."""
    if service not in LIMITS:
        return True

    limit = LIMITS[service]
    data = _load()
    entry = data.get(service, {})

    if limit["window"] == "hour":
        window_start = entry.get("window_start")
        if window_start:
            start = datetime.fromisoformat(window_start)
            if datetime.now(timezone.utc) - start > timedelta(hours=1):
                # Window expired, reset
                return True
        count = entry.get("count", 0)
        return count < limit["max"]

    if limit["window"] == "company":
        count = entry.get("count", 0)
        return count < limit["max"]

    return True


def record(service: str, count: int = 1) -> None:
    """Record API usage for a service."""
    data = _load()
    entry = data.get(service, {"count": 0})
    limit = LIMITS.get(service, {})

    if limit.get("window") == "hour":
        window_start = entry.get("window_start")
        if window_start:
            start = datetime.fromisoformat(window_start)
            if datetime.now(timezone.utc) - start > timedelta(hours=1):
                entry = {"count": 0}
        if "window_start" not in entry:
            entry["window_start"] = datetime.now(timezone.utc).isoformat()

    entry["count"] = entry.get("count", 0) + count
    entry["last_used"] = datetime.now(timezone.utc).isoformat()
    data[service] = entry
    _save(data)


def reset_company(service: str = "firecrawl") -> None:
    """Reset per-company counters (called at the start of each company)."""
    data = _load()
    if service in data:
        data[service]["count"] = 0
        _save(data)


def update_from_headers(service: str, remaining: int) -> None:
    """Update rate limit from API response headers (e.g., GitHub X-RateLimit-Remaining)."""
    data = _load()
    entry = data.get(service, {})
    entry["remaining_from_api"] = remaining
    entry["last_header_check"] = datetime.now(timezone.utc).isoformat()
    data[service] = entry
    _save(data)
