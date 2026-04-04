import {
  claimNextResearchJob,
  closeResearchWorkerPool,
  completeClaimedResearchJob,
  failClaimedResearchJob,
  getResearchWorkerCompanyContext,
  reapStaleResearchJobs,
  updateClaimedResearchJobProgress,
} from "../lib/research/queue.ts";
import { spawn } from "node:child_process";
import {
  loadOpenRouterConfig,
  type OpenRouterResearchProgressEvent,
  runOpenRouterResearch,
  toSafeOpenRouterJobError,
} from "../lib/research/openrouter.ts";
import path from "node:path";
import dotenv from "dotenv";
import { enrichmentDataSchema, type EnrichmentData } from "../lib/domain.ts";

dotenv.config({ path: path.resolve(process.cwd(), ".env") });

type WorkerOptions = {
  once: boolean;
  pollIntervalMs: number;
  staleTimeoutMinutes: number;
  domain?: string;
};

const WORKER_SCOPE = "openrouter-worker";

function logWorkerEvent(
  event: string,
  details: Record<string, unknown> = {},
): void {
  console.log(
    JSON.stringify({
      scope: WORKER_SCOPE,
      event,
      timestamp: new Date().toISOString(),
      ...details,
    }),
  );
}

function logWorkerError(
  event: string,
  details: Record<string, unknown> = {},
): void {
  console.error(
    JSON.stringify({
      scope: WORKER_SCOPE,
      event,
      timestamp: new Date().toISOString(),
      ...details,
    }),
  );
}

function parseArgs(argv: string[]): WorkerOptions {
  const options: WorkerOptions = {
    once: false,
    pollIntervalMs: 5000,
    staleTimeoutMinutes: 15,
  };

  for (const arg of argv) {
    if (arg === "--once") {
      options.once = true;
      continue;
    }

    if (arg.startsWith("--poll-interval-ms=")) {
      options.pollIntervalMs = Number(arg.split("=")[1]);
      continue;
    }

    if (arg.startsWith("--stale-timeout-minutes=")) {
      options.staleTimeoutMinutes = Number(arg.split("=")[1]);
      continue;
    }

    if (arg.startsWith("--domain=")) {
      options.domain = arg.split("=")[1];
    }
  }

  return options;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function loadWorkerCompanyContext(domain: string): Promise<{
  domain: string;
  name: string;
  url: string | null;
  description: string | null;
  enrichmentData: EnrichmentData;
}> {
  const company = await getResearchWorkerCompanyContext(domain);
  if (!company) {
    throw new Error(`Claimed company no longer exists: ${domain}`);
  }

  let enrichmentData: EnrichmentData = {};
  if (company.enrichmentData && typeof company.enrichmentData === "object") {
    const parsed = enrichmentDataSchema.safeParse(company.enrichmentData);
    enrichmentData = parsed.success
      ? parsed.data
      : (company.enrichmentData as EnrichmentData);
  }

  return {
    domain: company.domain,
    name: company.name,
    url: company.url,
    description: company.description,
    enrichmentData,
  };
}

function hasEnrichmentData(enrichmentData: EnrichmentData): boolean {
  return Object.keys(enrichmentData).length > 0;
}

function summarizeCommandOutput(output: string): string {
  return output
    .trim()
    .split("\n")
    .slice(-5)
    .join(" | ")
    .slice(0, 500);
}

async function runCompanyEnrichment(context: {
  domain: string;
  name: string;
  url: string | null;
  description: string | null;
}): Promise<void> {
  if (!context.url) {
    throw new Error(`Cannot enrich ${context.domain} without a website URL`);
  }

  const args = [
    "-m",
    "enrichers",
    "--domain",
    context.domain,
    "--name",
    context.name,
    "--url",
    context.url,
  ];

  if (context.description) {
    args.push("--description", context.description);
  }

  await new Promise<void>((resolve, reject) => {
    const child = spawn("python3", args, {
      cwd: path.resolve(process.cwd(), "scripts"),
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk: Buffer | string) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      const diagnostic = summarizeCommandOutput(stderr || stdout);
      reject(
        new Error(
          `Enrichment command failed (${code ?? "unknown"}): ${diagnostic || "no output"}`,
        ),
      );
    });
  });
}

