#!/usr/bin/env python3
"""Verify HQ location for a fixed batch of global/unverified companies.

This script is intentionally narrower than the full enrichment pipeline:
- it performs a web-grounded headquarters lookup
- classifies the company as UK vs global
- writes hqLocation into enrichment_data.webSearch
- writes an audit trail into enrichment_data.location
- sets region_verified=true only when the location is confidently resolved

Usage:
  python3 scripts/verify_global_locations.py --domains-file /tmp/batch-01.txt
  python3 scripts/verify_global_locations.py --domains-file /tmp/batch-01.txt --report-path /tmp/batch-01.jsonl
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, quote_plus, unquote, urlparse

import psycopg2.extras
import requests
from bs4 import BeautifulSoup

SCRIPT_DIR = Path(__file__).resolve().parent
REPO_DIR = SCRIPT_DIR.parent

try:
    from dotenv import load_dotenv
    load_dotenv(REPO_DIR / ".env")
except ImportError:
    pass

sys.path.insert(0, str(SCRIPT_DIR))
from pool_db import get_db  # noqa: E402

OPENROUTER_API_KEY = os.environ.get("OPENROUTER_API_KEY", "")
API_URL = "https://openrouter.ai/api/v1/chat/completions"
MODEL = "perplexity/sonar"

UK_KEYWORDS = {
    "uk",
    "united kingdom",
    "england",
    "scotland",
    "wales",
    "northern ireland",
}

UK_CITIES = {
    "london", "manchester", "birmingham", "leeds", "glasgow", "liverpool",
    "edinburgh", "bristol", "sheffield", "cardiff", "belfast", "nottingham",
    "newcastle", "leicester", "brighton", "oxford", "cambridge", "reading",
    "coventry", "hull", "derby", "southampton", "portsmouth", "swansea",
    "exeter", "bath", "york", "dundee", "aberdeen", "warwick", "guildford",
    "sunderland", "wolverhampton", "plymouth", "stoke", "norwich", "luton",
    "slough", "milton keynes", "swindon", "basingstoke", "cheltenham",
}


def eprint(*args: Any) -> None:
    print(*args, file=sys.stderr)


@dataclass
class Company:
    domain: str
    name: str
    url: str | None
    description: str | None
    current_hq: str | None
    region_verified: bool


def load_domains(path: str) -> list[str]:
    raw = Path(path).read_text().strip()
    if not raw:
        return []

    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        parsed = None

    if isinstance(parsed, list):
        domains: list[str] = []
        for item in parsed:
            if isinstance(item, str):
                domains.append(item.strip())
            elif isinstance(item, dict) and item.get("domain"):
                domains.append(str(item["domain"]).strip())
        return [d for d in domains if d]

    return [line.strip() for line in raw.splitlines() if line.strip()]


def fetch_companies(conn: Any, domains: list[str]) -> dict[str, Company]:
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(
            """
            SELECT
                c.domain,
                c.name,
                c.url,
                c.description,
                c.region_verified,
                c.enrichment_data #>> '{webSearch,hqLocation}' AS current_hq
            FROM companies c
            WHERE c.domain = ANY(%s)
            """,
            (domains,),
        )
        rows = cur.fetchall()

    return {
        row["domain"]: Company(
            domain=row["domain"],
            name=row["name"],
            url=row["url"],
            description=row["description"],
            current_hq=row["current_hq"],
            region_verified=bool(row["region_verified"]),
        )
        for row in rows
    }


def is_uk_location(location: str | None) -> bool | None:
    if not location:
        return None

    text = location.strip().lower()
    if not text:
        return None

    if any(keyword in text for keyword in UK_KEYWORDS):
        return True

    if any(city in text for city in UK_CITIES):
        return True

    # Clear non-UK country marker.
    if "," in text:
        return False

    return None


def build_prompt(company: Company) -> str:
    details = [f"Company: {company.name}", f"Domain: {company.domain}"]
    if company.url:
        details.append(f"Website: {company.url}")
    if company.description:
        details.append(f"Description: {company.description[:400]}")
    if company.current_hq:
        details.append(f"Existing HQ hint: {company.current_hq}")

    return (
        "Search the web to verify the company's headquarters location. "
        "Prefer the company's own site, LinkedIn, Crunchbase, funding announcements, and reputable directories. "
        "Return ONLY a JSON object with this exact shape: "
        '{"hqLocation": string|null, "isUk": true|false|null, "confidence": "high"|"medium"|"low", '
        '"evidence": [{"title": string, "url": string}], "notes": string|null}. '
        "Set isUk=true only if the HQ is clearly in the United Kingdom. "
        "Set isUk=false only if the HQ is clearly outside the United Kingdom. "
        "Set isUk=null if you cannot verify it. "
        "Do not guess. Keep evidence to at most 3 items.\n\n"
        + "\n".join(details)
    )


def parse_json_object(text: str) -> dict[str, Any]:
    candidate = text.strip()
    if candidate.startswith("```"):
        parts = candidate.split("\n", 1)
        candidate = parts[1] if len(parts) > 1 else candidate
        candidate = candidate.rsplit("```", 1)[0].strip()

    try:
        parsed = json.loads(candidate)
        return parsed if isinstance(parsed, dict) else {}
    except json.JSONDecodeError:
        match = re.search(r"\{.*\}", candidate, re.DOTALL)
        if match:
            try:
                parsed = json.loads(match.group(0))
                return parsed if isinstance(parsed, dict) else {}
            except json.JSONDecodeError:
                return {}
        return {}


def search_hq(company: Company, retries: int = 3, fallback_only: bool = False) -> dict[str, Any]:
    if fallback_only or not OPENROUTER_API_KEY:
        return search_hq_fallback(company)

    last_error: Exception | None = None
    for attempt in range(1, retries + 1):
        try:
            response = requests.post(
                API_URL,
                headers={
                    "Authorization": f"Bearer {OPENROUTER_API_KEY}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": MODEL,
                    "messages": [{"role": "user", "content": build_prompt(company)}],
                    "max_tokens": 300,
                    "temperature": 0,
                },
                timeout=30,
            )
            if response.status_code >= 400:
                raise RuntimeError(
                    f"HTTP {response.status_code}: {response.text[:400]}"
                )
            payload = response.json()
            if payload.get("error"):
                raise RuntimeError(str(payload["error"]))
            content = payload["choices"][0]["message"]["content"]
            parsed = parse_json_object(content)
            if parsed:
                return parsed
            raise RuntimeError(f"Could not parse JSON response: {content[:200]}")
        except Exception as exc:  # noqa: BLE001
            last_error = exc
            sleep_s = min(8, attempt * 2)
            eprint(f"  [verify] retry {attempt}/{retries} for {company.domain}: {exc}")
            if attempt < retries:
                time.sleep(sleep_s)

    if last_error and "HTTP 402" in str(last_error):
        eprint(f"  [verify] switching to fallback search for {company.domain}")
        return search_hq_fallback(company)

    raise RuntimeError(f"Lookup failed for {company.domain}: {last_error}")


def _resolve_ddg_href(href: str | None) -> str:
    if not href:
        return ""
    if href.startswith("//"):
        href = f"https:{href}"
    parsed = urlparse(href)
    if "duckduckgo.com" in parsed.netloc:
        uddg = parse_qs(parsed.query).get("uddg", [])
        if uddg:
            return unquote(uddg[0])
    return href


def _extract_location_from_text(text: str) -> str | None:
    if not text:
        return None

    patterns = [
        r"headquartered in ([A-Z][A-Za-z0-9'&\.\- ]+(?:,\s*[A-Z][A-Za-z0-9'&\.\- ]+){0,4})",
        r"based in ([A-Z][A-Za-z0-9'&\.\- ]+(?:,\s*[A-Z][A-Za-z0-9'&\.\- ]+){0,4})",
        r"located in ([A-Z][A-Za-z0-9'&\.\- ]+(?:,\s*[A-Z][A-Za-z0-9'&\.\- ]+){0,4})",
        r"headquarters(?: is| are)?(?: located)? in ([A-Z][A-Za-z0-9'&\.\- ]+(?:,\s*[A-Z][A-Za-z0-9'&\.\- ]+){0,4})",
        r"headquartered at ([A-Z0-9][A-Za-z0-9'&\.\- ]+(?:,\s*[A-Z0-9][A-Za-z0-9'&\.\- ]+){1,5})",
    ]

    for pattern in patterns:
        match = re.search(pattern, text, flags=re.IGNORECASE)
        if match:
            value = match.group(1).strip(" .;:-")
            # Trim trailing clauses commonly seen in snippets.
            value = re.split(r"\s+(?:and|with|that|which)\s+", value, maxsplit=1)[0].strip()
            return value
    return None


def search_hq_fallback(company: Company) -> dict[str, Any]:
    query = f'"{company.name}" {company.domain} headquarters'
    search_url = f"https://html.duckduckgo.com/html/?q={quote_plus(query)}"
    response = requests.get(
        search_url,
        timeout=30,
        headers={"User-Agent": "Mozilla/5.0"},
    )
    response.raise_for_status()

    soup = BeautifulSoup(response.text, "html.parser")
    evidence: list[dict[str, str]] = []
    combined_text_parts: list[str] = []

    for result in soup.select(".result")[:5]:
        link = result.select_one(".result__title a")
        snippet = result.select_one(".result__snippet")
        title = link.get_text(" ", strip=True) if link else ""
        url = _resolve_ddg_href(link.get("href")) if link else ""
        snippet_text = snippet.get_text(" ", strip=True) if snippet else ""
        if title or url:
            evidence.append({"title": title or company.name, "url": url})
        if title:
            combined_text_parts.append(title)
        if snippet_text:
            combined_text_parts.append(snippet_text)

    combined = " ".join(combined_text_parts)
    location = _extract_location_from_text(combined)
    is_uk = is_uk_location(location)

    confidence = "low"
    if location:
        confidence = "medium"
        lowered = combined.lower()
        if "wikipedia" in lowered or "craft" in lowered or "headquartered in" in lowered:
            confidence = "high"

    return {
        "hqLocation": location,
        "isUk": is_uk,
        "confidence": confidence,
        "evidence": evidence[:3],
        "notes": "Fallback verification via DuckDuckGo HTML search results",
    }


def normalize_result(result: dict[str, Any], company: Company) -> dict[str, Any]:
    hq_location = result.get("hqLocation")
    if isinstance(hq_location, str):
        hq_location = hq_location.strip() or None
    else:
        hq_location = None

    is_uk = result.get("isUk")
    if not isinstance(is_uk, bool):
        derived = is_uk_location(hq_location)
        is_uk = derived

    confidence = result.get("confidence")
    if confidence not in {"high", "medium", "low"}:
        confidence = "medium" if hq_location else "low"

    evidence = result.get("evidence")
    if not isinstance(evidence, list):
        evidence = []

    clean_evidence = []
    for item in evidence[:3]:
        if not isinstance(item, dict):
            continue
        title = str(item.get("title") or "").strip()
        url = str(item.get("url") or "").strip()
        if not title and not url:
            continue
        clean_evidence.append({"title": title or company.name, "url": url})

    notes = result.get("notes")
    if not isinstance(notes, str):
        notes = None

    if is_uk is True:
        region = "uk"
        status = "verified"
    elif is_uk is False and hq_location:
        region = "global"
        status = "verified"
    else:
        region = "unknown"
        status = "unverified"

    return {
        "hqLocation": hq_location,
        "isUk": is_uk,
        "region": region,
        "status": status,
        "confidence": confidence,
        "evidence": clean_evidence,
        "notes": notes,
    }


def update_company(conn: Any, company: Company, normalized: dict[str, Any], dry_run: bool) -> str:
    region = normalized["region"]
    status = normalized["status"]
    hq_location = normalized["hqLocation"]
    now_iso = datetime.now(timezone.utc).isoformat()

    web_search_patch: dict[str, Any] = {
        "status": "success",
        "searchResultsFound": bool(hq_location),
    }
    if hq_location:
        web_search_patch["hqLocation"] = hq_location

    location_patch = {
        "region": region,
        "status": status,
        "confidence": normalized["confidence"],
        "verifiedAt": now_iso,
        "method": "openrouter_perplexity_sonar",
        "notes": normalized["notes"],
        "evidence": normalized["evidence"],
    }

    if dry_run:
        return "dry_run"

    with conn.cursor() as cur:
        if status == "verified":
            cur.execute(
                """
                UPDATE companies
                SET
                    enrichment_data = jsonb_set(
                        jsonb_set(
                            COALESCE(enrichment_data, '{}'::jsonb),
                            '{webSearch}',
                            COALESCE(enrichment_data->'webSearch', '{}'::jsonb) || %s::jsonb,
                            true
                        ),
                        '{location}',
                        %s::jsonb,
                        true
                    ),
                    region_verified = true,
                    updated_at = now()
                WHERE domain = %s
                """,
                (
                    json.dumps(web_search_patch),
                    json.dumps(location_patch),
                    company.domain,
                ),
            )
            cur.execute(
                """
                INSERT INTO company_regions (domain, region)
                VALUES (%s, %s)
                ON CONFLICT (domain, region) DO NOTHING
                """,
                (company.domain, region),
            )
            return "verified"

        cur.execute(
            """
            UPDATE companies
            SET
                enrichment_data = jsonb_set(
                    COALESCE(enrichment_data, '{}'::jsonb),
                    '{location}',
                    %s::jsonb,
                    true
                ),
                updated_at = now()
            WHERE domain = %s
            """,
            (
                json.dumps(location_patch),
                company.domain,
            ),
        )
        return "unresolved"


def append_report(path: str | None, item: dict[str, Any]) -> None:
    if not path:
        return
    with open(path, "a", encoding="utf-8") as handle:
        handle.write(json.dumps(item, ensure_ascii=True) + "\n")


def main() -> int:
    parser = argparse.ArgumentParser(description="Verify HQ location for a batch of global/unverified companies")
    parser.add_argument("--domains-file", required=True, help="Path containing domains to process")
    parser.add_argument("--report-path", help="Optional JSONL report path")
    parser.add_argument("--delay", type=float, default=0.5, help="Delay between requests")
    parser.add_argument("--dry-run", action="store_true", help="Do not write to the database")
    parser.add_argument("--fallback-only", action="store_true", help="Skip OpenRouter and use fallback search only")
    args = parser.parse_args()

    domains = load_domains(args.domains_file)
    if not domains:
        eprint("No domains found in batch file")
        return 1

    conn = get_db()
    companies_by_domain = fetch_companies(conn, domains)
    missing = [domain for domain in domains if domain not in companies_by_domain]
    if missing:
        eprint(f"Missing {len(missing)} domains from database")

    summary = {"processed": 0, "verified": 0, "unresolved": 0, "failed": 0, "missing": len(missing)}

    try:
        for index, domain in enumerate(domains, start=1):
            company = companies_by_domain.get(domain)
            if company is None:
                continue

            item: dict[str, Any] = {
                "domain": company.domain,
                "name": company.name,
                "currentHq": company.current_hq,
                "startedAt": datetime.now(timezone.utc).isoformat(),
            }

            if company.region_verified:
                item["outcome"] = "already_verified"
                append_report(args.report_path, item)
                continue

            try:
                raw_result = search_hq(company, fallback_only=args.fallback_only)
                normalized = normalize_result(raw_result, company)
                outcome = update_company(conn, company, normalized, args.dry_run)
                conn.commit()

                item.update(
                    {
                        "hqLocation": normalized["hqLocation"],
                        "region": normalized["region"],
                        "status": normalized["status"],
                        "confidence": normalized["confidence"],
                        "evidence": normalized["evidence"],
                        "notes": normalized["notes"],
                        "outcome": outcome,
                    }
                )
                summary["processed"] += 1
                if outcome == "verified":
                    summary["verified"] += 1
                elif outcome == "unresolved":
                    summary["unresolved"] += 1
                eprint(
                    f"[{index}/{len(domains)}] {company.domain}: "
                    f"{normalized['hqLocation'] or '-'} -> {normalized['region']} ({outcome})"
                )
            except Exception as exc:  # noqa: BLE001
                conn.rollback()
                item["outcome"] = "failed"
                item["error"] = str(exc)
                summary["failed"] += 1
                eprint(f"[{index}/{len(domains)}] {company.domain}: failed ({exc})")

            append_report(args.report_path, item)
            if index < len(domains):
                time.sleep(max(args.delay, 0))
    finally:
        conn.close()

    print(json.dumps(summary, indent=2))
    return 0 if summary["failed"] == 0 else 2


if __name__ == "__main__":
    raise SystemExit(main())
