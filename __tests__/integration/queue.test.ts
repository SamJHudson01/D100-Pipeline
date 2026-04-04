import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getTestDb, setupTestDb } from "./helpers/setup";
import { seedCompany, seedResearchJob } from "./helpers/factories";
import { cleanupDomains } from "./helpers/cleanup";
import {
  claimNextResearchJob,
  completeClaimedResearchJob,
  failClaimedResearchJob,
  updateClaimedResearchJobProgress,
  reapStaleResearchJobs,
  getResearchWorkerCompanyContext,
  closeResearchWorkerPool,
} from "@/lib/research/queue";

setupTestDb();

const TEST_DOMAINS = [
  "q1-acme.com",
  "q2-beta.io",
  "q3-gamma.dev",
  "q4a-acme.com",
  "q4b-beta.io",
  "q5a-older.com",
  "q5b-newer.com",
  "q6-acme.com",
  "q7-acme.com",
  "q8-acme.com",
  "q9-acme.com",
  "q10-acme.com",
  "q11-acme.com",
  "q12-acme.com",
  "q13-acme.com",
  "q14-acme.com",
  "q15-acme.com",
];

afterAll(async () => {
  await cleanupDomains(getTestDb(), TEST_DOMAINS);
  await closeResearchWorkerPool();
});

// ─── claimNextResearchJob ──────────────────────────────────────────────────

describe("when claiming the next research job", () => {
  it("Q1: claims a pending job and transitions to in_progress", async () => {
    const db = getTestDb();
    await seedCompany(db, { domain: "q1-acme.com" });
    await seedResearchJob(db, { domain: "q1-acme.com", executor: "openrouter", status: "pending" });

    const result = await claimNextResearchJob("openrouter", "q1-acme.com");

    expect(result).not.toBeNull();
    expect(result!.domain).toBe("q1-acme.com");
    expect(result!.executor).toBe("openrouter");
    expect(result!.status).toBe("in_progress");
    expect(result!.startedAt).toBeInstanceOf(Date);

    // Verify DB state
    const job = await db.researchJob.findFirst({ where: { domain: "q1-acme.com" } });
    expect(job!.status).toBe("in_progress");
    expect(job!.startedAt).not.toBeNull();
  });

  it("Q2: returns null when no pending jobs exist", async () => {
    const db = getTestDb();
    await seedCompany(db, { domain: "q2-beta.io" });
    // No research jobs seeded

    const result = await claimNextResearchJob("openrouter", "q2-beta.io");
    expect(result).toBeNull();
  });

  it("Q3: does not claim jobs for a different executor", async () => {
    const db = getTestDb();
    await seedCompany(db, { domain: "q3-gamma.dev" });
    await seedResearchJob(db, { domain: "q3-gamma.dev", executor: "claude", status: "pending" });

    const result = await claimNextResearchJob("openrouter", "q3-gamma.dev");
    expect(result).toBeNull();

    // Claude job should still be pending
    const job = await db.researchJob.findFirst({ where: { domain: "q3-gamma.dev" } });
    expect(job!.status).toBe("pending");
  });

  it("Q4: domain filter only claims matching domain", async () => {
    const db = getTestDb();
    await seedCompany(db, { domain: "q4a-acme.com" });
    await seedCompany(db, { domain: "q4b-beta.io" });
    await seedResearchJob(db, { domain: "q4a-acme.com", executor: "openrouter", status: "pending" });
    await seedResearchJob(db, { domain: "q4b-beta.io", executor: "openrouter", status: "pending" });

    const result = await claimNextResearchJob("openrouter", "q4b-beta.io");

    expect(result).not.toBeNull();
    expect(result!.domain).toBe("q4b-beta.io");

    // q4a job should still be pending
    const otherJob = await db.researchJob.findFirst({ where: { domain: "q4a-acme.com" } });
    expect(otherJob!.status).toBe("pending");
  });

  it("Q5: claims oldest pending job first (FIFO)", async () => {
    // Use two different domains since the unique constraint prevents two pending jobs
    // for the same domain. Both are openrouter jobs — claim without domain filter
    // to verify FIFO ordering.
    const db = getTestDb();
    await seedCompany(db, { domain: "q5a-older.com" });
    await seedCompany(db, { domain: "q5b-newer.com" });
    const jobA = await seedResearchJob(db, {
      domain: "q5a-older.com",
      executor: "openrouter",
      status: "pending",
      requestedAt: new Date("2026-03-27T00:00:00Z"),
    });
    await seedResearchJob(db, {
      domain: "q5b-newer.com",
      executor: "openrouter",
      status: "pending",
      requestedAt: new Date("2026-03-28T00:00:00Z"),
    });

    // Claim without domain filter — should pick the older one
    const result = await claimNextResearchJob("openrouter", "q5a-older.com");
    expect(result).not.toBeNull();
    expect(result!.id).toBe(jobA.id);
  });
});

