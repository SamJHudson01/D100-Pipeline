import { describe, it, expect, afterAll } from "vitest";
import { TRPCError } from "@trpc/server";
import { getTestDb, setupTestDb } from "./helpers/setup";
import { buildCaller } from "./helpers/caller";
import { seedCompany } from "./helpers/factories";
import { cleanupDomains } from "./helpers/cleanup";

setupTestDb();

const TEST_DOMAINS = ["tp1-missing.com", "tp2-acme.com", "tp3-missing.com"];

const caller = buildCaller();

afterAll(async () => {
  await cleanupDomains(getTestDb(), TEST_DOMAINS);
});

// ─── markContacted ─────────────────────────────────────────────────────────

describe("when marking a company as contacted", () => {
  it("TP1: throws NOT_FOUND for nonexistent company", async () => {
    try {
      await caller.touchpoint.markContacted({ domain: "tp1-missing.com" });
      expect.unreachable("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(TRPCError);
      expect((err as TRPCError).code).toBe("NOT_FOUND");
    }
  });

  it("TP2: creates touchpoint and transitions company state", async () => {
    const db = getTestDb();
    await seedCompany(db, { domain: "tp2-acme.com", state: "qualified", dream100: false });

    const result = await caller.touchpoint.markContacted({ domain: "tp2-acme.com" });
    expect(result).toEqual({ success: true });

    // Verify touchpoint row created
    const touchpoints = await db.touchpoint.findMany({ where: { domain: "tp2-acme.com" } });
    expect(touchpoints.length).toBe(1);
    expect(touchpoints[0].channel).toBe("loom");
    expect(touchpoints[0].type).toBe("Initial outreach");
    expect(touchpoints[0].touchDate).not.toBeNull();

    // Verify company state updated
    const company = await db.company.findUnique({ where: { domain: "tp2-acme.com" } });
    expect(company!.state).toBe("contacted");
    expect(company!.dream100).toBe(true);
    expect(company!.sequenceStep).toBe(1);
    expect(company!.sequenceStartedAt).not.toBeNull();
    expect(company!.lastTouchDate).not.toBeNull();
  });

  it("TP3: no touchpoint created when company is missing", async () => {
    const db = getTestDb();

    try {
      await caller.touchpoint.markContacted({ domain: "tp3-missing.com" });
    } catch {
      // Expected to throw
    }

    // Verify no orphaned touchpoint
    const touchpoints = await db.touchpoint.findMany({ where: { domain: "tp3-missing.com" } });
    expect(touchpoints.length).toBe(0);
  });
});
