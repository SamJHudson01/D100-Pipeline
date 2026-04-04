/**
 * Shared domain types, state machine, and Zod schemas.
 *
 * Single source of truth for:
 * - Company state enum and valid transitions
 * - Zod input schemas for all tRPC procedures
 * - Derived TypeScript types via z.infer
 *
 * The Python sidecar has its own VALID_TRANSITIONS in pool_db.py.
 * Both must stay in sync — the CHECK constraint on companies.state
 * is the database-level enforcement.
 */

import { z } from "zod";

// ─── State Machine ───────────────────────────────────────────────────────────

export const COMPANY_STATES = [
  "discovered",
  "pre_filtered",
  "pre_filter_rejected",
  "enriched",
  "qualified",
  "nurture",
  "skip",
  "disqualified",
  "contacted",
  "stale",
  "dead",
] as const;

export type CompanyState = (typeof COMPANY_STATES)[number];

export const VALID_TRANSITIONS: Record<CompanyState, readonly CompanyState[]> = {
  discovered: ["pre_filtered", "pre_filter_rejected"],
  pre_filtered: ["enriched", "disqualified"],
  pre_filter_rejected: ["discovered"],
  enriched: ["qualified", "nurture", "skip", "disqualified"],
  qualified: ["contacted", "stale", "dead", "discovered"],
  nurture: ["discovered", "stale", "dead"],
  skip: ["discovered", "dead"],
  disqualified: ["discovered", "dead"],
  contacted: ["stale", "dead"],
  stale: ["discovered", "dead"],
  dead: [],
};

export function isValidTransition(from: CompanyState, to: CompanyState): boolean {
  if (from === to) return true;
  return VALID_TRANSITIONS[from].includes(to);
}

// ─── Verdicts ────────────────────────────────────────────────────────────────

export const VERDICTS = ["qualify", "nurture", "skip", "disqualify"] as const;
export type Verdict = (typeof VERDICTS)[number];

// ─── Triage Decisions ────────────────────────────────────────────────────────

export const TRIAGE_DECISIONS = ["select", "skip", "snooze", "dismiss"] as const;
export type TriageDecision = (typeof TRIAGE_DECISIONS)[number];

// ─── Pipeline Stages ────────────────────────────────────────────────────────

export const PIPELINE_STAGES = [
  "backlog",
  "outreach",
  "follow_up",
  "call",
  "closed",
  "not_closed",
] as const;
export type PipelineStage = (typeof PIPELINE_STAGES)[number];

export const PIPELINE_STAGE_LABELS: Record<PipelineStage, string> = {
  backlog: "Backlog",
  outreach: "Outreach",
  follow_up: "Follow Up",
  call: "Call",
  closed: "Closed",
  not_closed: "Not Closed",
};

// ─── Touchpoint Channels ─────────────────────────────────────────────────────

export const CHANNELS = ["email", "linkedin", "loom", "twitter", "other"] as const;
export type Channel = (typeof CHANNELS)[number];

// ─── Regions ─────────────────────────────────────────────────────────────────

export const ALL_REGIONS = "all" as const;

export const REGIONS = [
  { value: "all", label: "All" },
  { value: "uk", label: "UK" },
  { value: "global", label: "Global" },
] as const;

export const REGION_VALUES = REGIONS.map((r) => r.value);

export const DEFAULT_REGION = "uk";

// ─── Zod Schemas ─────────────────────────────────────────────────────────────

export const domainSchema = z.string().min(1).max(253);

export const triageInputSchema = z.object({
  domain: domainSchema,
  decision: z.enum(TRIAGE_DECISIONS),
  snoozeUntil: z.string().datetime().optional(),
});
export type TriageInput = z.infer<typeof triageInputSchema>;

export const markContactedInputSchema = z.object({
  domain: domainSchema,
});
export type MarkContactedInput = z.infer<typeof markContactedInputSchema>;

export const moveStageInputSchema = z.object({
  domain: domainSchema,
  stage: z.enum(PIPELINE_STAGES),
});
export type MoveStageInput = z.infer<typeof moveStageInputSchema>;

export const updateNotesInputSchema = z.object({
  domain: domainSchema,
  notes: z.string().max(5000),
});
export type UpdateNotesInput = z.infer<typeof updateNotesInputSchema>;

// ─── Score Decay ────────────────────────────────────────────────────────────

/**
 * Compute effective score after time-based decay.
 * 0-30 days: 100%, 31-60: 75%, 61-90: 50%, 90+: 0.
 */
export function computeEffectiveScore(
  score: number | null,
  originalScore: number | null,
  scoredAt: Date | null,
): number {
  const fallback = score ?? 0;
  if (originalScore == null || scoredAt == null) return fallback;
  const days = (Date.now() - scoredAt.getTime()) / (1000 * 60 * 60 * 24);
  if (days <= 30) return originalScore;
  if (days <= 60) return Math.floor(originalScore * 0.75);
  if (days <= 90) return Math.floor(originalScore * 0.5);
  return 0;
}

