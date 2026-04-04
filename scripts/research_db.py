"""Database helpers for the /research manual-agent workflow.

Three functions matching the research_jobs lifecycle:
  1. claim_next_job — atomic claim (pending → in_progress)
  2. write_research — transactional write (research_data + job completed)
  3. reap_stale_jobs — timeout guard for stuck in_progress jobs

All queries use parameterized %s — never string interpolation.
Follows the pattern established by pool_db.py and enrichers/db_writer.py.
"""

import json
import os
import sys
from datetime import datetime, timezone

import psycopg2
import psycopg2.extras

MAX_RESEARCH_SIZE = 500_000  # 500KB, matches CHECK constraint

eprint = lambda *a, **kw: print(*a, file=sys.stderr, **kw)
MANUAL_AGENT_LABEL = (
    os.environ.get("MANUAL_AGENT_LABEL")
    or os.environ.get("NEXT_PUBLIC_MANUAL_AGENT_LABEL")
    or "Codex"
)
CLAIMED_PROGRESS_MESSAGE = f"Claimed in {MANUAL_AGENT_LABEL}"


def get_db():
    """Get a connection to the Neon Postgres database."""
    db_url = os.environ.get("DATABASE_URL")
    if not db_url:
        print("ERROR: DATABASE_URL not set", file=sys.stderr)
        sys.exit(1)
    conn = psycopg2.connect(db_url)
    conn.autocommit = True
    return conn


def claim_next_job(conn, domain=None, executor="claude"):
    """Atomically claim the next pending research job.

    Uses UPDATE ... RETURNING to prevent race conditions between
    concurrent /research invocations.

    Args:
        conn: psycopg2 connection
        domain: optional — claim a specific domain's job
        executor: claude or openrouter

    Returns:
        dict with job fields, or None if no pending jobs
    """
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

    if domain:
        cur.execute("""
            UPDATE research_jobs
            SET status = 'in_progress', started_at = now(), error = NULL,
                progress_message = %s
            WHERE id = (
                SELECT id FROM research_jobs
                WHERE domain = %s AND executor = %s AND status = 'pending'
                ORDER BY requested_at ASC
                LIMIT 1
                FOR UPDATE SKIP LOCKED
            )
            RETURNING id, domain, executor, status, requested_at, started_at
        """, (CLAIMED_PROGRESS_MESSAGE, domain, executor))
    else:
        cur.execute("""
            UPDATE research_jobs
            SET status = 'in_progress', started_at = now(), error = NULL,
                progress_message = %s
            WHERE id = (
                SELECT id FROM research_jobs
                WHERE executor = %s AND status = 'pending'
                ORDER BY requested_at ASC
                LIMIT 1
                FOR UPDATE SKIP LOCKED
            )
            RETURNING id, domain, executor, status, requested_at, started_at
        """, (CLAIMED_PROGRESS_MESSAGE, executor))

    row = cur.fetchone()
    return dict(row) if row else None


def get_enrichment_data(conn, domain):
    """Read existing enrichment_data for a company (head start for research).

    Returns:
        dict (parsed JSONB) or empty dict
    """
    cur = conn.cursor()
    cur.execute(
        "SELECT enrichment_data FROM companies WHERE domain = %s",
        (domain,)
    )
    row = cur.fetchone()
    if row and row[0]:
        return row[0] if isinstance(row[0], dict) else json.loads(row[0])
    return {}


