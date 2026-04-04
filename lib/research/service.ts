import { z } from "zod";
import { Prisma } from "../generated/prisma/client";
import {
  ACTIVE_RESEARCH_JOB_STATUSES,
  domainSchema,
  researchExecutorSchema,
  researchJobStatusSchema,
  type ResearchExecutor,
  type ResearchJobStatus,
} from "../domain";
import { prisma } from "../prisma";
import { withSerializableRetry } from "../db/serializable";

type ResearchDbClient = typeof prisma | Prisma.TransactionClient;
type ActiveResearchJobStatus = (typeof ACTIVE_RESEARCH_JOB_STATUSES)[number];

const researchJobProjectionSelect = {
  id: true,
  executor: true,
  status: true,
  progressMessage: true,
  requestedAt: true,
  startedAt: true,
  completedAt: true,
  error: true,
} as const;

const companyResearchPresenceRowSchema = z.object({
  domain: domainSchema,
  hasResearchData: z.boolean(),
});

const researchSummaryRowSchema = z.object({
  summary: z.string().nullable(),
  personalizationHookCount: z.number().int().min(0),
});

type ResearchJobProjectionRecord = Prisma.ResearchJobGetPayload<{
  select: typeof researchJobProjectionSelect;
}>;

export type ResearchJobProjection = {
  id: string;
  executor: ResearchExecutor;
  status: ResearchJobStatus;
  progressMessage: string | null;
  requestedAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
  error: string | null;
};

export type ResearchRecoveryAction =
  | { type: "request" }
  | { type: "retry"; executor: ResearchExecutor }
  | null;

export type ResearchRouteState =
  | {
      kind: "completed";
      hasResearchData: true;
      completedExecutor: ResearchExecutor | null;
      activeJob: null;
      latestJob: ResearchJobProjection | null;
      recoveryAction: null;
    }
  | {
      kind: "active";
      hasResearchData: false;
      completedExecutor: null;
      activeJob: ResearchJobProjection & { status: ActiveResearchJobStatus };
      latestJob: ResearchJobProjection;
      recoveryAction: null;
    }
  | {
      kind: "failed";
      hasResearchData: false;
      completedExecutor: null;
      activeJob: null;
      latestJob: ResearchJobProjection;
      recoveryAction: { type: "retry"; executor: ResearchExecutor };
    }
  | {
      kind: "idle";
      hasResearchData: false;
      completedExecutor: null;
      activeJob: null;
      latestJob: ResearchJobProjection | null;
      recoveryAction: { type: "request" };
    };

export type ResearchEnqueueResult = {
  jobId: string | null;
  executor: ResearchExecutor | null;
  status: ResearchJobStatus;
  created: boolean;
};

export type ResearchPageSnapshot = {
  company: {
    domain: string;
    name: string;
    url: string | null;
    researchData: Prisma.JsonValue | null;
    score: number | null;
    originalScore: number | null;
    scoredAt: Date | null;
  };
  researchState: ResearchRouteState;
};

export type ResearchSummaryCard = z.infer<typeof researchSummaryRowSchema>;

export class ResearchCompanyNotFoundError extends Error {
  constructor(domain: string) {
    super(`Company not found: ${domain}`);
    this.name = "ResearchCompanyNotFoundError";
  }
}

function isActiveStatus(status: ResearchJobStatus): status is ActiveResearchJobStatus {
  return ACTIVE_RESEARCH_JOB_STATUSES.includes(status as ActiveResearchJobStatus);
}

function toResearchJobProjection(job: ResearchJobProjectionRecord): ResearchJobProjection {
  return {
    id: job.id,
    executor: researchExecutorSchema.parse(job.executor),
    status: researchJobStatusSchema.parse(job.status),
    progressMessage: job.progressMessage,
    requestedAt: job.requestedAt,
    startedAt: job.startedAt,
    completedAt: job.completedAt,
    error: job.error,
  };
}

async function readCompanyResearchPresence(
  db: ResearchDbClient,
  domain: string,
): Promise<z.infer<typeof companyResearchPresenceRowSchema> | null> {
  const rows = await db.$queryRaw<Array<{ domain: string; hasResearchData: boolean }>>(
    Prisma.sql`
      SELECT
        "domain",
        "research_data" IS NOT NULL AS "hasResearchData"
      FROM "companies"
      WHERE "domain" = ${domain}
      LIMIT 1
    `,
  );

  const row = rows[0];
  return row ? companyResearchPresenceRowSchema.parse(row) : null;
}

async function readLatestResearchJob(
  db: ResearchDbClient,
  domain: string,
): Promise<ResearchJobProjection | null> {
  const job = await db.researchJob.findFirst({
    where: { domain },
    orderBy: { requestedAt: "desc" },
    select: researchJobProjectionSelect,
  });

  return job ? toResearchJobProjection(job) : null;
}

async function readActiveResearchJob(
  db: ResearchDbClient,
  domain: string,
): Promise<ResearchJobProjection | null> {
  const job = await db.researchJob.findFirst({
    where: {
      domain,
      status: { in: [...ACTIVE_RESEARCH_JOB_STATUSES] },
    },
    orderBy: { requestedAt: "desc" },
    select: researchJobProjectionSelect,
  });

  return job ? toResearchJobProjection(job) : null;
}

