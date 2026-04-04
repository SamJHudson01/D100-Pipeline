import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import {
  researchDataSchema,
  type EnrichmentData,
  type ResearchData,
} from "../domain.ts";

const DEFAULT_MAX_RESULTS = 5;
const DEFAULT_MAX_COMPLETION_TOKENS = 3000;
const DEFAULT_TEMPERATURE = 0.2;
const DEFAULT_OPENROUTER_MODEL = "google/gemini-3-flash-preview";

const openRouterConfigSchema = z.object({
  OPENROUTER_API_KEY: z.string().min(1),
  OPENROUTER_MODEL: z.string().min(1).optional(),
  OPENROUTER_WEB_ENGINE: z.enum(["native", "exa"]).optional(),
  OPENROUTER_WEB_MAX_RESULTS: z.coerce.number().int().min(1).max(10).optional(),
  OPENROUTER_WEB_SEARCH_CONTEXT_SIZE: z.enum(["low", "medium", "high"]).optional(),
  OPENROUTER_MAX_COMPLETION_TOKENS: z.coerce.number().int().min(256).optional(),
  OPENROUTER_SITE_URL: z.string().url().optional(),
  OPENROUTER_SITE_NAME: z.string().min(1).max(100).optional(),
});

const openRouterResearchWriteSchema = researchDataSchema.extend({
  version: z.literal(1),
  researchedAt: z.string(),
  meta: z
    .object({
      totalSearches: z.number().int().min(0),
      totalDurationMs: z.number().int().min(0),
      phasesCompleted: z.array(z.string()),
      phasesFailed: z.array(z.string()),
    })
    .optional(),
});

type OpenRouterConfig = {
  apiKey: string;
  model: string;
  webEngine?: "native" | "exa";
  webMaxResults: number;
  webSearchContextSize?: "low" | "medium" | "high";
  maxCompletionTokens: number;
  siteUrl?: string;
  siteName?: string;
};

export type OpenRouterChatResponse = {
  model?: string;
  choices?: Array<{
    message?: {
      content?: string | Array<{ type?: string; text?: string }>;
      annotations?: Array<{
        type?: string;
        url_citation?: {
          url?: string;
          title?: string;
        };
      }>;
      tool_calls?: Array<unknown>;
    };
    finish_reason?: string;
  }>;
  error?: {
    message?: string;
  };
  usage?: {
    total_tokens?: number;
    prompt_tokens?: number;
    completion_tokens?: number;
  };
};

type OpenRouterResearchInput = {
  companyName: string;
  domain: string;
  websiteUrl: string | null;
  enrichmentData: EnrichmentData;
};

export type OpenRouterResearchProgressEvent = {
  stage:
    | "loading_methodology"
    | "building_request"
    | "calling_openrouter"
    | "received_response"
    | "parsing_response"
    | "validating_output";
  message: string;
  details?: Record<string, unknown>;
};

type OpenRouterResearchOptions = {
  onProgress?: (
    event: OpenRouterResearchProgressEvent,
  ) => void | Promise<void>;
  correlationId?: string;
};

export class OpenRouterConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OpenRouterConfigurationError";
  }
}

export class OpenRouterRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OpenRouterRequestError";
  }
}

let methodologyPromise: Promise<string> | null = null;

function getMethodologyPath(): string {
  return path.resolve(process.cwd(), "prompts", "research-methodology.md");
}

async function loadMethodology(): Promise<string> {
  methodologyPromise ??= fs.readFile(getMethodologyPath(), "utf8").catch((err) => {
    methodologyPromise = null;
    throw err;
  });
  return methodologyPromise;
}

export function loadOpenRouterConfig(env: NodeJS.ProcessEnv = process.env): OpenRouterConfig {
  const parsed = openRouterConfigSchema.safeParse(env);
  if (!parsed.success) {
    throw new OpenRouterConfigurationError(
      `Invalid OpenRouter configuration: ${parsed.error.issues
        .map((issue) => issue.path.join("."))
        .join(", ")}`,
    );
  }

  return {
    apiKey: parsed.data.OPENROUTER_API_KEY,
    model: parsed.data.OPENROUTER_MODEL ?? DEFAULT_OPENROUTER_MODEL,
    webEngine: parsed.data.OPENROUTER_WEB_ENGINE,
    webMaxResults: parsed.data.OPENROUTER_WEB_MAX_RESULTS ?? DEFAULT_MAX_RESULTS,
    webSearchContextSize: parsed.data.OPENROUTER_WEB_SEARCH_CONTEXT_SIZE,
    maxCompletionTokens:
      parsed.data.OPENROUTER_MAX_COMPLETION_TOKENS ??
      DEFAULT_MAX_COMPLETION_TOKENS,
    siteUrl: parsed.data.OPENROUTER_SITE_URL,
    siteName: parsed.data.OPENROUTER_SITE_NAME,
  };
}

