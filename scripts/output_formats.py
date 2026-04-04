#!/usr/bin/env python3
"""Generate Markdown, JSON, and CSV outputs from scored/qualified company data."""

import argparse
import csv
import io
import json
import os
import sys
from datetime import date

CRITERIA_DISPLAY = [
    ("team_size", "Team Size"),
    ("funding_stage", "Funding"),
    ("growth_motion", "Growth Motion"),
    ("traction", "Traction"),
    ("growth_hire_absence", "Growth Hire Absence"),
    ("founder_reachability", "Founder Reachability"),
    ("timing", "Timing"),
]

CSV_COLUMNS = [
    "Company", "URL", "Score", "Verdict", "Confidence",
    "Team Size", "Funding", "Growth Motion", "Traction",
    "Growth Hire Absence", "Founder Reachability", "Timing",
    "Key Signals", "Tech Stack", "Recommended Action", "Sources",
]


def parse_args():
    parser = argparse.ArgumentParser(description="Format scored prospect data.")
    parser.add_argument("--date", default=date.today().isoformat(),
                        help="Run date (YYYY-MM-DD, defaults to today)")
    parser.add_argument("--output-dir",
                        default=os.path.join(os.path.dirname(__file__), "..", "prospects"),
                        help="Directory for output files (default: ../prospects/)")
    return parser.parse_args()


def read_input():
    raw = sys.stdin.read().strip()
    if not raw:
        return []
    return json.loads(raw)


def criterion_score(company, key):
    cs = company.get("criteria_scores", {})
    entry = cs.get(key)
    if not entry:
        return ""
    return str(entry.get("weighted", entry.get("score", "")))


def criterion_confidence(company, key):
    cs = company.get("criteria_scores", {})
    entry = cs.get(key)
    if not entry:
        return ""
    return entry.get("confidence", "")


def criterion_evidence(company, key):
    cs = company.get("criteria_scores", {})
    entry = cs.get(key)
    if not entry:
        return ""
    return entry.get("evidence", "")


def build_markdown(companies, run_date):
    qualified = [c for c in companies if c.get("verdict") == "QUALIFY"]
    nurture = [c for c in companies if c.get("verdict") == "NURTURE"]
    sorted_all = sorted(companies, key=lambda c: c.get("score", 0), reverse=True)
    sorted_qual = sorted(qualified, key=lambda c: c.get("score", 0), reverse=True)
    sorted_nurture = sorted(nurture, key=lambda c: c.get("score", 0), reverse=True)

    all_sources = set()
    for c in companies:
        all_sources.update(c.get("sources", []))

    lines = []
    lines.append(f"# Prospect Shortlist — {run_date}")
    lines.append("")
    lines.append(f"**{len(sorted_qual)}** qualified companies from **{len(companies)}** candidates | Sources: {', '.join(sorted(all_sources)) or 'none'}")
    lines.append("")
    lines.append("---")
    lines.append("")

    if not sorted_qual:
        lines.append("_No qualified companies this run._")
        lines.append("")
    else:
        for co in sorted_qual:
            name = co.get("company_name", "Unknown")
            url = co.get("url", "")
            score = co.get("score", 0)
            verdict = co.get("verdict", "")
            lines.append(f"## [{name}]({url}) — {score}/100 ({verdict})")
            lines.append("")

            for sig in co.get("key_signals", []):
                lines.append(f"- {sig}")
            lines.append("")

            lines.append("| Criterion | Score | Confidence | Evidence |")
            lines.append("|-----------|------:|:----------:|----------|")
            for key, label in CRITERIA_DISPLAY:
                cs = co.get("criteria_scores", {}).get(key)
                if cs:
                    lines.append(f"| {label} | {cs.get('weighted', cs.get('score', ''))} | {cs.get('confidence', '')} | {cs.get('evidence', '')} |")
            lines.append("")

            vendors = co.get("detected_vendors", [])
            integrations = co.get("segment_integrations", [])
            tech = vendors + integrations
            if tech:
                lines.append(f"**Tech stack:** {', '.join(tech)}")
                lines.append("")

            action = co.get("recommended_action")
            if action:
                lines.append(f"> {action}")
                lines.append("")

            lines.append("---")
            lines.append("")

    if sorted_nurture:
        lines.append("### Near Misses (NURTURE)")
        lines.append("")
        for co in sorted_nurture[:3]:
            name = co.get("company_name", "Unknown")
            score = co.get("score", 0)
            reason = co.get("disqualify_reason") or "Below threshold"
            lines.append(f"- **{name}** ({score}/100) — {reason}")
        lines.append("")

    lines.append(f"_Generated {run_date} | Sources queried: {', '.join(sorted(all_sources)) or 'none'}_")
    lines.append("")
    return "\n".join(lines)


def build_json(companies, run_date):
    qualified = [c for c in companies if c.get("verdict") == "QUALIFY"]
    all_sources = set()
    for c in companies:
        all_sources.update(c.get("sources", []))

    output = {
        "metadata": {
            "date": run_date,
            "sources": sorted(all_sources),
            "total_candidates": len(companies),
            "qualified_count": len(qualified),
        },
        "companies": sorted(companies, key=lambda c: c.get("score", 0), reverse=True),
    }
    return json.dumps(output, indent=2, ensure_ascii=False)


def build_csv(companies):
    sorted_cos = sorted(companies, key=lambda c: c.get("score", 0), reverse=True)
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(CSV_COLUMNS)

    for co in sorted_cos:
        signals = "; ".join(co.get("key_signals", []))
        tech = "; ".join(co.get("detected_vendors", []) + co.get("segment_integrations", []))
        sources = ", ".join(co.get("sources", []))
        row = [
            co.get("company_name", ""),
            co.get("url", ""),
            co.get("score", ""),
            co.get("verdict", ""),
            co.get("confidence", ""),
        ]
        for key, _ in CRITERIA_DISPLAY:
            row.append(criterion_score(co, key))
        row.extend([signals, tech, co.get("recommended_action", ""), sources])
        writer.writerow(row)

    return buf.getvalue()


def main():
    args = parse_args()
    run_date = args.date
    output_dir = os.path.abspath(args.output_dir)
    os.makedirs(output_dir, exist_ok=True)

    companies = read_input()

    md = build_markdown(companies, run_date)
    js = build_json(companies, run_date)
    cv = build_csv(companies)

    md_path = os.path.join(output_dir, f"shortlist-{run_date}.md")
    json_path = os.path.join(output_dir, f"shortlist-{run_date}.json")
    csv_path = os.path.join(output_dir, f"shortlist-{run_date}.csv")

    with open(md_path, "w", encoding="utf-8") as f:
        f.write(md)

    with open(json_path, "w", encoding="utf-8") as f:
        f.write(js)
        f.write("\n")

    with open(csv_path, "w", encoding="utf-8-sig") as f:
        f.write(cv)

    sys.stdout.write(md)
    print(f"Wrote {md_path}", file=sys.stderr)
    print(f"Wrote {json_path}", file=sys.stderr)
    print(f"Wrote {csv_path}", file=sys.stderr)


if __name__ == "__main__":
    main()