function isActiveJobConflict(error: unknown): boolean {
  return (
    (error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002") ||
    (error instanceof Prisma.PrismaClientUnknownRequestError &&
      error.message.includes("research_jobs_domain_active_uniq"))
  );
}

export function buildResearchRouteState({
  hasResearchData,
  latestJob,
}: {
  hasResearchData: boolean;
  latestJob: ResearchJobProjection | null;
}): ResearchRouteState {
  if (hasResearchData) {
    return {
      kind: "completed",
      hasResearchData: true,
      completedExecutor: latestJob?.status === "completed" ? latestJob.executor : null,
      activeJob: null,
      latestJob,
      recoveryAction: null,
    };
  }

  if (latestJob && isActiveStatus(latestJob.status)) {
    return {
      kind: "active",
      hasResearchData: false,
      completedExecutor: null,
      activeJob: {
        ...latestJob,
        status: latestJob.status,
      },
      latestJob,
      recoveryAction: null,
    };
  }

  if (latestJob?.status === "failed") {
    return {
      kind: "failed",
      hasResearchData: false,
      completedExecutor: null,
      activeJob: null,
      latestJob,
      recoveryAction: { type: "retry", executor: latestJob.executor },
    };
  }

  return {
    kind: "idle",
    hasResearchData: false,
    completedExecutor: null,
    activeJob: null,
    latestJob,
    recoveryAction: { type: "request" },
  };
}

export async function getResearchRouteState(domain: string): Promise<ResearchRouteState> {
  const [company, latestJob] = await Promise.all([
    readCompanyResearchPresence(prisma, domain),
    readLatestResearchJob(prisma, domain),
  ]);

  if (!company) {
    throw new ResearchCompanyNotFoundError(domain);
  }

  return buildResearchRouteState({
    hasResearchData: company.hasResearchData,
    latestJob,
  });
}

async function recoverEnqueueConflict(domain: string): Promise<ResearchEnqueueResult> {
  const state = await getResearchRouteState(domain);

  if (state.kind === "completed") {
    return {
      jobId: null,
      executor: null,
      status: "completed",
      created: false,
    };
  }

  if (state.kind === "active") {
    return {
      jobId: state.activeJob.id,
      executor: state.activeJob.executor,
      status: state.activeJob.status,
      created: false,
    };
  }

  throw new Error("Research enqueue conflicted without an active or completed state");
}

export async function enqueueResearchJob(
  domain: string,
  executor: ResearchExecutor,
): Promise<ResearchEnqueueResult> {
  try {
    return await withSerializableRetry(() =>
      prisma.$transaction(
        async (tx) => {
          const company = await readCompanyResearchPresence(tx, domain);
          if (!company) {
            throw new ResearchCompanyNotFoundError(domain);
          }

          if (company.hasResearchData) {
            return {
              jobId: null,
              executor: null,
              status: "completed" as const,
              created: false,
            };
          }

          const existing = await readActiveResearchJob(tx, domain);
          if (existing) {
            return {
              jobId: existing.id,
              executor: existing.executor,
              status: existing.status,
              created: false,
            };
          }

          const job = await tx.researchJob.create({
            data: {
              domain,
              executor,
              status: "pending",
            },
            select: {
              id: true,
              executor: true,
              status: true,
            } as const,
          });

          return {
            jobId: job.id,
            executor: researchExecutorSchema.parse(job.executor),
            status: researchJobStatusSchema.parse(job.status),
            created: true,
          };
        },
        {
          // Serializable because enqueue is a check-then-act operation on shared queue state.
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        },
      ),
    );
  } catch (error) {
    if (isActiveJobConflict(error)) {
      return recoverEnqueueConflict(domain);
    }

    throw error;
  }
}

export async function getResearchPageSnapshot(domain: string): Promise<ResearchPageSnapshot> {
  const company = await prisma.company.findUnique({
    where: { domain },
    select: {
      domain: true,
      name: true,
      url: true,
      researchData: true,
      score: true,
      originalScore: true,
      scoredAt: true,
    },
  });

  if (!company) {
    throw new ResearchCompanyNotFoundError(domain);
  }

  const latestJob = await readLatestResearchJob(prisma, domain);

  return {
    company,
    researchState: buildResearchRouteState({
      hasResearchData: company.researchData != null,
      latestJob,
    }),
  };
}

export async function getResearchSummaryCard(
  domain: string,
): Promise<ResearchSummaryCard | null> {
  const rows = await prisma.$queryRaw<
    Array<{ summary: string | null; personalizationHookCount: number }>
  >(Prisma.sql`
    SELECT
      "research_data"->>'summary' AS "summary",
      CASE
        WHEN jsonb_typeof("research_data"->'personalizationHooks') = 'array'
        THEN jsonb_array_length("research_data"->'personalizationHooks')
        ELSE 0
      END AS "personalizationHookCount"
    FROM "companies"
    WHERE "domain" = ${domain}
      AND "research_data" IS NOT NULL
    LIMIT 1
  `);

  const row = rows[0];
  return row ? researchSummaryRowSchema.parse(row) : null;
}
