import { Pool, type PoolClient } from "pg";
import type { ResearchExecutor } from "../domain.ts";

const MAX_RESEARCH_SIZE_BYTES = 500_000;
const STALE_JOB_ERROR = "Timed out — worker crashed or lost connection";
const RESEARCH_ALREADY_EXISTS_ERROR = "Research already exists for this company";
const SERIALIZABLE_RETRY_SQLSTATE = "40001";
const SERIALIZABLE_MAX_ATTEMPTS = 3;
const MAX_PROGRESS_MESSAGE_LENGTH = 200;

type ClaimedResearchJobRow = {
  id: string;
  domain: string;
  executor: ResearchExecutor;
  status: "in_progress";
  requestedAt: Date;
  startedAt: Date;
};

type ReapedResearchJob = {
  id: string;
  domain: string;
};

type WorkerCompanyContext = {
  domain: string;
  name: string;
  url: string | null;
  description: string | null;
  enrichmentData: unknown;
};

type SerializableError = Error & { code?: string };

let workerPool: Pool | null = null;

function getDatabaseUrl(): string {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is not set for the OpenRouter worker");
  }

  return databaseUrl;
}

function getWorkerPool(): Pool {
  workerPool ??= new Pool({
    connectionString: getDatabaseUrl(),
  });

  return workerPool;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toSafeJobError(errorMessage: string): string {
  return errorMessage.slice(0, 500);
}

function toSafeProgressMessage(progressMessage: string): string {
  return progressMessage.slice(0, MAX_PROGRESS_MESSAGE_LENGTH);
}

function getPayloadSize(payload: string): number {
  return Buffer.byteLength(payload, "utf8");
}

function isSerializableConflict(error: unknown): error is SerializableError {
  return (
    error instanceof Error &&
    (error as SerializableError).code === SERIALIZABLE_RETRY_SQLSTATE
  );
}

async function withSerializableRetry<T>(
  operation: () => Promise<T>,
): Promise<T> {
  for (let attempt = 1; attempt <= SERIALIZABLE_MAX_ATTEMPTS; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (!isSerializableConflict(error) || attempt === SERIALIZABLE_MAX_ATTEMPTS) {
        throw error;
      }

      await sleep(25 * attempt);
    }
  }

  throw new Error("Serializable retry exhausted without returning");
}

export async function closeResearchWorkerPool(): Promise<void> {
  if (workerPool) {
    await workerPool.end();
    workerPool = null;
  }
}

export async function claimNextResearchJob(
  executor: ResearchExecutor,
  domain?: string,
): Promise<ClaimedResearchJobRow | null> {
  const pool = getWorkerPool();
  const result = domain
    ? await pool.query<ClaimedResearchJobRow>(
        `
          UPDATE research_jobs
          SET
            status = 'in_progress',
            started_at = now(),
            error = NULL,
            progress_message = NULL
          WHERE id = (
            SELECT id
            FROM research_jobs
            WHERE executor = $1
              AND domain = $2
              AND status = 'pending'
            ORDER BY requested_at ASC
            LIMIT 1
            FOR UPDATE SKIP LOCKED
          )
          RETURNING
            id,
            domain,
            executor,
            status,
            requested_at AS "requestedAt",
            started_at AS "startedAt"
        `,
        [executor, domain],
      )
    : await pool.query<ClaimedResearchJobRow>(
        `
          UPDATE research_jobs
          SET
            status = 'in_progress',
            started_at = now(),
            error = NULL,
            progress_message = NULL
          WHERE id = (
            SELECT id
            FROM research_jobs
            WHERE executor = $1
              AND status = 'pending'
            ORDER BY requested_at ASC
            LIMIT 1
            FOR UPDATE SKIP LOCKED
          )
          RETURNING
            id,
            domain,
            executor,
            status,
            requested_at AS "requestedAt",
            started_at AS "startedAt"
        `,
        [executor],
      );

  return result.rows[0] ?? null;
}

export async function reapStaleResearchJobs(
  executor: ResearchExecutor,
  timeoutMinutes: number,
): Promise<ReapedResearchJob[]> {
  const pool = getWorkerPool();
  const result = await pool.query<ReapedResearchJob>(
    `
      UPDATE research_jobs
      SET
        status = 'failed',
        completed_at = now(),
        error = $2,
        progress_message = NULL
      WHERE executor = $1
        AND status = 'in_progress'
        AND started_at < now() - ($3 * interval '1 minute')
      RETURNING id, domain
    `,
    [executor, STALE_JOB_ERROR, timeoutMinutes],
  );

  return result.rows;
}

