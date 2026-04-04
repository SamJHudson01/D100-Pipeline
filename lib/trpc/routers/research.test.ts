import { describe, it, expect, vi, beforeEach } from "vitest";
import { TRPCError } from "@trpc/server";
import { sanitizeResearchUrls } from "./research";
import type { ResearchData } from "@/lib/domain";

// ─── Module mocks ────────────────────────────────────────────────────────────

vi.mock("@/lib/research/service", () => ({
  enqueueResearchJob: vi.fn(),
  getResearchRouteState: vi.fn(),
  getResearchPageSnapshot: vi.fn(),
  getResearchSummaryCard: vi.fn(),
  ResearchCompanyNotFoundError: class ResearchCompanyNotFoundError extends Error {
    constructor(domain: string) {
      super(`Company not found: ${domain}`);
      this.name = "ResearchCompanyNotFoundError";
    }
  },
}));

// Must import AFTER vi.mock so the mock is in place
import {
  enqueueResearchJob,
  getResearchRouteState,
  getResearchPageSnapshot,
  ResearchCompanyNotFoundError,
} from "@/lib/research/service";
import { router } from "../init";
import { researchRouter } from "./research";

const mockedEnqueueResearchJob = vi.mocked(enqueueResearchJob);
const mockedGetResearchRouteState = vi.mocked(getResearchRouteState);
const mockedGetResearchPageSnapshot = vi.mocked(getResearchPageSnapshot);

// ─── Caller setup ────────────────────────────────────────────────────────────

const testRouter = router({ research: researchRouter });
const caller = testRouter.createCaller({});

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── sanitizeResearchUrls (existing tests) ───────────────────────────────────

describe("sanitizeResearchUrls", () => {
  it("preserves https:// URLs", () => {
    const data: ResearchData = {
      companyIntel: {
        onlinePresence: { websiteUrl: "https://example.com" },
      },
    };
    sanitizeResearchUrls(data);
    expect(data.companyIntel!.onlinePresence!.websiteUrl).toBe(
      "https://example.com",
    );
  });

  it("removes http:// URLs", () => {
    const data: ResearchData = {
      companyIntel: {
        onlinePresence: { websiteUrl: "http://example.com" },
      },
    };
    sanitizeResearchUrls(data);
    expect(data.companyIntel!.onlinePresence!.websiteUrl).toBeUndefined();
  });

  it("removes javascript: URLs", () => {
    const data: ResearchData = {
      personalizationHooks: [
        { hook: "test", sourceUrl: "javascript:alert(1)" },
      ],
    };
    sanitizeResearchUrls(data);
    expect(data.personalizationHooks![0].sourceUrl).toBeUndefined();
  });

  it("removes data: URLs", () => {
    const data: ResearchData = {
      companyIntel: {
        stageTraction: {
          revenueSignals: [
            { text: "test", sourceUrl: "data:text/html,<h1>pwned</h1>" },
          ],
        },
      },
    };
    sanitizeResearchUrls(data);
    expect(
      data.companyIntel!.stageTraction!.revenueSignals![0].sourceUrl,
    ).toBeUndefined();
  });

  it("removes invalid URL strings", () => {
    const data: ResearchData = {
      companyIntel: {
        onlinePresence: { websiteUrl: "not-a-url" },
      },
    };
    sanitizeResearchUrls(data);
    expect(data.companyIntel!.onlinePresence!.websiteUrl).toBeUndefined();
  });

  it("cleans nested URLs across all locations", () => {
    const data: ResearchData = {
      companyIntel: {
        onlinePresence: { websiteUrl: "https://safe.com" },
        stageTraction: {
          revenueSignals: [{ text: "rev", sourceUrl: "http://unsafe.com" }],
          growthSignals: [
            { text: "growth", sourceUrl: "https://safe-growth.com" },
          ],
        },
        techStack: {
          sources: [{ text: "tech", sourceUrl: "javascript:void(0)" }],
        },
      },
      prospectIntel: {
        contentThoughtLeadership: {
          podcastAppearances: [
            { title: "pod", url: "https://podcast.com/ep1" },
          ],
          conferenceTalks: [{ title: "talk", url: "data:text/plain,bad" }],
        },
      },
      personalizationHooks: [
        { hook: "hook1", sourceUrl: "https://hook.com" },
        { hook: "hook2", sourceUrl: "ftp://bad.com" },
      ],
    };

    sanitizeResearchUrls(data);

    expect(data.companyIntel!.onlinePresence!.websiteUrl).toBe(
      "https://safe.com",
    );
    expect(
      data.companyIntel!.stageTraction!.revenueSignals![0].sourceUrl,
    ).toBeUndefined();
    expect(
      data.companyIntel!.stageTraction!.growthSignals![0].sourceUrl,
    ).toBe("https://safe-growth.com");
    expect(
      data.companyIntel!.techStack!.sources![0].sourceUrl,
    ).toBeUndefined();
    expect(
      data.prospectIntel!.contentThoughtLeadership!.podcastAppearances![0].url,
    ).toBe("https://podcast.com/ep1");
    expect(
      data.prospectIntel!.contentThoughtLeadership!.conferenceTalks![0].url,
    ).toBeUndefined();
    expect(data.personalizationHooks![0].sourceUrl).toBe("https://hook.com");
    expect(data.personalizationHooks![1].sourceUrl).toBeUndefined();
  });

  it("handles missing nested objects without throwing", () => {
    const data: ResearchData = {};
    expect(() => sanitizeResearchUrls(data)).not.toThrow();
    expect(data).toEqual({});
  });

  it("handles null/undefined url fields without throwing", () => {
    const data: ResearchData = {
      companyIntel: {
        onlinePresence: { websiteUrl: undefined },
        stageTraction: {
          revenueSignals: [{ text: "test" }],
        },
      },
      personalizationHooks: [{ hook: "test" }],
    };
    expect(() => sanitizeResearchUrls(data)).not.toThrow();
    expect(data.companyIntel!.onlinePresence!.websiteUrl).toBeUndefined();
  });
});

