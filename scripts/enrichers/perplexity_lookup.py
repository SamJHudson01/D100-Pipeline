"""Perplexity Sonar lookup for team size, location, and funding.

Uses Perplexity's sonar model via OpenRouter for web-grounded firmographic
extraction. ~$0.15 per 1,000 companies.

Can be run standalone for batch enrichment or called from the enrichment pipeline.
"""

import json
import os
import re
import sys
import time

import requests

eprint = lambda *a, **kw: print(*a, file=sys.stderr, **kw)

OPENROUTER_API_KEY = os.environ.get("OPENROUTER_API_KEY", "")
MODEL = "perplexity/sonar"
API_URL = "https://openrouter.ai/api/v1/chat/completions"

PROMPT_TEMPLATE = (
    'Search for {name} ({domain}). '
    'Find: 1) employee count 2) headquarters city & country 3) total funding raised 4) funding stage 5) year founded. '
    'You MUST respond with ONLY a JSON object, no other text. '
    'If a field is unknown, use null. Example format:\n'
    '{{"teamSize": 50, "teamSizeSource": "LinkedIn", '
    '"hqLocation": "London, UK", "fundingStage": "Series A", '
    '"fundingAmount": "$5M", "foundedYear": 2020}}'
)


def _parse_team_size(value) -> int | None:
    """Parse team size from various formats: int, string range, string number."""
    if value is None:
        return None
    if isinstance(value, int):
        return value if 1 <= value <= 50000 else None
    if isinstance(value, str):
        # Range like "51-200" or "11-50" — take upper bound
        range_match = re.match(r'(\d+)\s*[-–]\s*(\d+)', value)
        if range_match:
            return int(range_match.group(2))
        # Plain number
        num_match = re.match(r'(\d+)', value.replace(',', ''))
        if num_match:
            n = int(num_match.group(1))
            return n if 1 <= n <= 50000 else None
    return None


def _extract_from_text(text: str) -> dict:
    """Last-resort regex extraction from a text response."""
    result = {"teamSize": None, "teamSizeSource": None, "hqLocation": None,
              "fundingStage": None, "fundingAmount": None, "foundedYear": None}

    # Team size
    for pat in [r'(\d{1,5})\s*[-–]\s*(\d{1,5})\s*employees',
                r'(\d{1,5})\+?\s*employees',
                r'(?:has|have|approximately|about|around)\s*(\d{1,5})\s*(?:employees|staff|people)']:
        m = re.search(pat, text, re.IGNORECASE)
        if m:
            result["teamSize"] = _parse_team_size(m.group())
            result["teamSizeSource"] = "perplexity_text"
            break

    # Location
    uk_loc = re.search(r'(?:headquartered|based|located)\s+in\s+([A-Z][a-z]+(?:,\s*(?:UK|United Kingdom|England|Scotland|Wales)))', text)
    if uk_loc:
        result["hqLocation"] = uk_loc.group(1)
    else:
        any_loc = re.search(r'(?:headquartered|based|located)\s+in\s+([A-Z][a-z]+(?:,\s*[A-Z][a-z]+)*)', text)
        if any_loc:
            result["hqLocation"] = any_loc.group(1)

    # Funding
    fund_match = re.search(r'(?:raised|funding|secured)\s+(?:of\s+)?(\$|£|€)\s*(\d+\.?\d*)\s*(M|million|B|billion|K)', text, re.IGNORECASE)
    if fund_match:
        currency, num, unit = fund_match.group(1), fund_match.group(2), fund_match.group(3)
        u = {"m": "M", "million": "M", "b": "B", "billion": "B", "k": "K"}.get(unit.lower(), unit)
        result["fundingAmount"] = f"{currency}{num}{u}"

    stage_match = re.search(r'(Series\s*[A-D]|Seed|Pre-[Ss]eed)', text)
    if stage_match:
        result["fundingStage"] = stage_match.group(1)

    # Founded
    year_match = re.search(r'(?:founded|established)\s+(?:in\s+)?(\d{4})', text, re.IGNORECASE)
    if year_match:
        y = int(year_match.group(1))
        if 1990 <= y <= 2026:
            result["foundedYear"] = y

    return result


