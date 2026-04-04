"""Shared cache layer for enrichment results.

File-based cache with namespace isolation and configurable TTL.
Replaces the per-script cache implementations in enrich_website.py
and enrich_ats.py.
"""

import hashlib
import json
import os
import sys
from datetime import datetime, timezone, timedelta

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
CACHE_BASE = os.path.join(SCRIPT_DIR, "..", "..", "prospects", "cache")

eprint = lambda *a, **kw: print(*a, file=sys.stderr, **kw)


def _cache_path(namespace: str, key: str) -> str:
    ns_dir = os.path.join(CACHE_BASE, namespace)
    os.makedirs(ns_dir, exist_ok=True)
    hashed = hashlib.sha256(key.encode()).hexdigest()
    return os.path.join(ns_dir, f"{hashed}.json")


def get(namespace: str, key: str, max_age: timedelta = timedelta(days=7)) -> dict | None:
    """Retrieve a cached result, or None if missing/expired."""
    path = _cache_path(namespace, key)
    if not os.path.exists(path):
        return None
    try:
        with open(path) as f:
            data = json.load(f)
        cached_at = data.get("_cached_at")
        if cached_at:
            ts = datetime.fromisoformat(cached_at)
            if datetime.now(timezone.utc) - ts > max_age:
                return None
        return data
    except (json.JSONDecodeError, ValueError, OSError) as e:
        eprint(f"Cache read error ({namespace}/{key[:16]}): {e}")
        return None


def set(namespace: str, key: str, data: dict) -> None:
    """Write a result to the cache."""
    path = _cache_path(namespace, key)
    data["_cached_at"] = datetime.now(timezone.utc).isoformat()
    try:
        with open(path, "w") as f:
            json.dump(data, f, indent=2, default=str)
    except OSError as e:
        eprint(f"Cache write error ({namespace}/{key[:16]}): {e}")
