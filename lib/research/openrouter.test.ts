import { describe, it, expect } from "vitest";
import {
  loadOpenRouterConfig,
  parseMessageContent,
  normalizeResearchData,
  normalizeStringArray,
  normalizeSourcedTextArray,
  normalizeReferenceArray,
  normalizePainPointHypotheses,
  normalizePersonalizationHooks,
  toSafeOpenRouterJobError,
  getOpenRouterAnnotationUrls,
  getOpenRouterToolCallCount,
  pickString,
  pickRecord,
  isRecord,
  OpenRouterConfigurationError,
  OpenRouterRequestError,
  type OpenRouterChatResponse,
} from "./openrouter";

// ---------------------------------------------------------------------------
// loadOpenRouterConfig
// ---------------------------------------------------------------------------

describe("loadOpenRouterConfig", () => {
  it("returns valid config when all required env vars present", () => {
    const result = loadOpenRouterConfig({
      OPENROUTER_API_KEY: "sk-test-123",
    } as unknown as NodeJS.ProcessEnv);

    expect(result).toEqual({
      apiKey: "sk-test-123",
      model: "google/gemini-3-flash-preview",
      webEngine: undefined,
      webMaxResults: 5,
      webSearchContextSize: undefined,
      maxCompletionTokens: 3000,
      siteUrl: undefined,
      siteName: undefined,
    });
  });

  it("throws OpenRouterConfigurationError when OPENROUTER_API_KEY is missing", () => {
    expect(() => loadOpenRouterConfig({} as unknown as NodeJS.ProcessEnv)).toThrow(
      OpenRouterConfigurationError,
    );

    try {
      loadOpenRouterConfig({} as unknown as NodeJS.ProcessEnv);
    } catch (err) {
      expect((err as Error).message).toContain("OPENROUTER_API_KEY");
    }
  });

  it("throws OpenRouterConfigurationError when OPENROUTER_API_KEY is empty string", () => {
    expect(() =>
      loadOpenRouterConfig({ OPENROUTER_API_KEY: "" } as unknown as NodeJS.ProcessEnv),
    ).toThrow(OpenRouterConfigurationError);
  });

  it("applies optional overrides when present", () => {
    const result = loadOpenRouterConfig({
      OPENROUTER_API_KEY: "sk-test",
      OPENROUTER_MODEL: "anthropic/claude-3.5-sonnet",
      OPENROUTER_WEB_MAX_RESULTS: "8",
      OPENROUTER_MAX_COMPLETION_TOKENS: "4000",
    } as unknown as NodeJS.ProcessEnv);

    expect(result.model).toBe("anthropic/claude-3.5-sonnet");
    expect(result.webMaxResults).toBe(8);
    expect(result.maxCompletionTokens).toBe(4000);
  });

  it("applies web engine and context size overrides", () => {
    const result = loadOpenRouterConfig({
      OPENROUTER_API_KEY: "sk-test",
      OPENROUTER_WEB_ENGINE: "exa",
      OPENROUTER_WEB_SEARCH_CONTEXT_SIZE: "high",
    } as unknown as NodeJS.ProcessEnv);

    expect(result.webEngine).toBe("exa");
    expect(result.webSearchContextSize).toBe("high");
  });

  it("applies site URL and site name overrides", () => {
    const result = loadOpenRouterConfig({
      OPENROUTER_API_KEY: "sk-test",
      OPENROUTER_SITE_URL: "https://example.com",
      OPENROUTER_SITE_NAME: "TestApp",
    } as unknown as NodeJS.ProcessEnv);

    expect(result.siteUrl).toBe("https://example.com");
    expect(result.siteName).toBe("TestApp");
  });

  it("coerces string numbers to numbers for numeric fields", () => {
    const result = loadOpenRouterConfig({
      OPENROUTER_API_KEY: "sk-test",
      OPENROUTER_WEB_MAX_RESULTS: "3",
      OPENROUTER_MAX_COMPLETION_TOKENS: "512",
    } as unknown as NodeJS.ProcessEnv);

    expect(result.webMaxResults).toBe(3);
    expect(result.maxCompletionTokens).toBe(512);
  });
});

// ---------------------------------------------------------------------------
// parseMessageContent
// ---------------------------------------------------------------------------