export async function getResearchWorkerCompanyContext(
  domain: string,
): Promise<WorkerCompanyContext | null> {
  const pool = getWorkerPool();
  const result = await pool.query<WorkerCompanyContext>(
    `
      SELECT
        domain,
        name,
        url,
        description,
        enrichment_data AS "enrichmentData"
      FROM companies
      WHERE domain = $1
      LIMIT 1
    `,
    [domain],
  );

  return result.rows[0] ?? null;
}

export async function updateClaimedResearchJobProgress(params: {
  jobId: string;
  executor: ResearchExecutor;
  progressMessage: string;
}): Promise<void> {
  const result = await getWorkerPool().query<{ id: string }>(
    `
      UPDATE research_jobs
      SET progress_message = $3
      WHERE id = $1::uuid
        AND executor = $2
        AND status = 'in_progress'
      RETURNING id
    `,
    [
      params.jobId,
      params.executor,
      toSafeProgressMessage(params.progressMessage),
    ],
  );

  if (!result.rows[0]) {
    throw new Error("Cannot update progress for a research job that is not currently claimed");
  }
}

async function completeClaimedResearchJobOnce(
  client: PoolClient,
  params: {
    jobId: string;
    domain: string;
    executor: ResearchExecutor;
    researchData: unknown;
  },
): Promise<{ outcome: "completed" | "skipped_existing_data" }> {
  const payload = JSON.stringify(params.researchData);
  if (getPayloadSize(payload) > MAX_RESEARCH_SIZE_BYTES) {
    throw new Error(
      `research_data too large: ${getPayloadSize(payload)} bytes (max ${MAX_RESEARCH_SIZE_BYTES})`,
    );
  }

  await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");

  try {
    const claimedJob = await client.query<{ id: string }>(
      `
        SELECT id
        FROM research_jobs
        WHERE id = $1::uuid
          AND executor = $2
          AND status = 'in_progress'
        FOR UPDATE
      `,
      [params.jobId, params.executor],
    );

    if (!claimedJob.rows[0]) {
      throw new Error("Cannot complete a research job that is not currently claimed");
    }

    const companyWrite = await client.query<{ domain: string }>(
      `
        UPDATE companies
        SET research_data = $1::jsonb
        WHERE domain = $2
          AND research_data IS NULL
        RETURNING domain
      `,
      [payload, params.domain],
    );

    if (!companyWrite.rows[0]) {
      const failedRows = await client.query<{ id: string }>(
        `
          UPDATE research_jobs
          SET
            status = 'failed',
            completed_at = now(),
            error = $3,
            progress_message = NULL
          WHERE id = $1::uuid
            AND executor = $2
            AND status = 'in_progress'
          RETURNING id
        `,
        [params.jobId, params.executor, RESEARCH_ALREADY_EXISTS_ERROR],
      );

      if (!failedRows.rows[0]) {
        throw new Error("Claimed job was lost before stale completion could be recorded");
      }

      await client.query("COMMIT");
      return { outcome: "skipped_existing_data" };
    }

    const completedRows = await client.query<{ id: string }>(
      `
        UPDATE research_jobs
        SET
          status = 'completed',
          completed_at = now(),
          error = NULL,
          progress_message = NULL
        WHERE id = $1::uuid
          AND executor = $2
          AND status = 'in_progress'
        RETURNING id
      `,
      [params.jobId, params.executor],
    );

    if (!completedRows.rows[0]) {
      throw new Error("Claimed job was lost before completion could be recorded");
    }

    await client.query("COMMIT");
    return { outcome: "completed" };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

export async function completeClaimedResearchJob(params: {
  jobId: string;
  domain: string;
  executor: ResearchExecutor;
  researchData: unknown;
}): Promise<{ outcome: "completed" | "skipped_existing_data" }> {
  return withSerializableRetry(async () => {
    const client = await getWorkerPool().connect();
    try {
      return await completeClaimedResearchJobOnce(client, params);
    } finally {
      client.release();
    }
  });
}

export async function failClaimedResearchJob(params: {
  jobId: string;
  executor: ResearchExecutor;
  errorMessage: string;
}): Promise<void> {
  await getWorkerPool().query(
    `
      UPDATE research_jobs
      SET
        status = 'failed',
        completed_at = now(),
        error = $3,
        progress_message = NULL
      WHERE id = $1::uuid
        AND executor = $2
        AND status = 'in_progress'
    `,
    [params.jobId, params.executor, toSafeJobError(params.errorMessage)],
  );
}