def lookup(domain: str, name: str, description: str = "") -> dict:
    """Query Perplexity Sonar for company firmographics.

    Returns dict with: teamSize, teamSizeSource, hqLocation,
    fundingStage, fundingAmount, foundedYear (all nullable).
    """
    if not OPENROUTER_API_KEY:
        eprint("  [perplexity] OPENROUTER_API_KEY not set")
        return {}

    prompt = PROMPT_TEMPLATE.format(name=name, domain=domain)
    if description:
        prompt = f"{name}: {description}. " + prompt

    try:
        resp = requests.post(
            API_URL,
            headers={
                "Authorization": f"Bearer {OPENROUTER_API_KEY}",
                "Content-Type": "application/json",
            },
            json={
                "model": MODEL,
                "messages": [{"role": "user", "content": prompt}],
                "max_tokens": 300,
                "temperature": 0.0,
            },
            timeout=15,
        )
        resp.raise_for_status()
        data = resp.json()
        content = data["choices"][0]["message"]["content"]

        # Parse JSON from response (may have markdown fences)
        text = content.strip()
        if text.startswith("```"):
            text = text.split("\n", 1)[1].rsplit("```", 1)[0].strip()

        result = json.loads(text)

        # Normalize team size
        raw_team = result.get("teamSize")
        result["teamSize"] = _parse_team_size(raw_team)
        if raw_team and result["teamSize"] and str(raw_team) != str(result["teamSize"]):
            result["teamSizeSource"] = f"{result.get('teamSizeSource', '')} (parsed from '{raw_team}')"

        usage = data.get("usage", {})
        tokens = usage.get("prompt_tokens", 0) + usage.get("completion_tokens", 0)
        eprint(f"  [perplexity] {name}: team={result.get('teamSize', '-')} "
               f"loc={result.get('hqLocation', '-')} "
               f"fund={result.get('fundingAmount', '-')} "
               f"({tokens} tokens)")

        return result

    except json.JSONDecodeError:
        # Try to extract JSON from mixed text response
        json_match = re.search(r'\{[^{}]*"teamSize"[^{}]*\}', content)
        if json_match:
            try:
                result = json.loads(json_match.group())
                raw_team = result.get("teamSize")
                result["teamSize"] = _parse_team_size(raw_team)
                eprint(f"  [perplexity] {name}: extracted JSON from text response")
                return result
            except json.JSONDecodeError:
                pass

        # Last resort: regex extract from text
        result = _extract_from_text(content)
        if any(v for v in result.values()):
            eprint(f"  [perplexity] {name}: regex-extracted from text response")
            return result

        eprint(f"  [perplexity] Failed to parse for {name}: {content[:200]}")
        return {}
    except Exception as e:
        eprint(f"  [perplexity] Error for {name}: {e}")
        return {}


def batch_lookup(companies: list[dict], delay: float = 0.5) -> list[dict]:
    """Batch lookup for multiple companies.

    Each company dict should have: domain, name, description (optional).
    Returns list of result dicts in same order.
    """
    results = []
    for i, c in enumerate(companies):
        result = lookup(c["domain"], c["name"], c.get("description", ""))
        results.append(result)
        if i < len(companies) - 1:
            time.sleep(delay)
    return results


if __name__ == "__main__":
    """CLI usage: python -m enrichers.perplexity_lookup --domain sylvera.com --name Sylvera"""
    import argparse

    # Ensure scripts/ is importable
    scripts_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    sys.path.insert(0, scripts_dir)

    try:
        from dotenv import load_dotenv
        load_dotenv(os.path.join(scripts_dir, os.pardir, ".env"))
    except ImportError:
        pass

    # Re-read env after loading .env (module-level var)
    import enrichers.perplexity_lookup as _self
    _self.OPENROUTER_API_KEY = os.environ.get("OPENROUTER_API_KEY", "")

    parser = argparse.ArgumentParser(description="Perplexity Sonar company lookup")
    parser.add_argument("--domain", required=True)
    parser.add_argument("--name", required=True)
    parser.add_argument("--description", default="")
    args = parser.parse_args()

    result = lookup(args.domain, args.name, args.description)
    print(json.dumps(result, indent=2))