// ─── Sort / Filter ──────────────────────────────────────────────────────────

export const POOL_SORT_OPTIONS = ["score", "team_size_asc"] as const;
export type PoolSort = (typeof POOL_SORT_OPTIONS)[number];

export const poolFilterSchema = z.object({
  source: z.string().max(200).optional(),
  state: z.enum(COMPANY_STATES).optional(),
  q: z.string().max(200).optional(),
  page: z.number().int().min(1).max(10000).default(1),
  minScore: z.number().int().min(0).max(100).default(0),
  region: z.enum(REGION_VALUES as unknown as [string, ...string[]]).default(DEFAULT_REGION),
  sortBy: z.enum(POOL_SORT_OPTIONS).default("score"),
  showArchived: z.boolean().default(false),
});
export type PoolFilter = z.infer<typeof poolFilterSchema>;

export const companyDetailInputSchema = z.object({
  domain: domainSchema,
});
export type CompanyDetailInput = z.infer<typeof companyDetailInputSchema>;

export const triageQuerySchema = z.object({
  region: z.string().max(10).default(DEFAULT_REGION),
});
export type TriageQuery = z.infer<typeof triageQuerySchema>;

export const dream100QuerySchema = z.object({});
export type Dream100Query = z.infer<typeof dream100QuerySchema>;

export const settingsQuerySchema = z.object({
  region: z.string().max(10).default(DEFAULT_REGION),
});
export type SettingsQuery = z.infer<typeof settingsQuerySchema>;

// ─── Enrichment Data Schema ─────────────────────────────────────────────────
// Contract between Python sidecar (writes) and TypeScript app (reads).
// Every section is optional — partial enrichment is a feature, not a bug.

const enrichmentStepStatusSchema = z.enum(["success", "failed", "timeout", "rate_limited", "skipped"]);

const newsItemSchema = z.object({
  title: z.string(),
  source: z.string().optional(),
  date: z.string().optional(),
  url: z.string().optional(),
});

const keyPersonSchema = z.object({
  name: z.string(),
  title: z.string().optional(),
  role: z.enum(["founder", "ceo", "cto", "coo", "other"]).optional(),
  source: z.string().optional(),
  linkedinUrl: z.string().optional(),
  twitterHandle: z.string().optional(),
  githubUsername: z.string().optional(),
  githubAvatarUrl: z.string().optional(),
  githubBio: z.string().optional(),
  githubLocation: z.string().optional(),
  githubBlogUrl: z.string().optional(),
  githubPublicRepos: z.number().optional(),
  podcastAppearances: z.array(z.object({
    title: z.string(),
    podcast: z.string().optional(),
    date: z.string().optional(),
  })).optional(),
  conferenceTalks: z.array(z.object({
    title: z.string(),
    event: z.string().optional(),
    date: z.string().optional(),
  })).optional(),
  hasNewsletter: z.boolean().optional(),
  newsletterPlatform: z.string().optional(),
});

const detectedToolSchema = z.object({
  name: z.string(),
  category: z.string(),
  source: z.string().optional(),
});

const growthGapSchema = z.object({
  type: z.string(),
  description: z.string(),
  talkingPoint: z.string(),
  impact: z.enum(["high", "medium", "low"]).optional(),
});