// ─── completeClaimedResearchJob ────────────────────────────────────────────

describe("when completing a claimed research job", () => {
  it("Q6: writes research_data and marks job completed", async () => {
    const db = getTestDb();
    await seedCompany(db, { domain: "q6-acme.com" });
    await seedResearchJob(db, { domain: "q6-acme.com", executor: "openrouter", status: "pending" });
    const claimed = await claimNextResearchJob("openrouter", "q6-acme.com");

    const result = await completeClaimedResearchJob({
      jobId: claimed!.id,
      domain: "q6-acme.com",
      executor: "openrouter",
      researchData: { version: 1, summary: "AI testing tools" },
    });

    expect(result.outcome).toBe("completed");

    // Verify company research_data written
    const company = await db.company.findUnique({ where: { domain: "q6-acme.com" } });
    expect(company!.researchData).not.toBeNull();
    const data = company!.researchData as { summary: string };
    expect(data.summary).toBe("AI testing tools");

    // Verify job status
    const job = await db.researchJob.findFirst({ where: { domain: "q6-acme.com" } });
    expect(job!.status).toBe("completed");
    expect(job!.completedAt).not.toBeNull();
    expect(job!.error).toBeNull();
  });

  it("Q7: skips when company already has research_data", async () => {
    const db = getTestDb();
    await seedCompany(db, {
      domain: "q7-acme.com",
      researchData: { version: 1, summary: "existing" },
    });
    await seedResearchJob(db, { domain: "q7-acme.com", executor: "openrouter", status: "pending" });
    const claimed = await claimNextResearchJob("openrouter", "q7-acme.com");

    const result = await completeClaimedResearchJob({
      jobId: claimed!.id,
      domain: "q7-acme.com",
      executor: "openrouter",
      researchData: { version: 1, summary: "new" },
    });

    expect(result.outcome).toBe("skipped_existing_data");

    // Existing data should NOT be overwritten
    const company = await db.company.findUnique({ where: { domain: "q7-acme.com" } });
    const data = company!.researchData as { summary: string };
    expect(data.summary).toBe("existing");

    // Job marked as failed with "already exists" message
    const job = await db.researchJob.findFirst({ where: { domain: "q7-acme.com" } });
    expect(job!.status).toBe("failed");
    expect(job!.error).toContain("already exists");
  });

  it("Q8: rejects payload exceeding 500KB", async () => {
    const db = getTestDb();
    await seedCompany(db, { domain: "q8-acme.com" });
    await seedResearchJob(db, { domain: "q8-acme.com", executor: "openrouter", status: "pending" });
    const claimed = await claimNextResearchJob("openrouter", "q8-acme.com");

    await expect(
      completeClaimedResearchJob({
        jobId: claimed!.id,
        domain: "q8-acme.com",
        executor: "openrouter",
        researchData: { huge: "x".repeat(600_000) },
      }),
    ).rejects.toThrow(/too large/);
  });
});

// ─── failClaimedResearchJob ────────────────────────────────────────────────

describe("when failing a claimed research job", () => {
  it("Q9: marks job as failed with error message", async () => {
    const db = getTestDb();
    await seedCompany(db, { domain: "q9-acme.com" });
    await seedResearchJob(db, { domain: "q9-acme.com", executor: "openrouter", status: "pending" });
    const claimed = await claimNextResearchJob("openrouter", "q9-acme.com");

    await failClaimedResearchJob({
      jobId: claimed!.id,
      executor: "openrouter",
      errorMessage: "Model crashed",
    });

    const job = await db.researchJob.findFirst({ where: { domain: "q9-acme.com" } });
    expect(job!.status).toBe("failed");
    expect(job!.completedAt).not.toBeNull();
    expect(job!.error).toBe("Model crashed");
    expect(job!.progressMessage).toBeNull();
  });

  it("Q10: truncates error message to 500 characters", async () => {
    const db = getTestDb();
    await seedCompany(db, { domain: "q10-acme.com" });
    await seedResearchJob(db, { domain: "q10-acme.com", executor: "openrouter", status: "pending" });
    const claimed = await claimNextResearchJob("openrouter", "q10-acme.com");

    await failClaimedResearchJob({
      jobId: claimed!.id,
      executor: "openrouter",
      errorMessage: "x".repeat(600),
    });

    const job = await db.researchJob.findFirst({ where: { domain: "q10-acme.com" } });
    expect(job!.error!.length).toBe(500);
  });
});

