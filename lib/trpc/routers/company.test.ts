import { describe, it, expect, vi, beforeEach } from "vitest";
import { TRPCError } from "@trpc/server";

// ─── Module mocks ────────────────────────────────────────────────────────────

vi.mock("@/lib/prisma", () => ({
  prisma: {
    company: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      groupBy: vi.fn(),
      update: vi.fn(),
    },
    $queryRaw: vi.fn(),
  },
}));

vi.mock("@/lib/research/service", () => ({
  getResearchRouteState: vi.fn(),
  ResearchCompanyNotFoundError: class ResearchCompanyNotFoundError extends Error {
    constructor(domain: string) {
      super(`Company not found: ${domain}`);
      this.name = "ResearchCompanyNotFoundError";
    }
  },
}));

import { prisma } from "@/lib/prisma";
import { getResearchRouteState } from "@/lib/research/service";
import { router } from "../init";
import { companyRouter } from "./company";

const mockedFindUnique = vi.mocked(prisma.company.findUnique);
const mockedGetResearchRouteState = vi.mocked(getResearchRouteState);

const testRouter = router({ company: companyRouter });
const caller = testRouter.createCaller({});

// Default idle research state for all tests
const idleResearchState = {
  kind: "idle" as const,
  hasResearchData: false as const,
  completedExecutor: null,
  activeJob: null,
  latestJob: null,
  recoveryAction: { type: "request" as const },
};

beforeEach(() => {
  vi.clearAllMocks();
  mockedGetResearchRouteState.mockResolvedValue(idleResearchState);
});

// ─── Helper ──────────────────────────────────────────────────────────────────

function makeCompany(overrides: Record<string, unknown> = {}) {
  return {
    domain: "acme.com",
    name: "Acme Corp",
    url: "https://acme.com",
    description: "AI testing",
    source: "yc",
    state: "qualified",
    score: 80,
    originalScore: 80,
    scoredAt: new Date(),
    teamSize: 30,
    teamSizeSource: null,
    fundingStage: "seed",
    fundingEvidence: null,
    atsPlatform: null,
    hasSignup: true,
    hasPricingPage: true,
    hasGrowthHire: false,
    totalAtsRoles: 0,
    dream100: false,
    archived: false,
    sequenceStep: null,
    enrichmentData: null,
    touchpoints: [],
    ...overrides,
  } as never;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("company.brief", () => {
  it("T50: enrichment data takes priority over company columns", async () => {
    mockedFindUnique.mockResolvedValue(
      makeCompany({
        teamSize: 30,
        fundingStage: "seed",
        enrichmentData: {
          webSearch: {
            status: "success",
            employeeCount: 50,
            fundingStage: "Series A",
            fundingAmount: "$10M",
          },
        },
      }),
    );

    const result = await caller.company.brief({ domain: "acme.com" });
    expect(result.teamSize).toBe(50);
    expect(result.fundingStage).toBe("Series A");
    expect(result.fundingAmount).toBe("$10M");
  });

  it("T51: enrichment safeParse failure falls back to empty (data silently lost)", async () => {
    mockedFindUnique.mockResolvedValue(
      makeCompany({
        teamSize: 30,
        enrichmentData: {
          webSearch: { status: 999 }, // number not string, fails schema
        },
      }),
    );

    const result = await caller.company.brief({ domain: "acme.com" });
    expect(result.teamSize).toBe(30); // falls back to company column
    expect(result.fundingAmount).toBeNull();
    expect(result.keyPeople).toEqual([]);
    expect(result.pricing).toBeNull();
  });

  it("T52: null enrichmentData uses company columns as-is", async () => {
    mockedFindUnique.mockResolvedValue(
      makeCompany({
        teamSize: 25,
        fundingStage: "pre-seed",
        enrichmentData: null,
      }),
    );

    const result = await caller.company.brief({ domain: "acme.com" });
    expect(result.teamSize).toBe(25);
    expect(result.fundingStage).toBe("pre-seed");
    expect(result.keyPeople).toEqual([]);
  });

  it("T53: company not found throws NOT_FOUND", async () => {
    mockedFindUnique.mockResolvedValue(null);

    try {
      await caller.company.brief({ domain: "missing.com" });
      expect.unreachable("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(TRPCError);
      expect((err as TRPCError).code).toBe("NOT_FOUND");
    }
  });
});
