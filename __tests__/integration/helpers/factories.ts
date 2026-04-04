import type { PrismaClient, Prisma } from "@/lib/generated/prisma/client";

/** Default seed values — matches schema defaults + realistic test data. */
const DEFAULT_COMPANY = {
  name: "Factory Corp",
  url: "https://factory.com",
  description: "Test company",
  source: "yc",
  state: "qualified",
  score: 80,
  originalScore: 80,
  scoredAt: new Date("2026-03-01T00:00:00Z"),
  teamSize: 30,
  fundingStage: "seed",
  hasPricingPage: true,
  hasSignup: true,
  hasGrowthHire: false,
  totalAtsRoles: 0,
  dream100: false,
  archived: false,
  dismissed: false,
  pinned: false,
  pipelineStage: "backlog",
  sequencePaused: false,
  hasNewSignal: false,
  regionVerified: false,
} satisfies Partial<Prisma.CompanyCreateInput>;

/**
 * Insert a company row. Returns the full record.
 * Always pass a unique domain to prevent collisions between tests.
 */
export async function seedCompany(
  db: PrismaClient,
  overrides: Partial<Prisma.CompanyCreateInput> & { domain: string },
) {
  return db.company.create({
    data: { ...DEFAULT_COMPANY, ...overrides },
  });
}

/** Insert a company_regions row. */
export async function seedRegion(
  db: PrismaClient,
  domain: string,
  region: string = "uk",
) {
  return db.companyRegion.create({
    data: { domain, region },
  });
}

/** Insert a research_jobs row. Returns the full record. */
export async function seedResearchJob(
  db: PrismaClient,
  overrides: Partial<Prisma.ResearchJobUncheckedCreateInput> & {
    domain: string;
  },
) {
  return db.researchJob.create({
    data: {
      executor: "openrouter",
      status: "pending",
      ...overrides,
    },
  });
}

/** Insert a pipeline_runs row. Returns the full record. */
export async function seedPipelineRun(
  db: PrismaClient,
  overrides: Partial<Prisma.PipelineRunUncheckedCreateInput> & {
    runId: string;
  },
) {
  return db.pipelineRun.create({
    data: {
      runType: "daily",
      status: "completed",
      companiesProcessed: 0,
      companiesQualified: 0,
      companiesRejected: 0,
      region: "uk",
      ...overrides,
    },
  });
}

/** Insert a touchpoint row. Returns the full record. */
export async function seedTouchpoint(
  db: PrismaClient,
  overrides: Partial<Prisma.TouchpointUncheckedCreateInput> & {
    domain: string;
  },
) {
  return db.touchpoint.create({
    data: {
      touchDate: new Date(),
      channel: "email",
      type: "Follow up",
      ...overrides,
    },
  });
}
