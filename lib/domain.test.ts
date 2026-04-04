import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  computeEffectiveScore,
  isValidTransition,
  moveStageInputSchema,
  updateNotesInputSchema,
  triageInputSchema,
  domainSchema,
  poolFilterSchema,
} from "./domain";

// ─── computeEffectiveScore ──────────────────────────────────────────────────

describe("computeEffectiveScore", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-28T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const daysAgo = (days: number) => new Date(Date.now() - days * 86400000);

  it("returns 100% of originalScore at day 0", () => {
    expect(computeEffectiveScore(null, 80, daysAgo(0))).toBe(80);
  });

  it("returns 100% of originalScore at day 29 (inside 0-30 bracket)", () => {
    expect(computeEffectiveScore(null, 80, daysAgo(29))).toBe(80);
  });

  it("returns 75% of originalScore at day 31 (inside 31-60 bracket)", () => {
    expect(computeEffectiveScore(null, 80, daysAgo(31))).toBe(60);
  });

  it("returns 75% of originalScore at day 59 (still in 31-60 bracket)", () => {
    expect(computeEffectiveScore(null, 80, daysAgo(59))).toBe(60);
  });

  it("returns 50% of originalScore at day 61 (inside 61-90 bracket)", () => {
    expect(computeEffectiveScore(null, 80, daysAgo(61))).toBe(40);
  });

  it("returns 50% of originalScore at day 89 (still in 61-90 bracket)", () => {
    expect(computeEffectiveScore(null, 80, daysAgo(89))).toBe(40);
  });

  it("returns 0 at day 91 (beyond 90)", () => {
    expect(computeEffectiveScore(null, 80, daysAgo(91))).toBe(0);
  });

  it("floors the result (no fractional scores)", () => {
    expect(computeEffectiveScore(null, 75, daysAgo(31))).toBe(56); // 75 * 0.75 = 56.25 → 56
  });

  it("falls back to score when originalScore is null", () => {
    expect(computeEffectiveScore(50, null, daysAgo(0))).toBe(50);
  });

  it("falls back to score when scoredAt is null", () => {
    expect(computeEffectiveScore(50, 80, null)).toBe(50);
  });

  it("returns 0 when both score and originalScore are null", () => {
    expect(computeEffectiveScore(null, null, null)).toBe(0);
  });
});

// ─── isValidTransition ──────────────────────────────────────────────────────

describe("isValidTransition", () => {
  it("allows discovered → pre_filtered", () => {
    expect(isValidTransition("discovered", "pre_filtered")).toBe(true);
  });

  it("allows discovered → pre_filter_rejected", () => {
    expect(isValidTransition("discovered", "pre_filter_rejected")).toBe(true);
  });

  it("rejects discovered → qualified (skips enriched)", () => {
    expect(isValidTransition("discovered", "qualified")).toBe(false);
  });

  it("allows same-state identity transition", () => {
    expect(isValidTransition("enriched", "enriched")).toBe(true);
  });

  it("blocks all transitions out of dead state", () => {
    expect(isValidTransition("dead", "discovered")).toBe(false);
  });

  it("allows qualified → contacted", () => {
    expect(isValidTransition("qualified", "contacted")).toBe(true);
  });

  it("rejects contacted → qualified (no going back)", () => {
    expect(isValidTransition("contacted", "qualified")).toBe(false);
  });
});

// ─── Zod Schemas ────────────────────────────────────────────────────────────

describe("moveStageInputSchema", () => {
  it("accepts valid input", () => {
    const result = moveStageInputSchema.safeParse({ domain: "acme.com", stage: "outreach" });
    expect(result.success).toBe(true);
  });

  it("rejects invalid stage", () => {
    const result = moveStageInputSchema.safeParse({ domain: "acme.com", stage: "invalid_stage" });
    expect(result.success).toBe(false);
  });

  it("rejects empty domain", () => {
    const result = moveStageInputSchema.safeParse({ domain: "", stage: "backlog" });
    expect(result.success).toBe(false);
  });
});