def write_research(conn, domain, job_id, research_data, executor="claude"):
    """Write research_data and mark job completed in a single transaction.

    Disables autocommit for the transaction, then restores it.
    Both UPDATEs succeed or both fail — no inconsistent state.

    Args:
        conn: psycopg2 connection
        domain: company domain
        job_id: UUID string of the research_jobs row
        research_data: dict to store as JSONB
        executor: claude or openrouter

    Raises:
        ValueError: if research_data exceeds size limit
    """
    payload = json.dumps(research_data, default=str)
    if len(payload) > MAX_RESEARCH_SIZE:
        raise ValueError(
            f"research_data too large: {len(payload)} bytes "
            f"(max {MAX_RESEARCH_SIZE})"
        )

    conn.autocommit = False
    try:
        cur = conn.cursor()
        cur.execute(
            "UPDATE companies SET research_data = %s "
            "WHERE domain = %s AND research_data IS NULL "
            "RETURNING domain",
            (payload, domain)
        )
        if cur.fetchone() is None:
            cur.execute(
                "UPDATE research_jobs SET status = 'failed', completed_at = now(), "
                "error = %s, progress_message = NULL "
                "WHERE id = %s AND executor = %s AND status = 'in_progress' "
                "RETURNING id",
                ("Research already exists for this company", job_id, executor)
            )
            if cur.fetchone() is None:
                raise RuntimeError("Research job is no longer claimed")
            conn.commit()
            eprint(
                f"  [research_db] Skipped write for {domain}, "
                f"job {job_id} already superseded"
            )
            return "skipped_existing_data"

        cur.execute(
            "UPDATE research_jobs SET status = 'completed', completed_at = now(), "
            "error = NULL, progress_message = NULL "
            "WHERE id = %s AND executor = %s AND status = 'in_progress' "
            "RETURNING id",
            (job_id, executor)
        )
        if cur.fetchone() is None:
            raise RuntimeError("Research job is no longer claimed")
        conn.commit()
        eprint(f"  [research_db] Wrote research for {domain}, job {job_id} completed")
        return "completed"
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.autocommit = True


def fail_job(conn, job_id, error_message, executor="claude"):
    """Mark a research job as failed with an error message."""
    cur = conn.cursor()
    cur.execute(
        "UPDATE research_jobs SET status = 'failed', completed_at = now(), "
        "error = %s, progress_message = NULL "
        "WHERE id = %s AND executor = %s AND status = 'in_progress'",
        (error_message[:500], job_id, executor)
    )
    eprint(f"  [research_db] Job {job_id} failed: {error_message[:100]}")


def reap_stale_jobs(conn, timeout_minutes=15, executor="claude"):
    """Transition stuck in_progress jobs to failed.

    Called at the start of every /research skill run.
    Prevents permanently stuck jobs from blocking re-requests
    (the partial unique index prevents new jobs while one is active).

    Returns:
        number of jobs reaped
    """
    cur = conn.cursor()
    cur.execute(
        "UPDATE research_jobs SET status = 'failed', "
        "completed_at = now(), "
        "error = 'Timed out — skill crashed or lost connection', "
        "progress_message = NULL "
        "WHERE executor = %s AND status = 'in_progress' "
        "AND started_at < now() - interval '%s minutes' "
        "RETURNING id, domain",
        (executor, timeout_minutes)
    )
    reaped = cur.fetchall()
    if reaped:
        for row in reaped:
            eprint(f"  [research_db] Reaped stale job {row[0]} for {row[1]}")
    return len(reaped)


def get_pending_count(conn, executor="claude"):
    """Count pending research jobs for one executor."""
    cur = conn.cursor()
    cur.execute(
        "SELECT COUNT(*) FROM research_jobs WHERE executor = %s AND status = 'pending'",
        (executor,)
    )
    return cur.fetchone()[0]


def ensure_pending_job(conn, domain, executor="claude"):
    """Create a pending research job if one doesn't already exist (active or completed).

    Used by the /prospect pipeline to auto-queue research before scoring.
    Idempotent — skips if an active job exists or research_data already exists.

    Returns:
        True if a new job was created, False if skipped
    """
    cur = conn.cursor()

    # Check if research_data already exists
    cur.execute(
        "SELECT research_data IS NOT NULL AS has_research FROM companies WHERE domain = %s",
        (domain,)
    )
    row = cur.fetchone()
    if row and row[0]:
        return False

    # Check if active job already exists (partial unique index will reject duplicates,
    # but check first to avoid noisy constraint violations)
    cur.execute(
        "SELECT id FROM research_jobs WHERE domain = %s AND status IN ('pending', 'in_progress')",
        (domain,)
    )
    if cur.fetchone():
        return False

    cur.execute(
        "INSERT INTO research_jobs (domain, executor, status) VALUES (%s, %s, 'pending')",
        (domain, executor)
    )
    return True