describe("parseMessageContent", () => {
  it("parses plain JSON string content", () => {
    const choices: OpenRouterChatResponse["choices"] = [
      { message: { content: '{"version":1,"summary":"test"}' } },
    ];
    const result = parseMessageContent(choices);
    expect(result).toEqual({ version: 1, summary: "test" });
  });

  it("strips markdown json fences from JSON content", () => {
    const choices: OpenRouterChatResponse["choices"] = [
      { message: { content: '```json\n{"version":1}\n```' } },
    ];
    const result = parseMessageContent(choices);
    expect(result).toEqual({ version: 1 });
  });

  it("strips plain markdown fences from JSON content", () => {
    const choices: OpenRouterChatResponse["choices"] = [
      { message: { content: '```\n{"version":1}\n```' } },
    ];
    const result = parseMessageContent(choices);
    expect(result).toEqual({ version: 1 });
  });

  it("handles array content (multi-part response)", () => {
    const choices: OpenRouterChatResponse["choices"] = [
      {
        message: {
          content: [
            { type: "text", text: '{"ver' },
            { type: "text", text: 'sion":1}' },
          ],
        },
      },
    ];
    const result = parseMessageContent(choices);
    expect(result).toEqual({ version: 1 });
  });

  it("throws OpenRouterRequestError for non-JSON string content", () => {
    const choices: OpenRouterChatResponse["choices"] = [
      { message: { content: "I cannot fulfill this request" } },
    ];

    expect(() => parseMessageContent(choices)).toThrow(OpenRouterRequestError);
    expect(() => parseMessageContent(choices)).toThrow(/non-JSON response/);
  });

  it("throws OpenRouterRequestError for non-JSON array content", () => {
    const choices: OpenRouterChatResponse["choices"] = [
      {
        message: {
          content: [{ type: "text", text: "Hello world" }],
        },
      },
    ];

    expect(() => parseMessageContent(choices)).toThrow(OpenRouterRequestError);
    expect(() => parseMessageContent(choices)).toThrow(/non-JSON response/);
  });

  it("throws OpenRouterRequestError for empty/undefined content", () => {
    const choices: OpenRouterChatResponse["choices"] = [
      { message: { content: undefined } },
    ];

    expect(() => parseMessageContent(choices)).toThrow(OpenRouterRequestError);
    expect(() => parseMessageContent(choices)).toThrow(/empty response/);
  });

  it("throws OpenRouterRequestError when choices is undefined", () => {
    expect(() => parseMessageContent(undefined)).toThrow(OpenRouterRequestError);
    expect(() => parseMessageContent(undefined)).toThrow(/empty response/);
  });

  it("throws OpenRouterRequestError for empty choices array", () => {
    expect(() => parseMessageContent([])).toThrow(OpenRouterRequestError);
    expect(() => parseMessageContent([])).toThrow(/empty response/);
  });

  it("parses JSON array responses", () => {
    const choices: OpenRouterChatResponse["choices"] = [
      { message: { content: '[{"a":1},{"b":2}]' } },
    ];
    const result = parseMessageContent(choices);
    expect(result).toEqual([{ a: 1 }, { b: 2 }]);
  });
});

// ---------------------------------------------------------------------------
// normalizeResearchData
// ---------------------------------------------------------------------------