describe("updateNotesInputSchema", () => {
  it("accepts valid input", () => {
    const result = updateNotesInputSchema.safeParse({ domain: "acme.com", notes: "Some notes" });
    expect(result.success).toBe(true);
  });

  it("rejects notes exceeding 5000 characters", () => {
    const result = updateNotesInputSchema.safeParse({ domain: "acme.com", notes: "x".repeat(5001) });
    expect(result.success).toBe(false);
  });

  it("rejects missing domain", () => {
    const result = updateNotesInputSchema.safeParse({ notes: "Some notes" });
    expect(result.success).toBe(false);
  });
});

// ─── triageInputSchema ───────────────────────────────────────────────────────

describe("triageInputSchema", () => {
  it("accepts valid select decision", () => {
    const result = triageInputSchema.safeParse({ domain: "acme.com", decision: "select" });
    expect(result.success).toBe(true);
    expect(result.data!.decision).toBe("select");
  });

  it("accepts snooze with valid ISO datetime", () => {
    const result = triageInputSchema.safeParse({
      domain: "acme.com",
      decision: "snooze",
      snoozeUntil: "2026-04-01T00:00:00.000Z",
    });
    expect(result.success).toBe(true);
    expect(result.data!.snoozeUntil).toBe("2026-04-01T00:00:00.000Z");
  });

  it("accepts snooze without snoozeUntil (optional)", () => {
    const result = triageInputSchema.safeParse({ domain: "acme.com", decision: "snooze" });
    expect(result.success).toBe(true);
  });

  it("rejects invalid decision value", () => {
    const result = triageInputSchema.safeParse({ domain: "acme.com", decision: "archive" });
    expect(result.success).toBe(false);
  });

  it("rejects missing domain", () => {
    const result = triageInputSchema.safeParse({ decision: "select" });
    expect(result.success).toBe(false);
  });

  it("rejects invalid snoozeUntil format", () => {
    const result = triageInputSchema.safeParse({
      domain: "acme.com",
      decision: "snooze",
      snoozeUntil: "next tuesday",
    });
    expect(result.success).toBe(false);
  });
});

// ─── domainSchema ────────────────────────────────────────────────────────────

describe("domainSchema", () => {
  it("accepts a valid domain string", () => {
    const result = domainSchema.safeParse("acme.com");
    expect(result.success).toBe(true);
    expect(result.data).toBe("acme.com");
  });

  it("rejects empty string", () => {
    const result = domainSchema.safeParse("");
    expect(result.success).toBe(false);
  });

  it("rejects string exceeding 253 characters", () => {
    const result = domainSchema.safeParse("a".repeat(254));
    expect(result.success).toBe(false);
  });

  it("accepts string at exactly 253 characters", () => {
    const result = domainSchema.safeParse("a".repeat(253));
    expect(result.success).toBe(true);
  });
});

// ─── poolFilterSchema ────────────────────────────────────────────────────────

describe("poolFilterSchema", () => {
  it("applies defaults for missing optional fields", () => {
    const result = poolFilterSchema.safeParse({});
    expect(result.success).toBe(true);
    expect(result.data!.page).toBe(1);
    expect(result.data!.minScore).toBe(0);
    expect(result.data!.region).toBe("uk");
    expect(result.data!.sortBy).toBe("score");
    expect(result.data!.showArchived).toBe(false);
  });

  it("accepts valid complete input", () => {
    const result = poolFilterSchema.safeParse({
      source: "yc",
      state: "qualified",
      q: "fintech",
      page: 2,
      minScore: 50,
      region: "uk",
      sortBy: "team_size_asc",
      showArchived: true,
    });
    expect(result.success).toBe(true);
  });

  it("rejects page less than 1", () => {
    const result = poolFilterSchema.safeParse({ page: 0 });
    expect(result.success).toBe(false);
  });

  it("rejects page greater than 10000", () => {
    const result = poolFilterSchema.safeParse({ page: 10001 });
    expect(result.success).toBe(false);
  });

  it("rejects minScore greater than 100", () => {
    const result = poolFilterSchema.safeParse({ minScore: 101 });
    expect(result.success).toBe(false);
  });

  it("rejects invalid sortBy value", () => {
    const result = poolFilterSchema.safeParse({ sortBy: "name_asc" });
    expect(result.success).toBe(false);
  });

  it("rejects invalid state value", () => {
    const result = poolFilterSchema.safeParse({ state: "invalid_state" });
    expect(result.success).toBe(false);
  });
});
