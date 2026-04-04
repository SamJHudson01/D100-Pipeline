#!/usr/bin/env python3
"""End-to-end prospect qualification pipeline.

Invoked via the manual-agent prospect workflow (default: Codex). Runs unattended:
pick → pre-filter → enrich → score → decay → log.

This script orchestrates the pipeline but does NOT perform LLM operations
(pre-filtering and scoring). It prepares batches and writes results that
the SKILL.md pipeline instructions use for LLM-in-context processing.
"""

import json
import os
import shutil
import sys
import time
import uuid
from datetime import datetime, timezone

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, SCRIPT_DIR)

import psycopg2.extras

from pool_db import get_db, pick_candidates, update_state, get_pool_stats

try:
    from dotenv import load_dotenv
    load_dotenv(os.path.join(SCRIPT_DIR, os.pardir, ".env"))
except ImportError:
    pass

DB_PATH = os.path.join(SCRIPT_DIR, os.pardir, "prospects", "pool.db")
RUNS_DIR = os.path.join(SCRIPT_DIR, os.pardir, "prospects", "pipeline_runs")

eprint = lambda *a, **kw: print(*a, file=sys.stderr, **kw)
MANUAL_AGENT_LABEL = os.environ.get("MANUAL_AGENT_LABEL", "Codex")


def backup_db():
    """Copy pool.db to pool.db.bak before destructive operations."""
    db = os.path.normpath(DB_PATH)
    bak = db + ".bak"
    if os.path.exists(db):
        shutil.copy2(db, bak)
        eprint(f"Database backed up to {bak}")


def create_run(conn, run_type="daily", region="uk"):
    """Create a pipeline_runs record and return the run_id."""
    run_id = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S-") + uuid.uuid4().hex[:8]
    with conn.cursor() as cur:
        cur.execute(
            "INSERT INTO pipeline_runs (run_id, run_type, region) VALUES (%s, %s, %s)",
            (run_id, run_type, region),
        )
    conn.commit()
    return run_id


ALLOWED_RUN_COLUMNS = {
    "companies_processed", "companies_qualified", "companies_rejected",
    "status", "summary",
}


def complete_run(conn, run_id, status="completed", **counts):
    """Mark a pipeline run as complete with summary counts."""
    sets = ["completed_at=now()", "status=%s"]
    vals = [status]
    for k, v in counts.items():
        if k not in ALLOWED_RUN_COLUMNS:
            raise ValueError(f"Column not allowed in pipeline_runs update: {k}")
        sets.append(f"{k}=%s")
        vals.append(v)
    vals.append(run_id)
    with conn.cursor() as cur:
        cur.execute(
            f"UPDATE pipeline_runs SET {', '.join(sets)} WHERE run_id=%s", vals
        )
    conn.commit()


def pick_batch(conn, count=20, region="uk"):
    """Pick the next batch of discovered companies for processing."""
    return pick_candidates(conn, count=count, region=region, exclude_states=[
        "enriched", "qualified", "nurture", "skip",
        "disqualified", "contacted", "stale", "dead",
        "pre_filter_rejected", "pre_filtered",
    ])


def apply_score_decay(conn, chunk_size=500):
    """Apply score decay to all scored companies in chunks.

    0-30 days: full score
    31-60 days: × 0.75
    61-90 days: × 0.50
    90+ days: reset to 0
    """
    # Get all companies with scores that haven't been touched this run
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute("""
            SELECT domain, original_score, scored_at
            FROM companies
            WHERE original_score IS NOT NULL AND scored_at IS NOT NULL
        """)
        rows = cur.fetchall()

    if not rows:
        return 0

    decayed = 0
    for i in range(0, len(rows), chunk_size):
        chunk = rows[i:i + chunk_size]
        with conn.cursor() as cur:
            for row in chunk:
                domain = row["domain"]
                original = row["original_score"]
                scored_at = row["scored_at"]

                # Calculate days since scoring
                try:
                    if isinstance(scored_at, str):
                        scored_dt = datetime.fromisoformat(scored_at.replace("Z", "+00:00"))
                    else:
                        # Postgres may return a datetime object directly
                        scored_dt = scored_at if scored_at.tzinfo else scored_at.replace(tzinfo=timezone.utc)
                    days = (datetime.now(timezone.utc) - scored_dt).days
                except (ValueError, AttributeError):
                    continue

                if days <= 30:
                    new_score = original
                elif days <= 60:
                    new_score = int(original * 0.75)
                elif days <= 90:
                    new_score = int(original * 0.50)
                else:
                    new_score = 0

                cur.execute(
                    "UPDATE companies SET score=%s, updated_at=now() WHERE domain=%s",
                    (new_score, domain),
                )
                decayed += 1

        conn.commit()
        time.sleep(0.01)  # Yield between chunks for concurrent access

    return decayed