// ─── research.request ────────────────────────────────────────────────────────

describe("research.request", () => {
  it("T1: maps ResearchCompanyNotFoundError to TRPCError NOT_FOUND", async () => {
    mockedEnqueueResearchJob.mockRejectedValue(
      new ResearchCompanyNotFoundError("acme.com"),
    );

    try {
      await caller.research.request({ domain: "acme.com" });
      expect.unreachable("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(TRPCError);
      const trpcErr = err as TRPCError;
      expect(trpcErr.code).toBe("NOT_FOUND");
      expect(trpcErr.message).toBe("Company not found");
    }
  });

  it("T2: returns enqueue result on success", async () => {
    mockedEnqueueResearchJob.mockResolvedValue({
      jobId: "job-1",
      executor: "claude",
      status: "pending",
      created: true,
    });

    const result = await caller.research.request({ domain: "acme.com" });
    expect(result.jobId).toBe("job-1");
    expect(result.executor).toBe("claude");
    expect(result.status).toBe("pending");
    expect(result.created).toBe(true);
  });

  it("T6: re-throws unexpected errors without wrapping", async () => {
    mockedEnqueueResearchJob.mockRejectedValue(
      new Error("connection refused"),
    );

    try {
      await caller.research.request({ domain: "acme.com" });
      expect.unreachable("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(TRPCError);
      const trpcErr = err as TRPCError;
      expect(trpcErr.code).toBe("INTERNAL_SERVER_ERROR");
      expect(trpcErr.cause).toBeInstanceOf(Error);
      expect((trpcErr.cause as Error).message).toBe("connection refused");
    }
  });
});

// ─── research.requestOpenRouter ──────────────────────────────────────────────

describe("research.requestOpenRouter", () => {
  it("T3: passes 'openrouter' executor to enqueueResearchJob", async () => {
    mockedEnqueueResearchJob.mockResolvedValue({
      jobId: "job-2",
      executor: "openrouter",
      status: "pending",
      created: true,
    });

    const result = await caller.research.requestOpenRouter({ domain: "acme.com" });
    expect(mockedEnqueueResearchJob).toHaveBeenCalledWith("acme.com", "openrouter");
    expect(result.jobId).toBe("job-2");
    expect(result.executor).toBe("openrouter");
    expect(result.status).toBe("pending");
    expect(result.created).toBe(true);
  });
});

// ─── research.status ─────────────────────────────────────────────────────────

describe("research.status", () => {
  it("T4: maps ResearchCompanyNotFoundError to NOT_FOUND", async () => {
    mockedGetResearchRouteState.mockRejectedValue(
      new ResearchCompanyNotFoundError("acme.com"),
    );

    try {
      await caller.research.status({ domain: "acme.com" });
      expect.unreachable("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(TRPCError);
      expect((err as TRPCError).code).toBe("NOT_FOUND");
    }
  });

  it("T5: returns route state on success", async () => {
    mockedGetResearchRouteState.mockResolvedValue({
      kind: "idle",
      hasResearchData: false,
      completedExecutor: null,
      activeJob: null,
      latestJob: null,
      recoveryAction: { type: "request" },
    });

    const result = await caller.research.status({ domain: "acme.com" });
    expect(result.kind).toBe("idle");
    expect(result.recoveryAction).toEqual({ type: "request" });
  });
});

// ─── research.full ───────────────────────────────────────────────────────────

describe("research.full", () => {
  it("T35: happy path returns parsed research data with effective score", async () => {
    const now = new Date();
    mockedGetResearchPageSnapshot.mockResolvedValue({
      company: {
        domain: "acme.com",
        name: "Acme Corp",
        url: "https://acme.com",
        researchData: {
          version: 1,
          summary: "AI testing tools",
          companyIntel: { productMarket: { whatTheyDo: "Testing" } },
          prospectIntel: { background: { name: "Jane" } },
        },
        score: 80,
        originalScore: 80,
        scoredAt: now,
      },
      researchState: {
        kind: "completed",
        hasResearchData: true,
        completedExecutor: "openrouter",
        activeJob: null,
        latestJob: null,
        recoveryAction: null,
      },
    });

    const result = await caller.research.full({ domain: "acme.com" });
    expect(result.domain).toBe("acme.com");
    expect(result.name).toBe("Acme Corp");
    expect(result.effectiveScore).toBe(80);
    expect(result.researchData).not.toBeNull();
    expect(result.researchData!.summary).toBe("AI testing tools");
    expect(result.researchState.kind).toBe("completed");
    expect(result.jobStatus).toBeNull();
  });

  it("T36: safeParse failure falls back to raw cast — URL sanitization still runs", async () => {
    mockedGetResearchPageSnapshot.mockResolvedValue({
      company: {
        domain: "acme.com",
        name: "Acme Corp",
        url: "https://acme.com",
        researchData: {
          summary: 123, // number not string — fails safeParse
          companyIntel: {
            onlinePresence: { websiteUrl: "javascript:alert(1)" },
          },
        },
        score: 50,
        originalScore: null,
        scoredAt: null,
      },
      researchState: {
        kind: "completed",
        hasResearchData: true,
        completedExecutor: "openrouter",
        activeJob: null,
        latestJob: null,
        recoveryAction: null,
      },
    });

    const result = await caller.research.full({ domain: "acme.com" });
    expect(result.researchData).not.toBeNull();
    expect(result.researchData!.companyIntel!.onlinePresence!.websiteUrl).toBeUndefined();
  });

  it("T37: null researchData returns null", async () => {
    mockedGetResearchPageSnapshot.mockResolvedValue({
      company: {
        domain: "acme.com",
        name: "Acme Corp",
        url: "https://acme.com",
        researchData: null,
        score: 60,
        originalScore: null,
        scoredAt: null,
      },
      researchState: {
        kind: "idle",
        hasResearchData: false,
        completedExecutor: null,
        activeJob: null,
        latestJob: null,
        recoveryAction: { type: "request" },
      },
    });

    const result = await caller.research.full({ domain: "acme.com" });
    expect(result.researchData).toBeNull();
    expect(result.effectiveScore).toBe(60);
  });

  it("T38: score decay applies correctly at 45 days", async () => {
    const fortyFiveDaysAgo = new Date(Date.now() - 45 * 24 * 60 * 60 * 1000);
    mockedGetResearchPageSnapshot.mockResolvedValue({
      company: {
        domain: "acme.com",
        name: "Acme Corp",
        url: "https://acme.com",
        researchData: null,
        score: 100,
        originalScore: 100,
        scoredAt: fortyFiveDaysAgo,
      },
      researchState: {
        kind: "idle",
        hasResearchData: false,
        completedExecutor: null,
        activeJob: null,
        latestJob: null,
        recoveryAction: { type: "request" },
      },
    });

    const result = await caller.research.full({ domain: "acme.com" });
    expect(result.effectiveScore).toBe(75);
  });

  it("T39: maps ResearchCompanyNotFoundError to NOT_FOUND", async () => {
    mockedGetResearchPageSnapshot.mockRejectedValue(
      new ResearchCompanyNotFoundError("missing.com"),
    );

    try {
      await caller.research.full({ domain: "missing.com" });
      expect.unreachable("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(TRPCError);
      expect((err as TRPCError).code).toBe("NOT_FOUND");
    }
  });
});
