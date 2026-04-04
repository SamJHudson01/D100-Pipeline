import assert from "node:assert/strict";
import path from "node:path";
import { Pool } from "pg";
import dotenv from "dotenv";
import {
  buildBriefResearchActionsView,
  buildResearchEmptyStateView,
} from "../lib/research/presentation.ts";
import { MANUAL_AGENT_LABEL } from "../lib/manual-agent.ts";
import {
  claimNextResearchJob,
  closeResearchWorkerPool,
  completeClaimedResearchJob,
  reapStaleResearchJobs,
  updateClaimedResearchJobProgress,
} from "../lib/research/queue.ts";
import type { ResearchRouteState } from "../lib/research/service.ts";

dotenv.config({ path: path.resolve(process.cwd(), ".env") });

type LogStatus = "passed" | "failed" | "skipped";

function log(check: string, status: LogStatus, details?: Record<string, unknown>): void {
  console.log(
    JSON.stringify({
      scope: "research-smoke",
      check,
      status,
      ...(details ?? {}),
    }),
  );
}

function makeCompletedState(executor: "claude" | "openrouter"): ResearchRouteState {
  return {
    kind: "completed",
    hasResearchData: true,
    completedExecutor: executor,
    activeJob: null,
    latestJob: {
      id: "job-completed",
      executor,
      status: "completed",
      progressMessage: null,
      requestedAt: new Date(),
      startedAt: new Date(),
      completedAt: new Date(),
      error: null,
    },
    recoveryAction: null,
  };
}

function makeActiveState(
  executor: "claude" | "openrouter",
  status: "pending" | "in_progress",
  progressMessage: string | null = null,
): ResearchRouteState {
  return {
    kind: "active",
    hasResearchData: false,
    completedExecutor: null,
    activeJob: {
      id: "job-active",
      executor,
      status,
      progressMessage,
      requestedAt: new Date(),
      startedAt: new Date(),
      completedAt: null,
      error: null,
    },
    latestJob: {
      id: "job-active",
      executor,
      status,
      progressMessage,
      requestedAt: new Date(),
      startedAt: new Date(),
      completedAt: null,
      error: null,
    },
    recoveryAction: null,
  };
}

function makeFailedState(executor: "claude" | "openrouter"): ResearchRouteState {
  return {
    kind: "failed",
    hasResearchData: false,
    completedExecutor: null,
    activeJob: null,
    latestJob: {
      id: "job-failed",
      executor,
      status: "failed",
      progressMessage: null,
      requestedAt: new Date(),
      startedAt: new Date(),
      completedAt: new Date(),
      error: `${executor} failed`,
    },
    recoveryAction: { type: "retry", executor },
  };
}

function makeIdleState(): ResearchRouteState {
  return {
    kind: "idle",
    hasResearchData: false,
    completedExecutor: null,
    activeJob: null,
    latestJob: null,
    recoveryAction: { type: "request" },
  };
}

function makeResearchData(summary: string) {
  return {
    version: 1,
    researchedAt: new Date().toISOString(),
    summary,
    meta: {
      totalSearches: 1,
      totalDurationMs: 1,
      phasesCompleted: ["scope", "synthesis"],
      phasesFailed: [],
    },
  };
}

function runUiStateChecks(): void {
  const completed = buildBriefResearchActionsView(makeCompletedState("openrouter"));
  assert.equal(completed.actions[0].disabled, true);
  assert.equal(completed.actions[1].label, "Research Complete");

  const activeClaude = buildBriefResearchActionsView(
    makeActiveState("claude", "pending"),
  );
  assert.equal(activeClaude.actions[0].label, "Research Queued");
  assert.equal(activeClaude.actions[1].label, "Already Covered");

  const activeOpenRouter = buildBriefResearchActionsView(
    makeActiveState(
      "openrouter",
      "in_progress",
      "Waiting for OpenRouter response",
    ),
  );
  assert.equal(
    activeOpenRouter.actions[1].hint,
    "Waiting for OpenRouter response",
  );

  const activeOpenRouterPage = buildResearchEmptyStateView(
    makeActiveState(
      "openrouter",
      "in_progress",
      "Validating research payload before save",
    ),
    "Acme",
  );
  assert.match(activeOpenRouterPage.title, /OpenRouter research in progress/);
  assert.match(
    activeOpenRouterPage.message,
    /Current stage: Validating research payload before save/,
  );

  const failedOpenRouter = buildBriefResearchActionsView(
    makeFailedState("openrouter"),
  );
  assert.equal(failedOpenRouter.actions[1].label, "Retry with OpenRouter");
  assert.match(failedOpenRouter.notice ?? "", /Last run failed via OpenRouter/);

  const idle = buildResearchEmptyStateView(makeIdleState(), "Acme");
  assert.equal(
    idle.message,
    `Open the brief page for Acme to queue research via ${MANUAL_AGENT_LABEL} or OpenRouter.`,
  );

  log("ui_state_matrix", "passed");
}