def get_pipeline_summary(conn, region="uk"):
    """Get a summary of the pool state for display."""
    stats = get_pool_stats(conn, region=region)
    total = sum(stats.values())
    return {
        "total": total,
        "discovered": stats.get("discovered", 0),
        "pre_filtered": stats.get("pre_filtered", 0),
        "enriched": stats.get("enriched", 0),
        "qualified": stats.get("qualified", 0),
        "nurture": stats.get("nurture", 0),
        "skip": stats.get("skip", 0),
        "disqualified": stats.get("disqualified", 0),
        "contacted": stats.get("contacted", 0),
    }


def main():
    """Run the pipeline preparation steps.

    This script handles the mechanical parts:
    - Database backup
    - Migration check
    - Batch picking
    - Score decay
    - Run logging

    The LLM steps (pre-filter, enrichment orchestration, scoring)
    are handled by SKILL.md instructions in the manual-agent context.
    """
    import argparse
    parser = argparse.ArgumentParser(description="Prospect qualification pipeline")
    parser.add_argument("--region", default="uk", help="Region filter (default: uk)")
    parser.add_argument("--batch-size", type=int, default=20, help="Candidates per batch (default: 20)")
    parser.add_argument("--decay-only", action="store_true", help="Only run score decay")
    parser.add_argument("--stats-only", action="store_true", help="Only show pool stats")
    parser.add_argument("--pick", action="store_true", help="Pick next batch and output as JSON")
    args = parser.parse_args()

    conn = get_db()

    if args.stats_only:
        summary = get_pipeline_summary(conn, region=args.region)
        print(json.dumps(summary, indent=2))
        conn.close()
        return

    if args.decay_only:
        backup_db()
        decayed = apply_score_decay(conn)
        eprint(f"Score decay applied to {decayed} companies")
        conn.close()
        return

    if args.pick:
        batch = pick_batch(conn, count=args.batch_size, region=args.region)
        # Output as JSON for SKILL.md to consume
        output = []
        for c in batch:
            output.append({
                "domain": c["domain"],
                "name": c["name"],
                "url": c["url"],
                "description": c["description"],
                "source": c["source"],
                "sources": c["sources"] if isinstance(c["sources"], list) else json.loads(c["sources"] or "[]"),
            })
        print(json.dumps(output, indent=2))
        eprint(f"Picked {len(output)} candidates from {args.region} pool")
        conn.close()
        return

    # Full pipeline prep
    backup_db()
    os.makedirs(RUNS_DIR, exist_ok=True)
    run_id = create_run(conn, run_type="daily", region=args.region)
    eprint(f"Pipeline run {run_id} started")

    # Show current state
    summary = get_pipeline_summary(conn, region=args.region)
    eprint(f"Pool: {summary['total']} total | {summary['discovered']} discovered | "
           f"{summary['qualified']} qualified | {summary['nurture']} nurture")

    # Pick first batch
    batch = pick_batch(conn, count=args.batch_size, region=args.region)
    eprint(f"Picked {len(batch)} candidates for processing")

    if not batch:
        eprint("No candidates available. Run /prospect seed to refresh the pool.")
        complete_run(conn, run_id, status="completed",
                    companies_processed=0, companies_qualified=0)
        conn.close()
        return

    # Output batch for SKILL.md LLM processing
    output = {
        "run_id": run_id,
        "region": args.region,
        "batch": [],
    }
    for c in batch:
        output["batch"].append({
            "domain": c["domain"],
            "name": c["name"],
            "url": c["url"],
            "description": c["description"],
            "source": c["source"],
            "sources": c["sources"] if isinstance(c["sources"], list) else json.loads(c["sources"] or "[]"),
        })

    # Save to pipeline_runs directory for SKILL.md to read
    run_file = os.path.join(RUNS_DIR, f"{run_id}.json")
    with open(run_file, "w") as f:
        json.dump(output, f, indent=2)

    print(json.dumps(output, indent=2))
    eprint(f"\nBatch saved to {run_file}")
    eprint(f"Next: LLM pre-filter → enrich → score in {MANUAL_AGENT_LABEL}")
    eprint(f"Then: python scripts/pipeline.py --decay-only")

    conn.close()


if __name__ == "__main__":
    main()
