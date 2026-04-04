import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getTestDb, setupTestDb } from "./helpers/setup";
import { buildCaller } from "./helpers/caller";
import { seedCompany, seedRegion, seedPipelineRun } from "./helpers/factories";
import { cleanupDomains, cleanupPipelineRuns } from "./helpers/cleanup";

setupTestDb();

const TEST_DOMAINS = [
  "st1a-acme.com",
  "st1b-beta.io",
  "st1c-gamma.dev",
];

const TEST_RUN_IDS = [
  "st-run-1",
  "st-run-2",
];

const caller = buildCaller();

beforeAll(async () => {
  const db = getTestDb();

  // st1a: qualified, uk region, source=yc
  await seedCompany(db, {
    domain: "st1a-acme.com",
    state: "qualified",
    source: "yc",
  });
  await seedRegion(db, "st1a-acme.com", "uk");

  // st1b: enriched, uk region, source=producthunt
  await seedCompany(db, {
    domain: "st1b-beta.io",
    state: "enriched",
    source: "producthunt",
  });
  await seedRegion(db, "st1b-beta.io", "uk");

  // st1c: qualified, global only (no uk), source=yc
  await seedCompany(db, {
    domain: "st1c-gamma.dev",
    state: "qualified",
    source: "yc",
  });
  await seedRegion(db, "st1c-gamma.dev", "global");

  // Pipeline runs
  await seedPipelineRun(db, {
    runId: "st-run-1",
    runType: "daily",
    status: "completed",
    companiesProcessed: 10,
    companiesQualified: 3,
    companiesRejected: 7,
  });
  await seedPipelineRun(db, {
    runId: "st-run-2",
    runType: "enrich",
    status: "running",
    companiesProcessed: 5,
  });
});

afterAll(async () => {
  const db = getTestDb();
  await cleanupDomains(db, TEST_DOMAINS);
  await cleanupPipelineRuns(db, TEST_RUN_IDS);
});

// ─── settings.overview ────────────────────────────────────────────────────

describe("when fetching settings overview", () => {
  it("ST1: returns total and region company counts", async () => {
    const result = await caller.settings.overview({ region: "uk" });

    // totalCompanies includes ALL companies in the DB (shared DB, so >=3)
    expect(result.totalCompanies).toBeGreaterThanOrEqual(3);
    // regionCompanies only counts UK (st1a + st1b, not st1c which is global-only)
    expect(result.regionCompanies).toBeGreaterThanOrEqual(2);
    expect(result.regionCompanies).toBeLessThan(result.totalCompanies + 1);
  });

  it("ST2: returns state breakdown with correct shape", async () => {
    const result = await caller.settings.overview({ region: "uk" });

    expect(Array.isArray(result.stateBreakdown)).toBe(true);
    expect(result.stateBreakdown.length).toBeGreaterThan(0);

    // Each entry has state and count
    for (const entry of result.stateBreakdown) {
      expect(entry).toHaveProperty("state");
      expect(entry).toHaveProperty("count");
      expect(typeof entry.state).toBe("string");
      expect(typeof entry.count).toBe("number");
      expect(entry.count).toBeGreaterThan(0);
    }

    // Our seeded data should produce at least "qualified" in the breakdown
    const qualifiedEntry = result.stateBreakdown.find(
      (e) => e.state === "qualified",
    );
    expect(qualifiedEntry).toBeDefined();
    expect(qualifiedEntry!.count).toBeGreaterThanOrEqual(2);
  });

  it("ST3: returns source breakdown with correct shape", async () => {
    const result = await caller.settings.overview({ region: "uk" });

    expect(Array.isArray(result.sourceBreakdown)).toBe(true);
    expect(result.sourceBreakdown.length).toBeGreaterThan(0);

    for (const entry of result.sourceBreakdown) {
      expect(entry).toHaveProperty("source");
      expect(entry).toHaveProperty("count");
      expect(typeof entry.source).toBe("string");
      expect(typeof entry.count).toBe("number");
    }
  });

  it("ST4: returns recent pipeline runs", async () => {
    const result = await caller.settings.overview({ region: "uk" });

    expect(Array.isArray(result.recentRuns)).toBe(true);
    expect(result.recentRuns.length).toBeGreaterThanOrEqual(2);

    // Most recent first
    const runIds = result.recentRuns.map((r) => r.runId);
    expect(runIds).toContain("st-run-1");
    expect(runIds).toContain("st-run-2");

    // Verify shape of a run
    const run = result.recentRuns.find((r) => r.runId === "st-run-1")!;
    expect(run.runType).toBe("daily");
    expect(run.status).toBe("completed");
    expect(run.companiesProcessed).toBe(10);
    expect(run.companiesQualified).toBe(3);
    expect(run.companiesRejected).toBe(7);
  });
});