async function runDbChecks(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    log("db_queue_invariants", "skipped", {
      reason: "DATABASE_URL is not set",
    });
    return;
  }

  const pool = new Pool({ connectionString: databaseUrl });
  const suffix = Date.now().toString();
  const primaryDomain = `research-smoke-${suffix}.example.com`;
  const staleOpenRouterDomain = `research-stale-or-${suffix}.example.com`;
  const staleClaudeDomain = `research-stale-cl-${suffix}.example.com`;

  try {
    await pool.query(
      `INSERT INTO companies (domain, name) VALUES ($1, $2), ($3, $4), ($5, $6)`,
      [
        primaryDomain,
        "Research Smoke",
        staleOpenRouterDomain,
        "Research Stale OpenRouter",
        staleClaudeDomain,
        "Research Stale Claude",
      ],
    );

    await pool.query(
      `
        INSERT INTO research_jobs (domain, executor, status, started_at)
        VALUES
          ($1, 'openrouter', 'in_progress', now() - interval '20 minutes'),
          ($2, 'claude', 'in_progress', now() - interval '20 minutes')
      `,
      [staleOpenRouterDomain, staleClaudeDomain],
    );

    const reaped = await reapStaleResearchJobs("openrouter", 15);
    assert.equal(reaped.length, 1);
    assert.equal(reaped[0]?.domain, staleOpenRouterDomain);

    await pool.query(
      `INSERT INTO research_jobs (domain, executor, status) VALUES ($1, 'claude', 'pending')`,
      [primaryDomain],
    );

    const openRouterClaimBefore = await claimNextResearchJob(
      "openrouter",
      primaryDomain,
    );
    assert.equal(openRouterClaimBefore, null);

    const claudeClaim = await claimNextResearchJob("claude", primaryDomain);
    assert.ok(claudeClaim);
    assert.equal(claudeClaim?.executor, "claude");
    await updateClaimedResearchJobProgress({
      jobId: claudeClaim.id,
      executor: "claude",
      progressMessage: "Collecting final dossier",
    });

    const progressRow = await pool.query<{ progress_message: string | null }>(
      `SELECT progress_message FROM research_jobs WHERE id = $1::uuid`,
      [claudeClaim.id],
    );
    assert.equal(
      progressRow.rows[0]?.progress_message,
      "Collecting final dossier",
    );

    const openRouterClaimWhileActive = await claimNextResearchJob(
      "openrouter",
      primaryDomain,
    );
    assert.equal(openRouterClaimWhileActive, null);

    const firstCompletion = await completeClaimedResearchJob({
      jobId: claudeClaim.id,
      domain: primaryDomain,
      executor: "claude",
      researchData: makeResearchData("Claude summary"),
    });
    assert.equal(firstCompletion.outcome, "completed");

    await pool.query(
      `INSERT INTO research_jobs (domain, executor, status) VALUES ($1, 'openrouter', 'pending')`,
      [primaryDomain],
    );

    const openRouterClaim = await claimNextResearchJob("openrouter", primaryDomain);
    assert.ok(openRouterClaim);

    const secondCompletion = await completeClaimedResearchJob({
      jobId: openRouterClaim.id,
      domain: primaryDomain,
      executor: "openrouter",
      researchData: makeResearchData("OpenRouter summary"),
    });
    assert.equal(secondCompletion.outcome, "skipped_existing_data");

    const company = await pool.query<{ research_data: { summary?: string } }>(
      `SELECT research_data FROM companies WHERE domain = $1`,
      [primaryDomain],
    );
    assert.equal(company.rows[0]?.research_data?.summary, "Claude summary");

    const failedJob = await pool.query<{ status: string; error: string | null }>(
      `SELECT status, error FROM research_jobs WHERE id = $1::uuid`,
      [openRouterClaim.id],
    );
    assert.equal(failedJob.rows[0]?.status, "failed");
    assert.equal(
      failedJob.rows[0]?.error,
      "Research already exists for this company",
    );

    log("db_queue_invariants", "passed", {
      primaryDomain,
    });
  } catch (error) {
    log("db_queue_invariants", "failed", {
      message: error instanceof Error ? error.message : String(error),
    });
    throw error;
  } finally {
    await pool.query(
      `DELETE FROM companies WHERE domain = ANY($1::text[])`,
      [[primaryDomain, staleOpenRouterDomain, staleClaudeDomain]],
    ).catch(() => undefined);
    await pool.end().catch(() => undefined);
    await closeResearchWorkerPool().catch(() => undefined);
  }
}

async function main(): Promise<void> {
  const runDb = process.argv.includes("--db");

  runUiStateChecks();

  if (runDb) {
    await runDbChecks();
  } else {
    log("db_queue_invariants", "skipped", {
      reason: "Run with --db to exercise live queue checks",
    });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
