import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TRPCError } from "@trpc/server";
import { getTestDb, setupTestDb } from "./helpers/setup";
import { buildCaller } from "./helpers/caller";
import { seedCompany, seedRegion } from "./helpers/factories";
import { cleanupDomains } from "./helpers/cleanup";

setupTestDb();

const TEST_DOMAINS = [
  "t1-missing.com",
  "t2-acme.com",
  "t3-acme.com",
  "t4-acme.com",
  "t5-acme.com",
  "t6-acme.com",
  "t7a-acme.com",
  "t7b-beta.io",
  "t7c-gamma.dev",
  "t7d-delta.co",
  "t8-acme.com",
  "t9a-acme.com",
  "t9b-beta.io",
  "t10a-acme.com",
  "t10b-beta.io",
  "t10c-gamma.dev",
  "t10d-delta.co",
];

const caller = buildCaller();

afterAll(async () => {
  await cleanupDomains(getTestDb(), TEST_DOMAINS);
});

// ─── decide ────────────────────────────────────────────────────────────────

describe("when triaging a qualified prospect", () => {
  it("T1: throws NOT_FOUND for nonexistent company", async () => {
    try {
      await caller.triage.decide({ domain: "t1-missing.com", decision: "select" });
      expect.unreachable("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(TRPCError);
      expect((err as TRPCError).code).toBe("NOT_FOUND");
    }
  });

  it("T2: 'select' transitions to contacted with dream100 + sequence", async () => {
    const db = getTestDb();
    await seedCompany(db, { domain: "t2-acme.com", state: "qualified", dream100: false });

    const result = await caller.triage.decide({ domain: "t2-acme.com", decision: "select" });
    expect(result).toEqual({ success: true });

    const company = await db.company.findUnique({ where: { domain: "t2-acme.com" } });
    expect(company!.state).toBe("contacted");
    expect(company!.pinned).toBe(true);
    expect(company!.dream100).toBe(true);
    expect(company!.sequenceStep).toBe(0);
    expect(company!.sequenceStartedAt).not.toBeNull();
  });

  it("T3: 'skip' transitions to nurture and unpins", async () => {
    const db = getTestDb();
    await seedCompany(db, { domain: "t3-acme.com", state: "qualified", pinned: true });

    await caller.triage.decide({ domain: "t3-acme.com", decision: "skip" });

    const company = await db.company.findUnique({ where: { domain: "t3-acme.com" } });
    expect(company!.state).toBe("nurture");
    expect(company!.pinned).toBe(false);
  });

  it("T4: 'snooze' with date sets snoozedUntil", async () => {
    const db = getTestDb();
    await seedCompany(db, { domain: "t4-acme.com", state: "qualified" });

    await caller.triage.decide({
      domain: "t4-acme.com",
      decision: "snooze",
      snoozeUntil: "2026-04-01T00:00:00.000Z",
    });

    const company = await db.company.findUnique({ where: { domain: "t4-acme.com" } });
    expect(company!.snoozedUntil).not.toBeNull();
    expect(company!.snoozedUntil!.toISOString()).toBe("2026-04-01T00:00:00.000Z");
    expect(company!.pinned).toBe(false);
  });

  it("T5: 'snooze' without date clears snoozedUntil", async () => {
    const db = getTestDb();
    await seedCompany(db, {
      domain: "t5-acme.com",
      state: "qualified",
      snoozedUntil: new Date("2026-05-01"),
    });

    await caller.triage.decide({ domain: "t5-acme.com", decision: "snooze" });

    const company = await db.company.findUnique({ where: { domain: "t5-acme.com" } });
    expect(company!.snoozedUntil).toBeNull();
  });

  it("T6: 'dismiss' sets dismissed flag and unpins", async () => {
    const db = getTestDb();
    await seedCompany(db, { domain: "t6-acme.com", state: "qualified", dismissed: false });

    await caller.triage.decide({ domain: "t6-acme.com", decision: "dismiss" });

    const company = await db.company.findUnique({ where: { domain: "t6-acme.com" } });
    expect(company!.dismissed).toBe(true);
    expect(company!.pinned).toBe(false);
  });
});

// ─── prospects ─────────────────────────────────────────────────────────────

describe("when listing triage prospects", () => {
  beforeAll(async () => {
    const db = getTestDb();

    // Use very high scores so test companies appear in top-5 (take: 5) in a shared DB.

    // t7a: qualified, not dismissed, not snoozed — SHOULD appear
    await seedCompany(db, { domain: "t7a-acme.com", state: "qualified", dismissed: false, score: 999 });
    await seedRegion(db, "t7a-acme.com", "uk");

    // t7b: qualified but dismissed — should NOT appear
    await seedCompany(db, { domain: "t7b-beta.io", state: "qualified", dismissed: true, score: 998 });
    await seedRegion(db, "t7b-beta.io", "uk");

    // t7c: qualified but snoozed until future — should NOT appear
    await seedCompany(db, {
      domain: "t7c-gamma.dev",
      state: "qualified",
      dismissed: false,
      snoozedUntil: new Date("2026-05-01"),
      score: 997,
    });
    await seedRegion(db, "t7c-gamma.dev", "uk");

    // t7d: wrong state (enriched) — should NOT appear
    await seedCompany(db, { domain: "t7d-delta.co", state: "enriched", score: 996 });
    await seedRegion(db, "t7d-delta.co", "uk");
  });

  it("T7: returns only qualified, undismissed, unsnoozed companies", async () => {
    const result = await caller.triage.prospects({ region: "uk" });

    const domains = result.map((c) => c.domain);
    expect(domains).toContain("t7a-acme.com");
    expect(domains).not.toContain("t7b-beta.io");
    expect(domains).not.toContain("t7c-gamma.dev");
    expect(domains).not.toContain("t7d-delta.co");

    // Verify shape
    const item = result.find((c) => c.domain === "t7a-acme.com")!;
    expect(item).toHaveProperty("name");
    expect(item).toHaveProperty("score");
    expect(item).toHaveProperty("source");
    expect(item).toHaveProperty("fundingStage");
    expect(item).toHaveProperty("teamSize");
  });

  it("T8: includes companies with expired snooze", async () => {
    const db = getTestDb();
    await seedCompany(db, {
      domain: "t8-acme.com",
      state: "qualified",
      dismissed: false,
      snoozedUntil: new Date("2026-03-01"), // past
      score: 995,
    });
    await seedRegion(db, "t8-acme.com", "uk");

    const result = await caller.triage.prospects({ region: "uk" });
    const domains = result.map((c) => c.domain);
    expect(domains).toContain("t8-acme.com");
  });

  it("T9: respects region filter", async () => {
    const db = getTestDb();
    await seedCompany(db, { domain: "t9a-acme.com", state: "qualified", score: 994 });
    await seedRegion(db, "t9a-acme.com", "uk");

    await seedCompany(db, { domain: "t9b-beta.io", state: "qualified", score: 993 });
    await seedRegion(db, "t9b-beta.io", "global"); // no uk region

    const result = await caller.triage.prospects({ region: "uk" });
    const domains = result.map((c) => c.domain);
    expect(domains).toContain("t9a-acme.com");
    expect(domains).not.toContain("t9b-beta.io");
  });
});

// ─── stats ─────────────────────────────────────────────────────────────────

describe("when getting triage stats", () => {
  beforeAll(async () => {
    const db = getTestDb();

    await seedCompany(db, { domain: "t10a-acme.com", state: "qualified" });
    await seedRegion(db, "t10a-acme.com", "uk");

    await seedCompany(db, { domain: "t10b-beta.io", state: "qualified" });
    await seedRegion(db, "t10b-beta.io", "uk");

    await seedCompany(db, { domain: "t10c-gamma.dev", state: "discovered" });
    await seedRegion(db, "t10c-gamma.dev", "uk");

    // Global only — should not count in uk stats
    await seedCompany(db, { domain: "t10d-delta.co", state: "qualified" });
    await seedRegion(db, "t10d-delta.co", "global");
  });

  it("T10: returns correct counts for region", async () => {
    const result = await caller.triage.stats({ region: "uk" });

    // At least the test-seeded companies (other tests may also seed uk companies)
    expect(result.total).toBeGreaterThanOrEqual(3);
    expect(result.qualified).toBeGreaterThanOrEqual(2);
    expect(result.discovered).toBeGreaterThanOrEqual(1);
  });
});
