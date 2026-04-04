import { describe, it, expect, afterAll } from "vitest";
import { getTestDb, setupTestDb } from "./helpers/setup";
import { seedCompany, seedResearchJob } from "./helpers/factories";
import { cleanupDomains } from "./helpers/cleanup";
import {
  enqueueResearchJob,
  ResearchCompanyNotFoundError,
} from "@/lib/research/service";

setupTestDb();

const TEST_DOMAINS = [
  "eq1-missing.com",
  "eq2-acme.com",
  "eq3-acme.com",
  "eq4-acme.com",
  "eq5-acme.com",
];

afterAll(async () => {
  await cleanupDomains(getTestDb(), TEST_DOMAINS);
});

// ─── enqueueResearchJob ───────────────────────────────────────────────────

describe("when enqueuing a research job", () => {
  it("EQ1: throws ResearchCompanyNotFoundError for nonexistent company", async () => {
    await expect(
      enqueueResearchJob("eq1-missing.com", "openrouter"),
    ).rejects.toThrow(ResearchCompanyNotFoundError);
  });

  it("EQ2: returns completed without creating job when company already has research data", async () => {
    const db = getTestDb();
    await seedCompany(db, {
      domain: "eq2-acme.com",
      researchData: { version: 1, summary: "existing" },
    });

    const result = await enqueueResearchJob("eq2-acme.com", "openrouter");

    expect(result.jobId).toBeNull();
    expect(result.executor).toBeNull();
    expect(result.status).toBe("completed");
    expect(result.created).toBe(false);

    // Verify no job was created
    const jobs = await db.researchJob.findMany({
      where: { domain: "eq2-acme.com" },
    });
    expect(jobs.length).toBe(0);
  });

  it("EQ3: returns existing active job without creating a new one", async () => {
    const db = getTestDb();
    await seedCompany(db, { domain: "eq3-acme.com" });
    const existingJob = await seedResearchJob(db, {
      domain: "eq3-acme.com",
      executor: "claude",
      status: "pending",
    });

    const result = await enqueueResearchJob("eq3-acme.com", "openrouter");

    expect(result.jobId).toBe(existingJob.id);
    expect(result.executor).toBe("claude"); // existing job's executor, not the requested one
    expect(result.status).toBe("pending");
    expect(result.created).toBe(false);

    // Verify no additional job was created
    const jobs = await db.researchJob.findMany({
      where: { domain: "eq3-acme.com" },
    });
    expect(jobs.length).toBe(1);
  });

  it("EQ4: creates a new pending job when no research data and no active job", async () => {
    const db = getTestDb();
    await seedCompany(db, { domain: "eq4-acme.com" });

    const result = await enqueueResearchJob("eq4-acme.com", "openrouter");

    expect(result.jobId).not.toBeNull();
    expect(result.executor).toBe("openrouter");
    expect(result.status).toBe("pending");
    expect(result.created).toBe(true);

    // Verify DB state
    const job = await db.researchJob.findFirst({
      where: { domain: "eq4-acme.com" },
    });
    expect(job).not.toBeNull();
    expect(job!.executor).toBe("openrouter");
    expect(job!.status).toBe("pending");
    expect(job!.requestedAt).not.toBeNull();
  });

  it("EQ5: does not create duplicate when failed job exists (no active conflict)", async () => {
    const db = getTestDb();
    await seedCompany(db, { domain: "eq5-acme.com" });
    await seedResearchJob(db, {
      domain: "eq5-acme.com",
      executor: "claude",
      status: "failed",
      error: "Previous run crashed",
      completedAt: new Date(),
    });

    // A failed job is not active, so a new job should be created
    const result = await enqueueResearchJob("eq5-acme.com", "openrouter");

    expect(result.created).toBe(true);
    expect(result.executor).toBe("openrouter");
    expect(result.status).toBe("pending");

    // Verify two jobs exist: one failed, one pending
    const jobs = await db.researchJob.findMany({
      where: { domain: "eq5-acme.com" },
      orderBy: { requestedAt: "asc" },
    });
    expect(jobs.length).toBe(2);
    expect(jobs[0].status).toBe("failed");
    expect(jobs[1].status).toBe("pending");
  });
});
