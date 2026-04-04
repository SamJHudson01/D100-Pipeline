"""LLM-powered news headline relevance filter.

Batch-classifies news headlines as relevant or irrelevant to a target company.
Fail-open: any error returns the unfiltered list (degrades to today's behaviour).
"""

import json
import sys

eprint = lambda *a, **kw: print(*a, file=sys.stderr, **kw)

_SYSTEM = (
    "You classify news headlines as relevant or irrelevant to a specific company. "
    "A headline is relevant ONLY if it is specifically about the named company, "
    "not just the industry or a different company with a similar name. "
    "Be strict: generic industry articles and name collisions are irrelevant."
)

_PROMPT_TEMPLATE = """Classify each headline as relevant or irrelevant to this specific company.

<company>
  <name>{name}</name>
  <domain>{domain}</domain>
  <description>{description}</description>
</company>

<headlines>
{headlines}
</headlines>

Respond with a JSON array only. Each element: {{"index": N, "relevant": true/false, "reason": "max 8 words"}}"""


def filter_relevant_news(
    items: list[dict],
    company_name: str,
    domain: str,
    description: str,
) -> list[dict]:
    """Filter news items to only those relevant to the target company.

    Falls back to returning all items if LLM filtering fails for any reason.
    Never returns empty from a non-empty input.
    """
    if not items:
        return items

    # Not worth an LLM call for 1-2 items
    if len(items) <= 2:
        return items

    try:
        from .llm import classify
    except (ImportError, RuntimeError) as e:
        eprint(f"  [news_relevance] LLM unavailable ({e}), returning unfiltered")
        return items

    headlines = "\n".join(
        f'{i + 1}. "{item["title"]}" — {item.get("source", "unknown")}, {item.get("date", "unknown")}'
        for i, item in enumerate(items)
    )

    prompt = _PROMPT_TEMPLATE.format(
        name=company_name,
        domain=domain,
        description=description or "No description available",
        headlines=headlines,
    )

    try:
        raw = classify(system=_SYSTEM, prompt=prompt)
        results = _parse_response(raw, len(items))
        relevant_indices = {r["index"] for r in results if r["relevant"]}
        filtered = [item for i, item in enumerate(items) if (i + 1) in relevant_indices]
        eprint(f"  [news_relevance] {len(filtered)}/{len(items)} headlines relevant")
        # Never return empty from non-empty input
        return filtered if filtered else items
    except Exception as e:
        eprint(f"  [news_relevance] Failed ({type(e).__name__}): {e}, returning unfiltered")
        return items


def _parse_response(raw: str, expected_count: int) -> list[dict]:
    """Parse LLM JSON response with fail-open fallback."""
    text = raw.strip()
    # Strip markdown code fences if present
    if text.startswith("```"):
        text = text.split("\n", 1)[1].rsplit("```", 1)[0].strip()

    try:
        results = json.loads(text)
    except json.JSONDecodeError:
        return [{"index": i + 1, "relevant": True, "reason": "parse_failed"}
                for i in range(expected_count)]

    if not isinstance(results, list):
        return [{"index": i + 1, "relevant": True, "reason": "not_a_list"}
                for i in range(expected_count)]

    for item in results:
        if not isinstance(item.get("relevant"), bool):
            item["relevant"] = True
            item["reason"] = "missing_field"

    return results
