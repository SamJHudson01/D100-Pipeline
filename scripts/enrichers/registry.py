"""Enrichment registry with dependency DAG and topological execution.

Each enricher is registered with:
- A name (unique identifier)
- A function (takes EnrichmentContext, returns partial result dict)
- Dependencies (list of enricher names that must run first)
- A tier (1, 2, or 3 — determines parallelism grouping)

The registry resolves dependencies via topological sort and groups
enrichers by tier for parallel execution.
"""

from __future__ import annotations

import sys
from collections import defaultdict
from dataclasses import dataclass, field
from typing import Callable, Any

from .schema import EnrichmentContext

eprint = lambda *a, **kw: print(*a, file=sys.stderr, **kw)


@dataclass
class Enricher:
    """A registered enrichment function."""
    name: str
    fn: Callable[[EnrichmentContext], dict[str, Any]]
    depends_on: list[str] = field(default_factory=list)
    tier: int = 1


# Global registry
_enrichers: dict[str, Enricher] = {}


def register(
    name: str,
    depends_on: list[str] | None = None,
    tier: int = 1,
):
    """Decorator to register an enrichment function.

    Usage:
        @register("web_search", tier=1)
        def web_search(ctx: EnrichmentContext) -> dict:
            ...
    """
    def decorator(fn: Callable[[EnrichmentContext], dict[str, Any]]):
        _enrichers[name] = Enricher(
            name=name,
            fn=fn,
            depends_on=depends_on or [],
            tier=tier,
        )
        return fn
    return decorator


def get_enricher(name: str) -> Enricher | None:
    return _enrichers.get(name)


def get_all_enrichers() -> dict[str, Enricher]:
    return dict(_enrichers)


def get_tier_enrichers(tier: int) -> list[Enricher]:
    """Get all enrichers for a given tier, in dependency order."""
    tier_enrichers = [e for e in _enrichers.values() if e.tier == tier]
    return _topo_sort(tier_enrichers)


def _topo_sort(enrichers: list[Enricher]) -> list[Enricher]:
    """Topological sort within a tier based on dependencies."""
    name_to_enricher = {e.name: e for e in enrichers}
    names_in_tier = set(name_to_enricher.keys())

    # Build adjacency for in-tier dependencies only
    in_degree: dict[str, int] = {e.name: 0 for e in enrichers}
    dependents: dict[str, list[str]] = defaultdict(list)

    for e in enrichers:
        for dep in e.depends_on:
            if dep in names_in_tier:
                in_degree[e.name] += 1
                dependents[dep].append(e.name)

    # Kahn's algorithm
    queue = [name for name, deg in in_degree.items() if deg == 0]
    result: list[Enricher] = []

    while queue:
        name = queue.pop(0)
        result.append(name_to_enricher[name])
        for dependent in dependents[name]:
            in_degree[dependent] -= 1
            if in_degree[dependent] == 0:
                queue.append(dependent)

    if len(result) != len(enrichers):
        missing = names_in_tier - {e.name for e in result}
        raise ValueError(f"Circular dependency in enrichers: {missing}")

    return result


def merge_result(ctx: EnrichmentContext, partial: dict[str, Any]) -> None:
    """Merge a partial enrichment result into the context's result dict."""
    result = ctx.get("result", {})
    for key, value in partial.items():
        if key == "keyPeople" and key in result:
            # Merge key people by name — deduplicate, and update existing with new fields
            existing_by_name = {p["name"]: p for p in result[key]}
            for person in value:
                if person["name"] in existing_by_name:
                    # Update existing person with any new non-empty fields
                    for field, val in person.items():
                        if val and not existing_by_name[person["name"]].get(field):
                            existing_by_name[person["name"]][field] = val
                else:
                    result[key].append(person)
                    existing_by_name[person["name"]] = person
        else:
            result[key] = value
    ctx["result"] = result