export const enrichmentDataSchema = z.object({
  // Tier 1: Firmographics from web search
  webSearch: z.object({
    status: enrichmentStepStatusSchema,
    employeeCount: z.number().nullable().optional(),
    employeeCountSource: z.string().optional(),
    fundingStage: z.string().nullable().optional(),
    fundingAmount: z.string().nullable().optional(),
    fundingDate: z.string().nullable().optional(),
    fundingSource: z.string().optional(),
    foundedYear: z.number().nullable().optional(),
    hqLocation: z.string().nullable().optional(),
    latestNews: z.array(newsItemSchema).optional(),
  }).optional(),

  // Tier 1: Key people
  keyPeople: z.array(keyPersonSchema).optional(),

  // Tier 1: Infrastructure from DNS/headers
  infrastructure: z.object({
    status: enrichmentStepStatusSchema,
    hostingProvider: z.string().nullable().optional(),
    hostingSource: z.string().optional(),
    cdn: z.string().nullable().optional(),
    emailProvider: z.string().nullable().optional(),
    appHosting: z.string().nullable().optional(),
  }).optional(),

  // Tier 1: Structured sources
  structuredSources: z.object({
    yc: z.object({
      batch: z.string().optional(),
      status: z.string().optional(),
      industries: z.array(z.string()).optional(),
      teamSize: z.number().optional(),
    }).optional(),
    github: z.object({
      publicRepos: z.number().optional(),
      members: z.number().optional(),
      primaryLanguages: z.array(z.string()).optional(),
    }).optional(),
    news: z.array(newsItemSchema).optional(),
  }).optional(),

  // Tier 2/3: Tool detection
  detectedTools: z.array(detectedToolSchema).optional(),

  // Tier 2/3: Growth maturity
  growthMaturity: z.object({
    level: z.enum(["pre-data-driven", "data-aware", "behaviour-informed", "sophisticated"]),
    hasProductAnalytics: z.boolean(),
    hasSessionReplay: z.boolean(),
    hasExperimentation: z.boolean(),
    hasOnboardingTooling: z.boolean(),
  }).optional(),

  // Tier 2/3: Growth gaps
  growthGaps: z.array(growthGapSchema).optional(),

  // Tier 2/3: Pricing analysis
  pricing: z.object({
    status: enrichmentStepStatusSchema,
    pageFound: z.boolean(),
    pageUrl: z.string().optional(),
    tierCount: z.number().optional(),
    hasFreeTier: z.boolean().optional(),
    trialDays: z.number().nullable().optional(),
    ccRequired: z.boolean().optional(),
    hasAnnualToggle: z.boolean().optional(),
    hasEnterpriseTier: z.boolean().optional(),
    pricePoints: z.array(z.string()).optional(),
  }).optional(),

  // Tier 2/3: Signup friction
  signup: z.object({
    status: enrichmentStepStatusSchema,
    pageFound: z.boolean(),
    pageUrl: z.string().optional(),
    formFieldCount: z.number().optional(),
    oauthProviders: z.array(z.string()).optional(),
    hasCaptcha: z.boolean().optional(),
    isMultiStep: z.boolean().optional(),
    frictionLevel: z.enum(["low", "medium", "high"]).optional(),
  }).optional(),

  // Tier 2/3: Social proof
  socialProof: z.object({
    status: enrichmentStepStatusSchema,
    customerLogoCount: z.number().optional(),
    testimonialCount: z.number().optional(),
    caseStudyCount: z.number().optional(),
    reviewPlatforms: z.array(z.string()).optional(),
  }).optional(),

  // Tier 2/3: CTA classification
  cta: z.object({
    status: enrichmentStepStatusSchema,
    type: z.enum(["plg", "sales_led", "hybrid"]).optional(),
    texts: z.array(z.string()).optional(),
  }).optional(),

  // Tier 2/3: Content maturity
  content: z.object({
    status: enrichmentStepStatusSchema,
    blogPostsPerMonth: z.number().nullable().optional(),
    hasActiveChangelog: z.boolean().optional(),
    lastChangelogDate: z.string().nullable().optional(),
    communityChannels: z.array(z.string()).optional(),
    hasReferralProgram: z.boolean().optional(),
  }).optional(),

  // Contact / email finding
  contact: z.object({
    status: enrichmentStepStatusSchema,
    founderEmail: z.string().nullable().optional(),
    emailSource: z.enum(["website_mailto", "pattern_verified", "pattern_unverified"]).optional(),
    emailConfidence: z.enum(["high", "medium", "low"]).optional(),
    smtpVerified: z.boolean().optional(),
    catchAllDomain: z.boolean().optional(),
    companyEmails: z.array(z.string()).optional(),
    candidatesTried: z.array(z.string()).optional(),
    candidatesFailed: z.array(z.string()).optional(),
  }).optional(),

  // LLM-generated BLUF (stored during enrichment, not at render time)
  bluf: z.object({
    category: z.string(),
    text: z.string(),
  }).optional(),

  // LLM-generated personal hook
  personalHook: z.string().optional(),

  // Meta
  meta: z.object({
    enrichedAt: z.string(),
    firecrawlCreditsUsed: z.number().optional(),
    pagesScraped: z.array(z.string()).optional(),
    searchResultsFound: z.boolean().optional(),
    sourcesChecked: z.array(z.string()).optional(),
    totalDurationMs: z.number().optional(),
  }).optional(),
}).partial();

export type EnrichmentData = z.infer<typeof enrichmentDataSchema>;

// ─── Research Job Status ────────────────────────────────────────────────────
// Contract between Python skill (writes) and TypeScript app (reads).
// Cross-referenced with CHECK constraint on research_jobs.status column.

export const RESEARCH_JOB_STATUSES = ["pending", "in_progress", "completed", "failed"] as const;
export const researchJobStatusSchema = z.enum(RESEARCH_JOB_STATUSES);
export type ResearchJobStatus = z.infer<typeof researchJobStatusSchema>;
export const ACTIVE_RESEARCH_JOB_STATUSES = ["pending", "in_progress"] as const;