describe("normalizeResearchData", () => {
  it("produces valid ResearchData from minimal valid input", () => {
    const raw = {
      summary: "Acme is a B2B SaaS",
      companyIntel: {
        productMarket: { whatTheyDo: "Project management" },
      },
    };

    const result = normalizeResearchData(raw, 5000);
    expect(result.version).toBe(1);
    expect(result.summary).toBe("Acme is a B2B SaaS");
    expect(result.companyIntel?.productMarket?.whatTheyDo).toBe("Project management");
    expect(result.meta?.totalDurationMs).toBe(5000);
    expect(typeof result.researchedAt).toBe("string");
  });

  it("produces valid ResearchData from full valid input with all fields", () => {
    const raw = {
      summary: "Full company research",
      researchedAt: "2026-03-27T00:00:00.000Z",
      companyIntel: {
        productMarket: {
          whatTheyDo: "AI testing platform",
          coreProductService: "Automated test generation",
          targetCustomer: "Engineering teams",
          businessModel: "SaaS",
          pricingModel: "Per-seat",
          keyDifferentiator: "AI-powered test writing",
        },
        stageTraction: {
          fundingStageAmount: "Series A, $10M",
          keyInvestors: ["Sequoia", "a16z"],
          estimatedTeamSize: "50-100",
          founded: "2023",
          revenueSignals: [{ text: "Growing ARR", source: "TechCrunch" }],
          growthSignals: [{ text: "2x YoY", source: "Blog" }],
        },
        techStack: {
          frontend: ["React", "TypeScript"],
          backend: ["Node.js"],
          infrastructure: ["AWS"],
          notableToolsIntegrations: ["GitHub"],
          sources: [{ text: "BuiltWith", source: "BuiltWith" }],
        },
        onlinePresence: {
          websiteUrl: "https://example.com",
          trafficEstimate: "100k/mo",
          blogContentStrategy: "Weekly posts",
          seoPresence: "Strong",
        },
      },
      prospectIntel: {
        background: {
          name: "Jane Doe",
          role: "CTO",
          careerHistory: ["Google", "Stripe"],
          education: ["Stanford CS"],
          previousCompaniesExits: ["Acme (acquired)"],
          backgroundType: "Technical",
        },
        contentThoughtLeadership: {
          linkedinPosting: "Active",
          blogNewsletter: "Weekly newsletter",
          podcastAppearances: [
            { title: "Tech Talk", platform: "Spotify", url: "https://spotify.com/ep1" },
          ],
          conferenceTalks: [
            { title: "Scaling Tests", event: "QCon", url: "https://qcon.com/talk" },
          ],
          twitterPresence: "Moderate",
          keyOpinions: ["AI-first testing"],
        },
        personalitySignals: {
          interestsOutsideWork: ["Running", "Photography"],
          communicationStyle: "Direct",
          values: ["Transparency", "Quality"],
        },
      },
      painPointHypotheses: [
        { painPoint: "Slow test cycles", evidenceOrSignal: "Blog post" },
      ],
      personalizationHooks: [
        { hook: "Recent podcast on AI testing", source: "Spotify" },
      ],
      meta: {
        totalSearches: 12,
        phasesCompleted: ["company", "prospect"],
        phasesFailed: [],
      },
    };

    const result = normalizeResearchData(raw, 8000);
    expect(result.version).toBe(1);
    expect(result.researchedAt).toBe("2026-03-27T00:00:00.000Z");
    expect(result.summary).toBe("Full company research");
    expect(result.meta?.totalDurationMs).toBe(8000);
    expect(result.meta?.totalSearches).toBe(12);
    expect(result.meta?.phasesCompleted).toEqual(["company", "prospect"]);
    expect(result.companyIntel?.productMarket?.whatTheyDo).toBe("AI testing platform");
    expect(result.prospectIntel?.background?.name).toBe("Jane Doe");
    expect(result.painPointHypotheses?.[0]?.painPoint).toBe("Slow test cycles");
    expect(result.personalizationHooks?.[0]?.hook).toBe("Recent podcast on AI testing");
  });

  it("throws when summary is missing (EC-6)", () => {
    const raw = {
      companyIntel: { productMarket: { whatTheyDo: "test" } },
    };

    expect(() => normalizeResearchData(raw, 1000)).toThrow(OpenRouterRequestError);
    expect(() => normalizeResearchData(raw, 1000)).toThrow(/no summary/);
  });

  it("throws when summary is empty string (EC-6)", () => {
    const raw = {
      summary: "   ",
      companyIntel: { productMarket: { whatTheyDo: "test" } },
    };

    expect(() => normalizeResearchData(raw, 1000)).toThrow(OpenRouterRequestError);
    expect(() => normalizeResearchData(raw, 1000)).toThrow(/no summary/);
  });

  it("throws when neither companyIntel nor prospectIntel present (EC-6)", () => {
    const raw = { summary: "Some summary" };

    expect(() => normalizeResearchData(raw, 1000)).toThrow(OpenRouterRequestError);
    expect(() => normalizeResearchData(raw, 1000)).toThrow(
      /no company or prospect intel/,
    );
  });

  it("throws for non-object input (string)", () => {
    expect(() => normalizeResearchData("just a string", 1000)).toThrow(
      OpenRouterRequestError,
    );
    expect(() => normalizeResearchData("just a string", 1000)).toThrow(
      /non-object/,
    );
  });

  it("throws for non-object input (null)", () => {
    expect(() => normalizeResearchData(null, 1000)).toThrow(
      OpenRouterRequestError,
    );
    expect(() => normalizeResearchData(null, 1000)).toThrow(/non-object/);
  });

  it("throws for non-object input (array)", () => {
    expect(() => normalizeResearchData([1, 2, 3], 1000)).toThrow(
      OpenRouterRequestError,
    );
    expect(() => normalizeResearchData([1, 2, 3], 1000)).toThrow(/non-object/);
  });

  it("normalizes alternative key names (company_intel -> companyIntel)", () => {
    const raw = {
      summary: "test",
      company_intel: { productMarket: { whatTheyDo: "test" } },
    };

    const result = normalizeResearchData(raw, 1000);
    expect(result.companyIntel?.productMarket?.whatTheyDo).toBe("test");
  });

  it("forces version to 1 regardless of input", () => {
    const raw = {
      summary: "test",
      version: 99,
      companyIntel: { productMarket: { whatTheyDo: "test" } },
    };

    const result = normalizeResearchData(raw, 1000);
    expect(result.version).toBe(1);
  });

  it("normalizes pain point strings into {painPoint} objects", () => {
    const raw = {
      summary: "test",
      companyIntel: { productMarket: { whatTheyDo: "t" } },
      painPointHypotheses: ["No analytics", "Slow onboarding"],
    };

    const result = normalizeResearchData(raw, 1000);
    expect(result.painPointHypotheses?.[0]?.painPoint).toBe("No analytics");
    expect(result.painPointHypotheses?.[1]?.painPoint).toBe("Slow onboarding");
  });

  it("normalizes personalization hook strings into {hook} objects", () => {
    const raw = {
      summary: "test",
      companyIntel: { productMarket: { whatTheyDo: "t" } },
      personalizationHooks: ["Recent podcast appearance"],
    };

    const result = normalizeResearchData(raw, 1000);
    expect(result.personalizationHooks?.[0]?.hook).toBe(
      "Recent podcast appearance",
    );
  });

  it("generates researchedAt when not provided", () => {
    const raw = {
      summary: "test",
      companyIntel: { productMarket: { whatTheyDo: "test" } },
    };

    const result = normalizeResearchData(raw, 1000);
    expect(typeof result.researchedAt).toBe("string");
    // Should be a valid ISO-8601 string
    expect(new Date(result.researchedAt!).toISOString()).toBe(result.researchedAt);
  });

  it("preserves researchedAt when provided as string", () => {
    const raw = {
      summary: "test",
      companyIntel: { productMarket: { whatTheyDo: "test" } },
      researchedAt: "2026-01-15T12:00:00.000Z",
    };

    const result = normalizeResearchData(raw, 1000);
    expect(result.researchedAt).toBe("2026-01-15T12:00:00.000Z");
  });

  it("defaults meta fields when not provided", () => {
    const raw = {
      summary: "test",
      companyIntel: { productMarket: { whatTheyDo: "test" } },
    };

    const result = normalizeResearchData(raw, 2500);
    expect(result.meta?.totalSearches).toBe(0);
    expect(result.meta?.totalDurationMs).toBe(2500);
    expect(result.meta?.phasesCompleted).toEqual([]);
    expect(result.meta?.phasesFailed).toEqual([]);
  });

  it("accepts prospectIntel without companyIntel (EC-6 requires at least one)", () => {
    const raw = {
      summary: "Prospect-only research",
      prospectIntel: {
        background: { name: "John", role: "CEO" },
      },
    };

    const result = normalizeResearchData(raw, 1000);
    expect(result.prospectIntel?.background?.name).toBe("John");
    expect(result.companyIntel).toBeUndefined();
  });

  it("normalizes alternative prospect key names", () => {
    const raw = {
      summary: "test",
      prospect: {
        background: { name: "Alice", title: "VP Eng" },
      },
    };

    const result = normalizeResearchData(raw, 1000);
    expect(result.prospectIntel?.background?.name).toBe("Alice");
    expect(result.prospectIntel?.background?.role).toBe("VP Eng");
  });
});

