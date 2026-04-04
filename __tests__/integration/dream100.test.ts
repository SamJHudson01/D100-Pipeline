import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { TRPCError } from "@trpc/server";
import { getTestDb, setupTestDb } from "./helpers/setup";
import { buildCaller } from "./helpers/caller";
import { seedCompany } from "./helpers/factories";
import { cleanupDomains } from "./helpers/cleanup";

setupTestDb();

const TEST_DOMAINS = [
  "d1-nonexistent.com",
  "d2-acme.com",
  "d3-acme.com",
  "d4-acme.com",
  "d5-acme.com",
  "d6-acme.com",
  "d7a-acme.com",
  "d7b-beta.io",
  "d8a-acme.com",
  "d8b-beta.io",
  "d8c-gamma.dev",
];

const caller = buildCaller();

afterAll(async () => {
  await cleanupDomains(getTestDb(), TEST_DOMAINS);
});

// ─── addCompany ────────────────────────────────────────────────────────────

describe("when adding a company to Dream 100", () => {
  it("D1: throws NOT_FOUND for nonexistent company", async () => {
    try {
      await caller.dream100.addCompany({ domain: "d1-nonexistent.com" });
      expect.unreachable("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(TRPCError);
      expect((err as TRPCError).code).toBe("NOT_FOUND");
    }
  });

  it("D2: returns alreadyAdded=true when company is already dream100", async () => {
    const db = getTestDb();
    await seedCompany(db, { domain: "d2-acme.com", dream100: true });

    const result = await caller.dream100.addCompany({ domain: "d2-acme.com" });
    expect(result).toEqual({ success: true, alreadyAdded: true });
  });

  it("D3: sets dream100 flag and initializes pipeline for new addition", async () => {
    const db = getTestDb();
    await seedCompany(db, { domain: "d3-acme.com", dream100: false });

    const result = await caller.dream100.addCompany({ domain: "d3-acme.com" });
    expect(result).toEqual({ success: true, alreadyAdded: false });

    // Verify DB state
    const company = await db.company.findUnique({ where: { domain: "d3-acme.com" } });
    expect(company!.dream100).toBe(true);
    expect(company!.sequenceStep).toBe(0);
    expect(company!.pipelineStage).toBe("backlog");
    expect(company!.sequenceStartedAt).not.toBeNull();
  });
});

// ─── removeCompany ─────────────────────────────────────────────────────────

describe("when removing a company from Dream 100", () => {
  it("D4: resets all dream100 fields", async () => {
    const db = getTestDb();
    await seedCompany(db, {
      domain: "d4-acme.com",
      dream100: true,
      sequenceStep: 3,
      sequenceStartedAt: new Date(),
      pipelineStage: "outreach",
      notes: "Follow up",
    });

    const result = await caller.dream100.removeCompany({ domain: "d4-acme.com" });
    expect(result).toEqual({ success: true });

    const company = await db.company.findUnique({ where: { domain: "d4-acme.com" } });
    expect(company!.dream100).toBe(false);
    expect(company!.sequenceStep).toBeNull();
    expect(company!.sequenceStartedAt).toBeNull();
    expect(company!.sequencePaused).toBe(false);
    expect(company!.pipelineStage).toBe("backlog");
    expect(company!.notes).toBeNull();
  });
});

// ─── moveStage ─────────────────────────────────────────────────────────────

describe("when moving a company through pipeline stages", () => {
  it("D5: updates pipelineStage and returns new value", async () => {
    const db = getTestDb();
    await seedCompany(db, { domain: "d5-acme.com", pipelineStage: "backlog" });

    const result = await caller.dream100.moveStage({ domain: "d5-acme.com", stage: "outreach" });
    expect(result).toEqual({ pipelineStage: "outreach" });

    const company = await db.company.findUnique({ where: { domain: "d5-acme.com" } });
    expect(company!.pipelineStage).toBe("outreach");
  });
});

// ─── updateNotes ───────────────────────────────────────────────────────────

describe("when updating company notes", () => {
  it("D6: updates notes and returns new value", async () => {
    const db = getTestDb();
    await seedCompany(db, { domain: "d6-acme.com" });

    const result = await caller.dream100.updateNotes({ domain: "d6-acme.com", notes: "Follow up next week" });
    expect(result).toEqual({ notes: "Follow up next week" });

    const company = await db.company.findUnique({ where: { domain: "d6-acme.com" } });
    expect(company!.notes).toBe("Follow up next week");
  });
});

// ─── list ──────────────────────────────────────────────────────────────────

describe("when listing Dream 100 companies", () => {
  beforeAll(async () => {
    const db = getTestDb();
    await seedCompany(db, { domain: "d7a-acme.com", name: "D7A Corp", dream100: true });
    await seedCompany(db, { domain: "d7b-beta.io", name: "D7B Corp", dream100: false });
  });

  it("D7: returns only dream100 companies", async () => {
    const result = await caller.dream100.list();

    const domains = result.map((c) => c.domain);
    expect(domains).toContain("d7a-acme.com");
    expect(domains).not.toContain("d7b-beta.io");

    // Verify shape
    const item = result.find((c) => c.domain === "d7a-acme.com")!;
    expect(item.name).toBe("D7A Corp");
    expect(item).toHaveProperty("score");
    expect(item).toHaveProperty("sequenceStep");
    expect(item).toHaveProperty("lastTouchDate");
  });
});

// ─── pipeline ──────────────────────────────────────────────────────────────

describe("when viewing the pipeline board", () => {
  beforeAll(async () => {
    const db = getTestDb();
    await seedCompany(db, {
      domain: "d8a-acme.com",
      name: "D8A Corp",
      dream100: true,
      score: 80,
      pipelineStage: "outreach",
      notes: "test notes",
    });
    await seedCompany(db, {
      domain: "d8b-beta.io",
      name: "D8B Corp",
      dream100: true,
      score: 90,
      pipelineStage: "backlog",
    });
    await seedCompany(db, {
      domain: "d8c-gamma.dev",
      name: "D8C Corp",
      dream100: false,
    });
  });

  it("D8: returns dream100 companies sorted by score descending", async () => {
    const result = await caller.dream100.pipeline();

    const domains = result.map((c) => c.domain);
    expect(domains).toContain("d8a-acme.com");
    expect(domains).toContain("d8b-beta.io");
    expect(domains).not.toContain("d8c-gamma.dev");

    // Score order: d8b (90) before d8a (80)
    const d8bIdx = result.findIndex((c) => c.domain === "d8b-beta.io");
    const d8aIdx = result.findIndex((c) => c.domain === "d8a-acme.com");
    expect(d8bIdx).toBeLessThan(d8aIdx);

    // Verify pipeline fields present
    const d8a = result.find((c) => c.domain === "d8a-acme.com")!;
    expect(d8a.pipelineStage).toBe("outreach");
    expect(d8a.notes).toBe("test notes");
  });
});