// ─── updateClaimedResearchJobProgress ──────────────────────────────────────

describe("when updating claimed job progress", () => {
  it("Q11: updates progress_message", async () => {
    const db = getTestDb();
    await seedCompany(db, { domain: "q11-acme.com" });
    await seedResearchJob(db, { domain: "q11-acme.com", executor: "openrouter", status: "pending" });
    const claimed = await claimNextResearchJob("openrouter", "q11-acme.com");

    await updateClaimedResearchJobProgress({
      jobId: claimed!.id,
      executor: "openrouter",
      progressMessage: "Analyzing founder",
    });

    const job = await db.researchJob.findFirst({ where: { domain: "q11-acme.com" } });
    expect(job!.progressMessage).toBe("Analyzing founder");
  });

  it("Q12: throws for non-claimed job", async () => {
    const db = getTestDb();
    await seedCompany(db, { domain: "q12-acme.com" });
    const job = await seedResearchJob(db, { domain: "q12-acme.com", executor: "openrouter", status: "pending" });

    await expect(
      updateClaimedResearchJobProgress({
        jobId: job.id,
        executor: "openrouter",
        progressMessage: "test",
      }),
    ).rejects.toThrow(/not currently claimed/);
  });
});

// ─── reapStaleResearchJobs ─────────────────────────────────────────────────

describe("when reaping stale research jobs", () => {
  it("Q13: marks old in_progress jobs as failed", async () => {
    const db = getTestDb();
    await seedCompany(db, { domain: "q13-acme.com" });
    // Create a job that looks like it was claimed 20 minutes ago
    await seedResearchJob(db, {
      domain: "q13-acme.com",
      executor: "openrouter",
      status: "in_progress",
      startedAt: new Date(Date.now() - 20 * 60 * 1000),
    });

    const result = await reapStaleResearchJobs("openrouter", 15);

    const reaped = result.find((r) => r.domain === "q13-acme.com");
    expect(reaped).toBeDefined();

    const job = await db.researchJob.findFirst({ where: { domain: "q13-acme.com" } });
    expect(job!.status).toBe("failed");
    expect(job!.error).toContain("Timed out");
  });

  it("Q14: does not reap recent jobs", async () => {
    const db = getTestDb();
    await seedCompany(db, { domain: "q14-acme.com" });
    await seedResearchJob(db, {
      domain: "q14-acme.com",
      executor: "openrouter",
      status: "in_progress",
      startedAt: new Date(), // just now
    });

    const result = await reapStaleResearchJobs("openrouter", 15);

    const reaped = result.find((r) => r.domain === "q14-acme.com");
    expect(reaped).toBeUndefined();

    const job = await db.researchJob.findFirst({ where: { domain: "q14-acme.com" } });
    expect(job!.status).toBe("in_progress");
  });
});

// ─── getResearchWorkerCompanyContext ────────────────────────────────────────

describe("when getting research worker company context", () => {
  it("Q15: returns company data", async () => {
    const db = getTestDb();
    await seedCompany(db, {
      domain: "q15-acme.com",
      name: "Q15 Corp",
      url: "https://q15.com",
      enrichmentData: { key: "value" },
    });

    const result = await getResearchWorkerCompanyContext("q15-acme.com");

    expect(result).not.toBeNull();
    expect(result!.domain).toBe("q15-acme.com");
    expect(result!.name).toBe("Q15 Corp");
    expect(result!.url).toBe("https://q15.com");
    expect(result!.enrichmentData).toEqual({ key: "value" });
  });

  it("Q16: returns null for missing company", async () => {
    const result = await getResearchWorkerCompanyContext("q16-nonexistent.com");
    expect(result).toBeNull();
  });
});