function buildOpenRouterPrompt(
  methodology: string,
  input: OpenRouterResearchInput,
): string {
  return [
    `Current date: ${new Date().toISOString().slice(0, 10)}`,
    "",
    "Follow the methodology below exactly. Return only one JSON object with no markdown fences.",
    "",
    methodology,
    "",
    "Company context:",
    JSON.stringify(
      {
        companyName: input.companyName,
        domain: input.domain,
        websiteUrl: input.websiteUrl,
        enrichmentData: input.enrichmentData,
      },
      null,
      2,
    ),
    "",
    "Output rules:",
    "- Produce JSON compatible with researchDataSchema.",
    "- Set version to 1.",
    "- Include researchedAt as an ISO-8601 timestamp.",
    "- Keep URL fields as direct source URLs when available.",
    "- Do not include markdown, prose wrappers, or raw search transcripts.",
    "- If a phase fails, keep going and record the phase name in meta.phasesFailed.",
  ].join("\n");
}

export function parseMessageContent(content: OpenRouterChatResponse["choices"]): unknown {
  const value = content?.[0]?.message?.content;

  if (typeof value === "string") {
    const trimmed = value
      .trim()
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/\s*```$/, "");
    if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) {
      throw new OpenRouterRequestError(
        "Model returned non-JSON response — response_format may be unsupported by this model"
      );
    }
    return JSON.parse(trimmed);
  }

  if (Array.isArray(value)) {
    const text = value
      .map((part) => (typeof part.text === "string" ? part.text : ""))
      .join("")
      .trim();
    if (!text.startsWith("{") && !text.startsWith("[")) {
      throw new OpenRouterRequestError(
        "Model returned non-JSON response — response_format may be unsupported by this model"
      );
    }
    return JSON.parse(text);
  }

  throw new OpenRouterRequestError("OpenRouter returned an empty response");
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function pickString(
  source: Record<string, unknown>,
  keys: string[],
): string | undefined {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }

  return undefined;
}

export function pickRecord(
  source: Record<string, unknown>,
  keys: string[],
): Record<string, unknown> | undefined {
  for (const key of keys) {
    const value = source[key];
    if (isRecord(value)) {
      return value;
    }
  }

  return undefined;
}

export function normalizeStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const normalized = value.filter(
    (entry): entry is string => typeof entry === "string" && entry.trim().length > 0,
  );

  return normalized.length > 0 ? normalized : undefined;
}

export function normalizeSourcedTextArray(value: unknown): Array<Record<string, unknown>> | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const normalized: Array<Record<string, unknown>> = [];
  for (const entry of value) {
    if (typeof entry === "string" && entry.trim().length > 0) {
      normalized.push({ text: entry.trim() });
      continue;
    }

    if (!isRecord(entry)) {
      continue;
    }

    const text = pickString(entry, ["text", "signal", "item", "title", "label"]);
    if (!text) {
      continue;
    }

    normalized.push({
      text,
      ...(pickString(entry, ["source", "platform"]) ? { source: pickString(entry, ["source", "platform"]) } : {}),
      ...(pickString(entry, ["sourceUrl", "url"]) ? { sourceUrl: pickString(entry, ["sourceUrl", "url"]) } : {}),
    });
  }

  return normalized.length > 0 ? normalized : undefined;
}

export function normalizeReferenceArray(
  value: unknown,
  metaKey: "platform" | "event",
): Array<Record<string, unknown>> | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const normalized: Array<Record<string, unknown>> = [];
  for (const entry of value) {
    if (typeof entry === "string" && entry.trim().length > 0) {
      normalized.push({ title: entry.trim() });
      continue;
    }

    if (!isRecord(entry)) {
      continue;
    }

    const title = pickString(entry, ["title", "name"]);
    if (!title) {
      continue;
    }

    normalized.push({
      title,
      ...(pickString(entry, ["url", "sourceUrl"]) ? { url: pickString(entry, ["url", "sourceUrl"]) } : {}),
      ...(pickString(entry, [metaKey]) ? { [metaKey]: pickString(entry, [metaKey]) } : {}),
      ...(pickString(entry, ["date"]) ? { date: pickString(entry, ["date"]) } : {}),
      ...(pickString(entry, ["summary", "description"]) ? { summary: pickString(entry, ["summary", "description"]) } : {}),
    });
  }

  return normalized.length > 0 ? normalized : undefined;
}

export function normalizePainPointHypotheses(
  value: unknown,
): Array<Record<string, unknown>> | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const normalized: Array<Record<string, unknown>> = [];
  for (const entry of value) {
    if (typeof entry === "string" && entry.trim().length > 0) {
      normalized.push({ painPoint: entry.trim() });
      continue;
    }

    if (!isRecord(entry)) {
      continue;
    }

    const painPoint = pickString(entry, ["painPoint", "title", "problem"]);
    if (!painPoint) {
      continue;
    }

    normalized.push({
      painPoint,
      ...(pickString(entry, ["evidenceOrSignal", "evidence", "signal"]) ? {
        evidenceOrSignal: pickString(entry, ["evidenceOrSignal", "evidence", "signal"]),
      } : {}),
      ...(pickString(entry, ["relevantCapability", "capability", "whyRelevant"]) ? {
        relevantCapability: pickString(entry, ["relevantCapability", "capability", "whyRelevant"]),
      } : {}),
    });
  }

  return normalized.length > 0 ? normalized : undefined;
}

export function normalizePersonalizationHooks(
  value: unknown,
): Array<Record<string, unknown>> | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const normalized: Array<Record<string, unknown>> = [];
  for (const entry of value) {
    if (typeof entry === "string" && entry.trim().length > 0) {
      normalized.push({ hook: entry.trim() });
      continue;
    }

    if (!isRecord(entry)) {
      continue;
    }

    const hook = pickString(entry, ["hook", "text", "title"]);
    if (!hook) {
      continue;
    }

    normalized.push({
      hook,
      ...(pickString(entry, ["source", "platform"]) ? { source: pickString(entry, ["source", "platform"]) } : {}),
      ...(pickString(entry, ["sourceUrl", "url"]) ? { sourceUrl: pickString(entry, ["sourceUrl", "url"]) } : {}),
    });
  }

  return normalized.length > 0 ? normalized : undefined;
}

export function getOpenRouterAnnotationUrls(
  response: OpenRouterChatResponse,
): string[] {
  const annotations = response.choices?.[0]?.message?.annotations;
  if (!Array.isArray(annotations)) {
    return [];
  }

  return annotations
    .map((annotation) => annotation.url_citation?.url)
    .filter((url): url is string => typeof url === "string" && url.length > 0);
}

export function getOpenRouterToolCallCount(response: OpenRouterChatResponse): number {
  const toolCalls = response.choices?.[0]?.message?.tool_calls;
  return Array.isArray(toolCalls) ? toolCalls.length : 0;
}

export function normalizeResearchData(
  raw: unknown,
  durationMs: number,
): ResearchData {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new OpenRouterRequestError("OpenRouter returned a non-object JSON payload");
  }

  const rawRecord = raw as Record<string, unknown>;
  const companyIntelInput =
    pickRecord(rawRecord, ["companyIntel", "company_intel", "company"]) ?? undefined;
  const productMarketInput = companyIntelInput
    ? pickRecord(companyIntelInput, ["productMarket", "productAndMarket", "product_market"]) ?? companyIntelInput
    : undefined;
  const stageTractionInput = companyIntelInput
    ? pickRecord(companyIntelInput, ["stageTraction", "stageAndTraction", "stage_traction"])
    : undefined;
  const techStackInput = companyIntelInput
    ? pickRecord(companyIntelInput, ["techStack", "stack", "tech_stack"])
    : undefined;
  const onlinePresenceInput = companyIntelInput
    ? pickRecord(companyIntelInput, ["onlinePresence", "online_presence"])
    : undefined;

  const companyIntel = companyIntelInput
    ? {
        ...(productMarketInput ? {
          productMarket: {
            ...(pickString(productMarketInput, ["whatTheyDo", "oneLine", "description"]) ? {
              whatTheyDo: pickString(productMarketInput, ["whatTheyDo", "oneLine", "description"]),
            } : {}),
            ...(pickString(productMarketInput, ["coreProductService", "coreProduct", "coreService"]) ? {
              coreProductService: pickString(productMarketInput, ["coreProductService", "coreProduct", "coreService"]),
            } : {}),
            ...(pickString(productMarketInput, ["targetCustomer", "targetCustomerICP", "targetCustomerOrICP", "icp"]) ? {
              targetCustomer: pickString(productMarketInput, ["targetCustomer", "targetCustomerICP", "targetCustomerOrICP", "icp"]),
            } : {}),
            ...(pickString(productMarketInput, ["businessModel"]) ? {
              businessModel: pickString(productMarketInput, ["businessModel"]),
            } : {}),
            ...(pickString(productMarketInput, ["pricingModel"]) ? {
              pricingModel: pickString(productMarketInput, ["pricingModel"]),
            } : {}),
            ...(pickString(productMarketInput, ["keyDifferentiator", "keyDifferentiatorMoat", "moat"]) ? {
              keyDifferentiator: pickString(productMarketInput, ["keyDifferentiator", "keyDifferentiatorMoat", "moat"]),
            } : {}),
          },
        } : {}),
        ...(stageTractionInput ? {
          stageTraction: {
            ...(pickString(stageTractionInput, ["fundingStageAmount", "funding", "fundingStageAndAmount"]) ? {
              fundingStageAmount: pickString(stageTractionInput, ["fundingStageAmount", "funding", "fundingStageAndAmount"]),
            } : {}),
            ...(normalizeStringArray(stageTractionInput.keyInvestors) ? {
              keyInvestors: normalizeStringArray(stageTractionInput.keyInvestors),
            } : {}),
            ...(pickString(stageTractionInput, ["estimatedTeamSize", "teamSize"]) ? {
              estimatedTeamSize: pickString(stageTractionInput, ["estimatedTeamSize", "teamSize"]),
            } : {}),
            ...(pickString(stageTractionInput, ["founded"]) ? {
              founded: pickString(stageTractionInput, ["founded"]),
            } : {}),
            ...(normalizeSourcedTextArray(stageTractionInput.revenueSignals) ? {
              revenueSignals: normalizeSourcedTextArray(stageTractionInput.revenueSignals),
            } : {}),
            ...(normalizeSourcedTextArray(stageTractionInput.growthSignals) ? {
              growthSignals: normalizeSourcedTextArray(stageTractionInput.growthSignals),
            } : {}),
          },
        } : {}),
        ...(techStackInput ? {
          techStack: {
            ...(normalizeStringArray(techStackInput.frontend) ? {
              frontend: normalizeStringArray(techStackInput.frontend),
            } : {}),
            ...(normalizeStringArray(techStackInput.backend) ? {
              backend: normalizeStringArray(techStackInput.backend),
            } : {}),
            ...(normalizeStringArray(techStackInput.infrastructure) ? {
              infrastructure: normalizeStringArray(techStackInput.infrastructure),
            } : {}),
            ...(normalizeStringArray(techStackInput.notableToolsIntegrations ?? techStackInput.notableTools) ? {
              notableToolsIntegrations: normalizeStringArray(
                techStackInput.notableToolsIntegrations ?? techStackInput.notableTools,
              ),
            } : {}),
            ...(normalizeSourcedTextArray(techStackInput.sources) ? {
              sources: normalizeSourcedTextArray(techStackInput.sources),
            } : {}),
          },
        } : {}),
        ...(onlinePresenceInput ? {
          onlinePresence: {
            ...(pickString(onlinePresenceInput, ["websiteUrl", "website"]) ? {
              websiteUrl: pickString(onlinePresenceInput, ["websiteUrl", "website"]),
            } : {}),
            ...(pickString(onlinePresenceInput, ["trafficEstimate", "traffic"]) ? {
              trafficEstimate: pickString(onlinePresenceInput, ["trafficEstimate", "traffic"]),
            } : {}),
            ...(pickString(onlinePresenceInput, ["blogContentStrategy", "blogStrategy", "contentStrategy"]) ? {
              blogContentStrategy: pickString(onlinePresenceInput, ["blogContentStrategy", "blogStrategy", "contentStrategy"]),
            } : {}),
            ...(pickString(onlinePresenceInput, ["seoPresence", "seo"]) ? {
              seoPresence: pickString(onlinePresenceInput, ["seoPresence", "seo"]),
            } : {}),
          },
        } : {}),
      }
    : undefined;

  const prospectIntelInput =
    pickRecord(rawRecord, ["prospectIntel", "prospectPersonalIntel", "prospect"]) ?? undefined;
  const backgroundInput = prospectIntelInput
    ? pickRecord(prospectIntelInput, ["background"]) ?? prospectIntelInput
    : undefined;
  const contentInput = prospectIntelInput
    ? pickRecord(prospectIntelInput, [
        "contentThoughtLeadership",
        "contentAndThoughtLeadership",
        "thoughtLeadership",
      ])
    : undefined;
  const personalityInput = prospectIntelInput
    ? pickRecord(prospectIntelInput, [
        "personalitySignals",
        "interestsPersonalitySignals",
        "interestsAndPersonalitySignals",
      ])
    : undefined;

  const prospectIntel = prospectIntelInput
    ? {
        ...(backgroundInput ? {
          background: {
            ...(pickString(backgroundInput, ["name"]) ? { name: pickString(backgroundInput, ["name"]) } : {}),
            ...(pickString(backgroundInput, ["role", "title"]) ? { role: pickString(backgroundInput, ["role", "title"]) } : {}),
            ...(normalizeStringArray(backgroundInput.careerHistory) ? {
              careerHistory: normalizeStringArray(backgroundInput.careerHistory),
            } : {}),
            ...(normalizeStringArray(backgroundInput.education) ? {
              education: normalizeStringArray(backgroundInput.education),
            } : {}),
            ...(normalizeStringArray(backgroundInput.previousCompaniesExits ?? backgroundInput.previousCompanies) ? {
              previousCompaniesExits: normalizeStringArray(
                backgroundInput.previousCompaniesExits ?? backgroundInput.previousCompanies,
              ),
            } : {}),
            ...(pickString(backgroundInput, ["backgroundType", "technicalVsCommercialBackground"]) ? {
              backgroundType: pickString(backgroundInput, ["backgroundType", "technicalVsCommercialBackground"]),
            } : {}),
          },
        } : {}),
        ...(contentInput ? {
          contentThoughtLeadership: {
            ...(pickString(contentInput, ["linkedinPosting", "linkedinPostingFrequencyTopics"]) ? {
              linkedinPosting: pickString(contentInput, ["linkedinPosting", "linkedinPostingFrequencyTopics"]),
            } : {}),
            ...(pickString(contentInput, ["blogNewsletter", "blogSubstackNewsletter"]) ? {
              blogNewsletter: pickString(contentInput, ["blogNewsletter", "blogSubstackNewsletter"]),
            } : {}),
            ...(normalizeReferenceArray(contentInput.podcastAppearances, "platform") ? {
              podcastAppearances: normalizeReferenceArray(contentInput.podcastAppearances, "platform"),
            } : {}),
            ...(normalizeReferenceArray(contentInput.conferenceTalks, "event") ? {
              conferenceTalks: normalizeReferenceArray(contentInput.conferenceTalks, "event"),
            } : {}),
            ...(pickString(contentInput, ["twitterPresence", "twitterXPresenceTone"]) ? {
              twitterPresence: pickString(contentInput, ["twitterPresence", "twitterXPresenceTone"]),
            } : {}),
            ...(normalizeStringArray(contentInput.keyOpinions ?? contentInput.keyOpinionsPositions) ? {
              keyOpinions: normalizeStringArray(contentInput.keyOpinions ?? contentInput.keyOpinionsPositions),
            } : {}),
          },
        } : {}),
        ...(personalityInput ? {
          personalitySignals: {
            ...(normalizeStringArray(personalityInput.interestsOutsideWork ?? personalityInput.interests) ? {
              interestsOutsideWork: normalizeStringArray(
                personalityInput.interestsOutsideWork ?? personalityInput.interests,
              ),
            } : {}),
            ...(pickString(personalityInput, ["communicationStyle"]) ? {
              communicationStyle: pickString(personalityInput, ["communicationStyle"]),
            } : {}),
            ...(normalizeStringArray(personalityInput.values) ? {
              values: normalizeStringArray(personalityInput.values),
            } : {}),
          },
        } : {}),
      }
    : undefined;

  const painPointHypotheses = normalizePainPointHypotheses(
    rawRecord.painPointHypotheses ?? rawRecord.painPoints,
  );
  const personalizationHooks = normalizePersonalizationHooks(
    rawRecord.personalizationHooks ?? rawRecord.hooks,
  );

  const candidate = {
    ...rawRecord,
    ...(companyIntel ? { companyIntel } : {}),
    ...(prospectIntel ? { prospectIntel } : {}),
    ...(painPointHypotheses ? { painPointHypotheses } : {}),
    ...(personalizationHooks ? { personalizationHooks } : {}),
    version: 1,
    researchedAt:
      typeof (raw as { researchedAt?: unknown }).researchedAt === "string"
        ? (raw as { researchedAt: string }).researchedAt
        : new Date().toISOString(),
    meta: {
      totalSearches:
        typeof (raw as { meta?: { totalSearches?: unknown } }).meta
          ?.totalSearches === "number"
          ? (raw as { meta: { totalSearches: number } }).meta.totalSearches
          : 0,
      totalDurationMs: durationMs,
      phasesCompleted: Array.isArray(
        (raw as { meta?: { phasesCompleted?: unknown[] } }).meta?.phasesCompleted,
      )
        ? ((raw as { meta: { phasesCompleted: string[] } }).meta.phasesCompleted)
        : [],
      phasesFailed: Array.isArray(
        (raw as { meta?: { phasesFailed?: unknown[] } }).meta?.phasesFailed,
      )
        ? ((raw as { meta: { phasesFailed: string[] } }).meta.phasesFailed)
        : [],
    },
  };

  const parsed = openRouterResearchWriteSchema.safeParse(candidate);
  if (!parsed.success) {
    throw new OpenRouterRequestError(
      `OpenRouter output failed schema validation: ${parsed.error.issues
        .map((issue) => issue.path.join("."))
        .join(", ")}`,
    );
  }

  // Quality gate: write path must have minimum content (EC-6)
  const data = parsed.data;
  if (!data.summary || data.summary.trim().length === 0) {
    throw new OpenRouterRequestError("Research dossier has no summary — model returned empty content");
  }
  if (!data.companyIntel && !data.prospectIntel) {
    throw new OpenRouterRequestError("Research dossier has no company or prospect intel — model returned empty content");
  }

  return data;
}

export function toSafeOpenRouterJobError(error: unknown): string {
  if (error instanceof OpenRouterConfigurationError) {
    return "OpenRouter worker is misconfigured. Check worker environment and retry.";
  }

  if (error instanceof OpenRouterRequestError) {
    return error.message;
  }

  if (error instanceof SyntaxError) {
    return "OpenRouter returned invalid JSON. Check worker logs and retry.";
  }

  if (error instanceof Error) {
    return error.message.slice(0, 500);
  }

  return "OpenRouter research failed. Check worker logs and retry.";
}

async function emitProgress(
  onProgress: OpenRouterResearchOptions["onProgress"],
  event: OpenRouterResearchProgressEvent,
): Promise<void> {
  if (!onProgress) {
    return;
  }

  await onProgress(event);
}

export async function runOpenRouterResearch(
  input: OpenRouterResearchInput,
  options: OpenRouterResearchOptions = {},
): Promise<ResearchData> {
  const config = loadOpenRouterConfig();
  await emitProgress(options.onProgress, {
    stage: "loading_methodology",
    message: "Loading shared research methodology",
  });
  const methodology = await loadMethodology();
  const startedAt = Date.now();

  const webPlugin: Record<string, unknown> = {
    id: "web",
    max_results: config.webMaxResults,
  };
  if (config.webEngine) {
    webPlugin.engine = config.webEngine;
  }

  await emitProgress(options.onProgress, {
    stage: "building_request",
    message: `Preparing OpenRouter request with model ${config.model}`,
    details: {
      model: config.model,
      webMaxResults: config.webMaxResults,
      webSearchContextSize: config.webSearchContextSize ?? null,
    },
  });

  const body = {
    model: config.model,
    messages: [
      {
        role: "system",
        content:
          "You are an OpenRouter deep research executor. Follow the provided methodology exactly and return only JSON.",
      },
      {
        role: "user",
        content: buildOpenRouterPrompt(methodology, input),
      },
    ],
    plugins: [webPlugin, { id: "response-healing" }],
    response_format: { type: "json_object" as const },
    temperature: DEFAULT_TEMPERATURE,
    max_completion_tokens: config.maxCompletionTokens,
    ...(config.webSearchContextSize
      ? {
          web_search_options: {
            search_context_size: config.webSearchContextSize,
          },
        }
      : {}),
  };

  const headers: Record<string, string> = {
    Authorization: `Bearer ${config.apiKey}`,
    "Content-Type": "application/json",
  };

  if (config.siteUrl) {
    headers["HTTP-Referer"] = config.siteUrl;
  }
  if (config.siteName) {
    headers["X-OpenRouter-Title"] = config.siteName;
  }

  await emitProgress(options.onProgress, {
    stage: "calling_openrouter",
    message: "Waiting for OpenRouter response",
  });
  const fetchController = new AbortController();
  const fetchTimeout = setTimeout(() => fetchController.abort(), 180_000);
  let response: Response;
  try {
    response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: fetchController.signal,
    });
  } catch (err) {
    clearTimeout(fetchTimeout);
    if (err instanceof Error && err.name === "AbortError") {
      throw new OpenRouterRequestError("OpenRouter request timed out after 180 seconds");
    }
    throw err;
  } finally {
    clearTimeout(fetchTimeout);
  }

  if (!response.ok) {
    const errorText = await response.text();
    throw new OpenRouterRequestError(
      `OpenRouter request failed (${response.status}): ${errorText.slice(0, 300)}`,
    );
  }

  const json = (await response.json()) as OpenRouterChatResponse;

  // Check for 200-with-error (rate limits, content filter, upstream failures)
  if (json.error) {
    console.error(JSON.stringify({ event: "openrouter_api_error", error: json.error.message, correlationId: options.correlationId ?? null }));
    throw new OpenRouterRequestError("Research request failed — model returned an error");
  }

  const latencyMs = Date.now() - startedAt;
  const annotationUrls = getOpenRouterAnnotationUrls(json);
  const toolCallCount = getOpenRouterToolCallCount(json);

  const cid = options.correlationId ?? null;

  // Structured log: response metadata (no PII, no prompt/response content)
  console.log(JSON.stringify({
    event: "openrouter_response",
    correlationId: cid,
    model: json.model ?? config.model,
    promptTokens: json.usage?.prompt_tokens ?? null,
    completionTokens: json.usage?.completion_tokens ?? null,
    totalTokens: json.usage?.total_tokens ?? null,
    finishReason: json.choices?.[0]?.finish_reason ?? null,
    latencyMs,
    httpStatus: response.status,
    annotationCount: annotationUrls.length,
    toolCallCount,
  }));

  await emitProgress(options.onProgress, {
    stage: "received_response",
    message: "Received OpenRouter response",
    details: {
      responseModel: json.model ?? config.model,
      totalTokens: json.usage?.total_tokens ?? null,
      annotationCount: annotationUrls.length,
      toolCallCount,
      annotationUrls: annotationUrls.slice(0, 5),
    },
  });
  await emitProgress(options.onProgress, {
    stage: "parsing_response",
    message: "Parsing structured JSON response",
  });

  let parsed: unknown;
  try {
    parsed = parseMessageContent(json.choices);
  } catch (parseError) {
    console.log(JSON.stringify({
      event: "openrouter_parse_failed",
      correlationId: cid,
      model: json.model ?? config.model,
      finishReason: json.choices?.[0]?.finish_reason ?? null,
      latencyMs,
    }));
    throw parseError;
  }

  await emitProgress(options.onProgress, {
    stage: "validating_output",
    message: "Validating research payload before save",
  });

  let result: ResearchData;
  try {
    result = normalizeResearchData(parsed, latencyMs);
  } catch (validationError) {
    console.log(JSON.stringify({
      event: "openrouter_validation_failed",
      correlationId: cid,
      model: json.model ?? config.model,
      latencyMs,
    }));
    throw validationError;
  }

  console.log(JSON.stringify({
    event: "openrouter_success",
    correlationId: cid,
    model: json.model ?? config.model,
    latencyMs,
  }));

  return result;
}