// ---------------------------------------------------------------------------
// normalizeStringArray
// ---------------------------------------------------------------------------

describe("normalizeStringArray", () => {
  it("returns array of non-empty strings", () => {
    expect(normalizeStringArray(["React", "TypeScript"])).toEqual([
      "React",
      "TypeScript",
    ]);
  });

  it("filters out empty strings and non-strings", () => {
    expect(normalizeStringArray(["valid", "", 42, null, "also valid"])).toEqual([
      "valid",
      "also valid",
    ]);
  });

  it("filters out whitespace-only strings", () => {
    expect(normalizeStringArray(["   ", "valid"])).toEqual(["valid"]);
  });

  it("returns undefined for non-array input", () => {
    expect(normalizeStringArray("not an array")).toBeUndefined();
    expect(normalizeStringArray(null)).toBeUndefined();
    expect(normalizeStringArray(undefined)).toBeUndefined();
    expect(normalizeStringArray(42)).toBeUndefined();
  });

  it("returns undefined for empty array", () => {
    expect(normalizeStringArray([])).toBeUndefined();
  });

  it("returns undefined when all entries are filtered out", () => {
    expect(normalizeStringArray(["", "   ", null])).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// normalizeSourcedTextArray
// ---------------------------------------------------------------------------

describe("normalizeSourcedTextArray", () => {
  it("converts plain strings to {text} objects", () => {
    const result = normalizeSourcedTextArray(["Growing ARR"]);
    expect(result).toEqual([{ text: "Growing ARR" }]);
  });

  it("extracts text from record with 'text' key", () => {
    const result = normalizeSourcedTextArray([
      { text: "Revenue doubled", source: "TechCrunch" },
    ]);
    expect(result).toEqual([
      { text: "Revenue doubled", source: "TechCrunch" },
    ]);
  });

  it("extracts text from alternative keys (signal, item, title, label)", () => {
    expect(normalizeSourcedTextArray([{ signal: "Hiring surge" }])).toEqual([
      { text: "Hiring surge" },
    ]);
    expect(normalizeSourcedTextArray([{ item: "New office" }])).toEqual([
      { text: "New office" },
    ]);
    expect(normalizeSourcedTextArray([{ title: "Award win" }])).toEqual([
      { text: "Award win" },
    ]);
    expect(normalizeSourcedTextArray([{ label: "Partnership" }])).toEqual([
      { text: "Partnership" },
    ]);
  });

  it("includes sourceUrl when present via url key", () => {
    const result = normalizeSourcedTextArray([
      { text: "Growth", url: "https://example.com/article" },
    ]);
    expect(result).toEqual([
      { text: "Growth", sourceUrl: "https://example.com/article" },
    ]);
  });

  it("includes source when present via platform key", () => {
    const result = normalizeSourcedTextArray([
      { text: "Growing", platform: "LinkedIn" },
    ]);
    expect(result).toEqual([{ text: "Growing", source: "LinkedIn" }]);
  });

  it("returns undefined for non-array input", () => {
    expect(normalizeSourcedTextArray("not an array")).toBeUndefined();
    expect(normalizeSourcedTextArray(null)).toBeUndefined();
    expect(normalizeSourcedTextArray(undefined)).toBeUndefined();
  });

  it("returns undefined for empty array", () => {
    expect(normalizeSourcedTextArray([])).toBeUndefined();
  });

  it("skips entries without recognizable text key", () => {
    const result = normalizeSourcedTextArray([
      { unknownKey: "something" },
      { text: "valid entry" },
    ]);
    expect(result).toEqual([{ text: "valid entry" }]);
  });

  it("skips non-record, non-string entries", () => {
    const result = normalizeSourcedTextArray([42, null, { text: "valid" }]);
    expect(result).toEqual([{ text: "valid" }]);
  });

  it("trims whitespace from string entries", () => {
    const result = normalizeSourcedTextArray(["  Growing ARR  "]);
    expect(result).toEqual([{ text: "Growing ARR" }]);
  });
});

// ---------------------------------------------------------------------------
// normalizeReferenceArray
// ---------------------------------------------------------------------------

describe("normalizeReferenceArray", () => {
  it("converts plain strings to {title} objects", () => {
    const result = normalizeReferenceArray(["Great talk"], "platform");
    expect(result).toEqual([{ title: "Great talk" }]);
  });

  it("extracts title from record with 'title' key", () => {
    const result = normalizeReferenceArray(
      [{ title: "Episode 1", platform: "Spotify", url: "https://spotify.com/ep1" }],
      "platform",
    );
    expect(result).toEqual([
      {
        title: "Episode 1",
        platform: "Spotify",
        url: "https://spotify.com/ep1",
      },
    ]);
  });

  it("extracts title from alternative 'name' key", () => {
    const result = normalizeReferenceArray(
      [{ name: "QCon Talk" }],
      "event",
    );
    expect(result).toEqual([{ title: "QCon Talk" }]);
  });

  it("uses metaKey 'event' for conference talks", () => {
    const result = normalizeReferenceArray(
      [{ title: "Scaling Tests", event: "QCon 2025" }],
      "event",
    );
    expect(result).toEqual([{ title: "Scaling Tests", event: "QCon 2025" }]);
  });

  it("includes date and summary when present", () => {
    const result = normalizeReferenceArray(
      [{ title: "Episode", date: "2026-01-01", summary: "Great episode" }],
      "platform",
    );
    expect(result).toEqual([
      { title: "Episode", date: "2026-01-01", summary: "Great episode" },
    ]);
  });

  it("uses 'description' as alternative for summary", () => {
    const result = normalizeReferenceArray(
      [{ title: "Talk", description: "About testing" }],
      "event",
    );
    expect(result).toEqual([{ title: "Talk", summary: "About testing" }]);
  });

  it("returns undefined for non-array input", () => {
    expect(normalizeReferenceArray("not an array", "platform")).toBeUndefined();
    expect(normalizeReferenceArray(null, "event")).toBeUndefined();
  });

  it("returns undefined for empty array", () => {
    expect(normalizeReferenceArray([], "platform")).toBeUndefined();
  });

  it("skips entries without recognizable title key", () => {
    const result = normalizeReferenceArray(
      [{ unknownKey: "value" }, { title: "Valid" }],
      "platform",
    );
    expect(result).toEqual([{ title: "Valid" }]);
  });
});

// ---------------------------------------------------------------------------
// normalizePainPointHypotheses
// ---------------------------------------------------------------------------

describe("normalizePainPointHypotheses", () => {
  it("converts plain strings to {painPoint} objects", () => {
    const result = normalizePainPointHypotheses(["No analytics"]);
    expect(result).toEqual([{ painPoint: "No analytics" }]);
  });

  it("extracts painPoint from record with 'painPoint' key", () => {
    const result = normalizePainPointHypotheses([
      {
        painPoint: "Slow CI",
        evidenceOrSignal: "Blog post mentions it",
        relevantCapability: "Parallel testing",
      },
    ]);
    expect(result).toEqual([
      {
        painPoint: "Slow CI",
        evidenceOrSignal: "Blog post mentions it",
        relevantCapability: "Parallel testing",
      },
    ]);
  });

  it("extracts painPoint from alternative keys (title, problem)", () => {
    expect(normalizePainPointHypotheses([{ title: "Slow builds" }])).toEqual([
      { painPoint: "Slow builds" },
    ]);
    expect(normalizePainPointHypotheses([{ problem: "Flaky tests" }])).toEqual([
      { painPoint: "Flaky tests" },
    ]);
  });

  it("extracts evidenceOrSignal from alternative keys", () => {
    const result = normalizePainPointHypotheses([
      { painPoint: "Issue", evidence: "From blog" },
    ]);
    expect(result).toEqual([
      { painPoint: "Issue", evidenceOrSignal: "From blog" },
    ]);

    const result2 = normalizePainPointHypotheses([
      { painPoint: "Issue", signal: "LinkedIn post" },
    ]);
    expect(result2).toEqual([
      { painPoint: "Issue", evidenceOrSignal: "LinkedIn post" },
    ]);
  });

  it("extracts relevantCapability from alternative keys", () => {
    const result = normalizePainPointHypotheses([
      { painPoint: "Issue", capability: "Auto-fix" },
    ]);
    expect(result).toEqual([
      { painPoint: "Issue", relevantCapability: "Auto-fix" },
    ]);

    const result2 = normalizePainPointHypotheses([
      { painPoint: "Issue", whyRelevant: "Saves time" },
    ]);
    expect(result2).toEqual([
      { painPoint: "Issue", relevantCapability: "Saves time" },
    ]);
  });

  it("returns undefined for non-array input", () => {
    expect(normalizePainPointHypotheses("not an array")).toBeUndefined();
    expect(normalizePainPointHypotheses(null)).toBeUndefined();
  });

  it("returns undefined for empty array", () => {
    expect(normalizePainPointHypotheses([])).toBeUndefined();
  });

  it("skips entries without recognizable painPoint key", () => {
    const result = normalizePainPointHypotheses([
      { unknownKey: "value" },
      { painPoint: "Valid" },
    ]);
    expect(result).toEqual([{ painPoint: "Valid" }]);
  });
});

// ---------------------------------------------------------------------------
// normalizePersonalizationHooks
// ---------------------------------------------------------------------------

describe("normalizePersonalizationHooks", () => {
  it("converts plain strings to {hook} objects", () => {
    const result = normalizePersonalizationHooks(["Recent podcast"]);
    expect(result).toEqual([{ hook: "Recent podcast" }]);
  });

  it("extracts hook from record with 'hook' key", () => {
    const result = normalizePersonalizationHooks([
      {
        hook: "Conference talk",
        source: "YouTube",
        sourceUrl: "https://youtube.com/watch",
      },
    ]);
    expect(result).toEqual([
      {
        hook: "Conference talk",
        source: "YouTube",
        sourceUrl: "https://youtube.com/watch",
      },
    ]);
  });

  it("extracts hook from alternative keys (text, title)", () => {
    expect(
      normalizePersonalizationHooks([{ text: "Just raised Series A" }]),
    ).toEqual([{ hook: "Just raised Series A" }]);
    expect(
      normalizePersonalizationHooks([{ title: "New product launch" }]),
    ).toEqual([{ hook: "New product launch" }]);
  });

  it("includes source via platform key", () => {
    const result = normalizePersonalizationHooks([
      { hook: "Active poster", platform: "LinkedIn" },
    ]);
    expect(result).toEqual([{ hook: "Active poster", source: "LinkedIn" }]);
  });

  it("includes sourceUrl via url key", () => {
    const result = normalizePersonalizationHooks([
      { hook: "Blog post", url: "https://blog.com/post" },
    ]);
    expect(result).toEqual([
      { hook: "Blog post", sourceUrl: "https://blog.com/post" },
    ]);
  });

  it("returns undefined for non-array input", () => {
    expect(normalizePersonalizationHooks("not an array")).toBeUndefined();
    expect(normalizePersonalizationHooks(null)).toBeUndefined();
  });

  it("returns undefined for empty array", () => {
    expect(normalizePersonalizationHooks([])).toBeUndefined();
  });

  it("skips entries without recognizable hook key", () => {
    const result = normalizePersonalizationHooks([
      { unknownKey: "value" },
      { hook: "Valid" },
    ]);
    expect(result).toEqual([{ hook: "Valid" }]);
  });
});

// ---------------------------------------------------------------------------
// toSafeOpenRouterJobError
// ---------------------------------------------------------------------------

describe("toSafeOpenRouterJobError", () => {
  it("returns safe message for OpenRouterConfigurationError", () => {
    const error = new OpenRouterConfigurationError("bad key");
    expect(toSafeOpenRouterJobError(error)).toBe(
      "OpenRouter worker is misconfigured. Check worker environment and retry.",
    );
  });

  it("returns error.message for OpenRouterRequestError", () => {
    const error = new OpenRouterRequestError("Model returned empty response");
    expect(toSafeOpenRouterJobError(error)).toBe(
      "Model returned empty response",
    );
  });

  it("returns safe message for SyntaxError", () => {
    const error = new SyntaxError("Unexpected token");
    expect(toSafeOpenRouterJobError(error)).toBe(
      "OpenRouter returned invalid JSON. Check worker logs and retry.",
    );
  });

  it("truncates generic Error message to 500 chars", () => {
    const error = new Error("x".repeat(600));
    const result = toSafeOpenRouterJobError(error);
    expect(result.length).toBe(500);
  });

  it("returns error.message for short generic Error", () => {
    const error = new Error("connection refused");
    expect(toSafeOpenRouterJobError(error)).toBe("connection refused");
  });

  it("returns generic message for non-Error input (number)", () => {
    expect(toSafeOpenRouterJobError(42)).toBe(
      "OpenRouter research failed. Check worker logs and retry.",
    );
  });

  it("returns generic message for non-Error input (string)", () => {
    expect(toSafeOpenRouterJobError("some string")).toBe(
      "OpenRouter research failed. Check worker logs and retry.",
    );
  });

  it("returns generic message for non-Error input (null)", () => {
    expect(toSafeOpenRouterJobError(null)).toBe(
      "OpenRouter research failed. Check worker logs and retry.",
    );
  });

  it("returns generic message for non-Error input (undefined)", () => {
    expect(toSafeOpenRouterJobError(undefined)).toBe(
      "OpenRouter research failed. Check worker logs and retry.",
    );
  });
});

// ---------------------------------------------------------------------------
// getOpenRouterAnnotationUrls
// ---------------------------------------------------------------------------

describe("getOpenRouterAnnotationUrls", () => {
  it("extracts URLs from annotations", () => {
    const response: OpenRouterChatResponse = {
      choices: [
        {
          message: {
            content: "{}",
            annotations: [
              {
                type: "url_citation",
                url_citation: {
                  url: "https://example.com/page1",
                  title: "Page 1",
                },
              },
              {
                type: "url_citation",
                url_citation: {
                  url: "https://example.com/page2",
                  title: "Page 2",
                },
              },
            ],
          },
        },
      ],
    };

    expect(getOpenRouterAnnotationUrls(response)).toEqual([
      "https://example.com/page1",
      "https://example.com/page2",
    ]);
  });

  it("returns empty array when no annotations", () => {
    const response: OpenRouterChatResponse = {
      choices: [{ message: { content: "{}" } }],
    };
    expect(getOpenRouterAnnotationUrls(response)).toEqual([]);
  });

  it("returns empty array when choices is undefined", () => {
    const response: OpenRouterChatResponse = {};
    expect(getOpenRouterAnnotationUrls(response)).toEqual([]);
  });

  it("filters out annotations without URL", () => {
    const response: OpenRouterChatResponse = {
      choices: [
        {
          message: {
            content: "{}",
            annotations: [
              { type: "url_citation", url_citation: { url: "", title: "Empty" } },
              {
                type: "url_citation",
                url_citation: { url: "https://valid.com", title: "Valid" },
              },
              { type: "url_citation", url_citation: {} },
            ],
          },
        },
      ],
    };

    expect(getOpenRouterAnnotationUrls(response)).toEqual([
      "https://valid.com",
    ]);
  });
});

// ---------------------------------------------------------------------------
// getOpenRouterToolCallCount
// ---------------------------------------------------------------------------

describe("getOpenRouterToolCallCount", () => {
  it("returns count of tool calls", () => {
    const response: OpenRouterChatResponse = {
      choices: [
        {
          message: {
            content: "{}",
            tool_calls: [{}, {}, {}],
          },
        },
      ],
    };
    expect(getOpenRouterToolCallCount(response)).toBe(3);
  });

  it("returns 0 when no tool calls", () => {
    const response: OpenRouterChatResponse = {
      choices: [{ message: { content: "{}" } }],
    };
    expect(getOpenRouterToolCallCount(response)).toBe(0);
  });

  it("returns 0 when choices is undefined", () => {
    const response: OpenRouterChatResponse = {};
    expect(getOpenRouterToolCallCount(response)).toBe(0);
  });

  it("returns 0 when tool_calls is not an array", () => {
    const response: OpenRouterChatResponse = {
      choices: [
        {
          message: {
            content: "{}",
            // tool_calls is undefined by default
          },
        },
      ],
    };
    expect(getOpenRouterToolCallCount(response)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// pickString
// ---------------------------------------------------------------------------

describe("pickString", () => {
  it("returns the first matching non-empty string value", () => {
    const source = { a: "hello", b: "world" };
    expect(pickString(source, ["a", "b"])).toBe("hello");
  });

  it("skips non-string values and returns first valid string", () => {
    const source = { a: 42, b: null, c: "found" };
    expect(pickString(source, ["a", "b", "c"])).toBe("found");
  });

  it("returns undefined when no keys match", () => {
    const source = { a: 42, b: null };
    expect(pickString(source, ["a", "b", "c"])).toBeUndefined();
  });

  it("returns undefined for empty string values", () => {
    const source = { a: "", b: "   " };
    expect(pickString(source, ["a", "b"])).toBeUndefined();
  });

  it("trims whitespace from returned strings", () => {
    const source = { name: "  trimmed  " };
    expect(pickString(source, ["name"])).toBe("trimmed");
  });

  it("returns undefined when source has no matching keys", () => {
    const source = { x: "value" };
    expect(pickString(source, ["a", "b"])).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// pickRecord
// ---------------------------------------------------------------------------

describe("pickRecord", () => {
  it("returns the first matching record value", () => {
    const inner = { key: "value" };
    const source = { a: inner, b: { other: true } };
    expect(pickRecord(source, ["a", "b"])).toBe(inner);
  });

  it("skips non-record values", () => {
    const inner = { key: "value" };
    const source = { a: "string", b: 42, c: inner };
    expect(pickRecord(source, ["a", "b", "c"])).toBe(inner);
  });

  it("skips array values (arrays are not records)", () => {
    const inner = { key: "value" };
    const source = { a: [1, 2], b: inner };
    expect(pickRecord(source, ["a", "b"])).toBe(inner);
  });

  it("returns undefined when no keys match a record", () => {
    const source = { a: "string", b: 42, c: null };
    expect(pickRecord(source, ["a", "b", "c"])).toBeUndefined();
  });

  it("returns undefined when source has no matching keys", () => {
    const source = { x: { nested: true } };
    expect(pickRecord(source, ["a", "b"])).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// isRecord
// ---------------------------------------------------------------------------

describe("isRecord", () => {
  it("returns true for plain objects", () => {
    expect(isRecord({ a: 1 })).toBe(true);
    expect(isRecord({})).toBe(true);
  });

  it("returns false for arrays", () => {
    expect(isRecord([1, 2, 3])).toBe(false);
    expect(isRecord([])).toBe(false);
  });

  it("returns false for null", () => {
    expect(isRecord(null)).toBe(false);
  });

  it("returns false for undefined", () => {
    expect(isRecord(undefined)).toBe(false);
  });

  it("returns false for primitives", () => {
    expect(isRecord("string")).toBe(false);
    expect(isRecord(42)).toBe(false);
    expect(isRecord(true)).toBe(false);
  });

  it("returns false for zero (falsy value)", () => {
    expect(isRecord(0)).toBe(false);
  });

  it("returns false for empty string (falsy value)", () => {
    expect(isRecord("")).toBe(false);
  });
});