async function processOpenRouterJob(job: {
  id: string;
  domain: string;
}): Promise<void> {
  let currentStage = "claimed";

  const reportProgress = async (
    stage:
      | OpenRouterResearchProgressEvent["stage"]
      | "loading_context"
      | "enriching_context"
      | "reloading_context"
      | "persisting_result",
    message: string,
    details: Record<string, unknown> = {},
  ): Promise<void> => {
    currentStage = stage;
    await updateClaimedResearchJobProgress({
      jobId: job.id,
      executor: "openrouter",
      progressMessage: message,
    });
    logWorkerEvent("job_progress", {
      jobId: job.id,
      domain: job.domain,
      stage,
      message,
      ...details,
    });
  };

  try {
    await reportProgress("loading_context", "Loading company context");
    let context = await loadWorkerCompanyContext(job.domain);

    if (!hasEnrichmentData(context.enrichmentData)) {
      await reportProgress(
        "enriching_context",
        "No enrichment found. Running enrichment pipeline first",
      );
      await runCompanyEnrichment(context);
      await reportProgress(
        "reloading_context",
        "Reloading company context after enrichment",
      );
      context = await loadWorkerCompanyContext(job.domain);

      if (!hasEnrichmentData(context.enrichmentData)) {
        throw new Error(
          "Enrichment pipeline completed but enrichment_data is still empty",
        );
      }
    }

    const startedAt = Date.now();
    const researchData = await runOpenRouterResearch(
      {
        companyName: context.name,
        domain: context.domain,
        websiteUrl: context.url,
        enrichmentData: context.enrichmentData,
      },
      {
        onProgress: (event) =>
          reportProgress(event.stage, event.message, event.details ?? {}),
      },
    );
    await reportProgress("persisting_result", "Saving research dossier");
    const payloadBytes = Buffer.byteLength(JSON.stringify(researchData), "utf8");
    const result = await completeClaimedResearchJob({
      jobId: job.id,
      domain: job.domain,
      executor: "openrouter",
      researchData,
    });

    const durationMs = Date.now() - startedAt;
    const searchCount = researchData.meta?.totalSearches ?? 0;

    logWorkerEvent("job_completed", {
      domain: job.domain,
      jobId: job.id,
      outcome: result.outcome,
      durationMs,
      searchCount,
      payloadBytes,
    });
  } catch (error) {
    logWorkerError("job_failed", {
      domain: job.domain,
      jobId: job.id,
      stage: currentStage,
      message: error instanceof Error ? error.message : String(error),
    });

    await failClaimedResearchJob({
      jobId: job.id,
      executor: "openrouter",
      errorMessage: toSafeOpenRouterJobError(error),
    });

    throw error;
  }
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const config = loadOpenRouterConfig();

  logWorkerEvent("startup", {
    model: config.model,
    once: options.once,
    pollIntervalMs: options.pollIntervalMs,
    staleTimeoutMinutes: options.staleTimeoutMinutes,
    domain: options.domain ?? null,
  });

  const reaped = await reapStaleResearchJobs(
    "openrouter",
    options.staleTimeoutMinutes,
  );
  if (reaped.length > 0) {
    logWorkerEvent("reaped_stale_jobs", {
      count: reaped.length,
      domains: reaped.map((job) => job.domain),
    });
  }

  while (true) {
    const job = await claimNextResearchJob("openrouter", options.domain);
    if (!job) {
      if (options.once) {
        return;
      }

      await sleep(options.pollIntervalMs);
      continue;
    }

    logWorkerEvent("job_claimed", {
      jobId: job.id,
      domain: job.domain,
      requestedAt: job.requestedAt.toISOString(),
      startedAt: job.startedAt.toISOString(),
    });

    try {
      await processOpenRouterJob(job);
    } catch (error) {
      if (options.once) {
        throw error;
      }
    }

    if (options.once) {
      return;
    }
  }
}

main()
  .catch((error) => {
    logWorkerError("fatal_error", {
      message: error instanceof Error ? error.message : String(error),
    });
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeResearchWorkerPool().catch((error: unknown) => {
      if (error instanceof Error) {
        logWorkerError("disconnect_error", {
          message: error.message,
        });
      }
    });
  });