// `claude` is the legacy database key for the manual/interactive agent lane.
// The UI can label it as Codex (or another manual agent) without a data migration.
export const RESEARCH_EXECUTORS = ["claude", "openrouter"] as const;
export const researchExecutorSchema = z.enum(RESEARCH_EXECUTORS);
export type ResearchExecutor = z.infer<typeof researchExecutorSchema>;

// ─── Research Data Schema ───────────────────────────────────────────────────
// Contract between the manual-agent /research workflow (writes) and TypeScript app (reads).
// Separate from enrichment_data — different writer, different schema, different lifecycle.
// Lenient read schema: every section optional, .catch() on evolving fields.

const publishedContentSchema = z.object({
  title: z.string(),
  url: z.string().optional(),
  platform: z.string().optional(),
  date: z.string().optional(),
  summary: z.string().optional(),
});

const talkAppearanceSchema = z.object({
  title: z.string(),
  url: z.string().optional(),
  event: z.string().optional(),
  date: z.string().optional(),
  summary: z.string().optional(),
});

const sourcedTextSchema = z.object({
  text: z.string(),
  source: z.string().optional(),
  sourceUrl: z.string().optional(),
});

const companyIntelSchema = z.object({
  productMarket: z.object({
    whatTheyDo: z.string().optional(),
    coreProductService: z.string().optional(),
    targetCustomer: z.string().optional(),
    businessModel: z.string().optional(),
    pricingModel: z.string().optional(),
    keyDifferentiator: z.string().optional(),
  }).optional(),
  stageTraction: z.object({
    fundingStageAmount: z.string().optional(),
    keyInvestors: z.array(z.string()).optional(),
    estimatedTeamSize: z.string().optional(),
    founded: z.string().optional(),
    revenueSignals: z.array(sourcedTextSchema).optional(),
    growthSignals: z.array(sourcedTextSchema).optional(),
  }).optional(),
  techStack: z.object({
    frontend: z.array(z.string()).optional(),
    backend: z.array(z.string()).optional(),
    infrastructure: z.array(z.string()).optional(),
    notableToolsIntegrations: z.array(z.string()).optional(),
    sources: z.array(sourcedTextSchema).optional(),
  }).optional(),
  onlinePresence: z.object({
    websiteUrl: z.string().optional(),
    trafficEstimate: z.string().optional(),
    blogContentStrategy: z.string().optional(),
    seoPresence: z.string().optional(),
  }).optional(),
}).optional();

const prospectIntelSchema = z.object({
  background: z.object({
    name: z.string().optional(),
    role: z.string().optional(),
    careerHistory: z.array(z.string()).optional(),
    education: z.array(z.string()).optional(),
    previousCompaniesExits: z.array(z.string()).optional(),
    backgroundType: z.string().optional(),
  }).optional(),
  contentThoughtLeadership: z.object({
    linkedinPosting: z.string().optional(),
    blogNewsletter: z.string().optional(),
    podcastAppearances: z.array(publishedContentSchema).optional(),
    conferenceTalks: z.array(talkAppearanceSchema).optional(),
    twitterPresence: z.string().optional(),
    keyOpinions: z.array(z.string()).optional(),
  }).optional(),
  personalitySignals: z.object({
    interestsOutsideWork: z.array(z.string()).optional(),
    communicationStyle: z.string().optional(),
    values: z.array(z.string()).optional(),
  }).optional(),
}).optional();

const painPointHypothesisSchema = z.object({
  painPoint: z.string(),
  evidenceOrSignal: z.string().optional(),
  relevantCapability: z.string().optional(),
});

const personalizationHookSchema = z.object({
  hook: z.string(),
  source: z.string().optional(),
  sourceUrl: z.string().optional(),
});

export const researchDataSchema = z.object({
  version: z.literal(1),
  researchedAt: z.string().optional(),
  summary: z.string().optional(),
  companyIntel: companyIntelSchema,
  prospectIntel: prospectIntelSchema,
  painPointHypotheses: z.array(painPointHypothesisSchema).optional(),
  personalizationHooks: z.array(personalizationHookSchema).optional(),

  meta: z.object({
    totalSearches: z.number().optional(),
    totalDurationMs: z.number().optional(),
    phasesCompleted: z.array(z.string()).optional(),
    phasesFailed: z.array(z.string()).optional(),
  }).optional(),
}).partial();

export type ResearchData = z.infer<typeof researchDataSchema>;

// ─── Research Input Schemas ─────────────────────────────────────────────────

export const researchRequestInputSchema = z.object({
  domain: domainSchema,
});
export type ResearchRequestInput = z.infer<typeof researchRequestInputSchema>;

export const researchEnqueueInputSchema = researchRequestInputSchema.extend({
  executor: researchExecutorSchema,
});
export type ResearchEnqueueInput = z.infer<typeof researchEnqueueInputSchema>;
