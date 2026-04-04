import type { PrismaClient } from "@/lib/generated/prisma/client";

/**
 * Delete all test data for a set of domains.
 * Respects FK ordering: ResearchJob -> Touchpoint -> CompanyRegion -> Company.
 *
 * Scoped to specific domains — never touches other data in the shared database.
 */
export async function cleanupDomains(
  db: PrismaClient,
  domains: string[],
): Promise<void> {
  if (domains.length === 0) return;

  // Children first (FK ordering)
  await db.researchJob.deleteMany({ where: { domain: { in: domains } } });
  await db.touchpoint.deleteMany({ where: { domain: { in: domains } } });
  await db.companyRegion.deleteMany({ where: { domain: { in: domains } } });
  await db.company.deleteMany({ where: { domain: { in: domains } } });
}

/**
 * Delete pipeline run rows by run ID.
 * Pipeline runs have no FK to companies — separate cleanup.
 */
export async function cleanupPipelineRuns(
  db: PrismaClient,
  runIds: string[],
): Promise<void> {
  if (runIds.length === 0) return;
  await db.pipelineRun.deleteMany({ where: { runId: { in: runIds } } });
}
