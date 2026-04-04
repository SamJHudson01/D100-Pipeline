/**
 * Research router — job queue management and research data retrieval.
 *
 * Peer router alongside company, dream100, triage, etc.
 * The web UI creates pending jobs; the manual-agent /research workflow processes them.
 * research_data is written by Python (psycopg2), read by TypeScript (Prisma).
 */

import { TRPCError } from "@trpc/server";
import { publicProcedure, router } from "../init";
import {
  researchRequestInputSchema,
  researchDataSchema,
  computeEffectiveScore,
  type ResearchData,
} from "@/lib/domain";
import {
  enqueueResearchJob,
  getResearchPageSnapshot,
  getResearchRouteState,
  getResearchSummaryCard,
  ResearchCompanyNotFoundError,
} from "@/lib/research/service";
import type { ResearchExecutor } from "@/lib/domain";

function logResearchRequestEvent(
  event: string,
  details: Record<string, unknown>,
): void {
  console.log(
    JSON.stringify({
      scope: "research-request",
      event,
      timestamp: new Date().toISOString(),
      ...details,
    }),
  );
}

async function enqueueAndLogResearchJob(
  domain: string,
  executor: ResearchExecutor,
) {
  logResearchRequestEvent("enqueue_requested", {
    domain,
    executor,
  });

  const result = await enqueueResearchJob(domain, executor);

  logResearchRequestEvent("enqueue_result", {
    domain,
    requestedExecutor: executor,
    jobId: result.jobId,
    activeExecutor: result.executor,
    status: result.status,
    created: result.created,
  });

  return result;
}

export const researchRouter = router({
  /**
   * Request research for a company. Inserts a pending job (idempotent).
   * Uses publicProcedure (cheap INSERT, no rate limit needed).
   * Idempotency: upsert where create inserts pending, update is a no-op
   * unless existing job is in a terminal state.
   */
  request: publicProcedure
    .input(researchRequestInputSchema)
    .mutation(async ({ input }) => {
      try {
        return await enqueueAndLogResearchJob(input.domain, "claude");
      } catch (error) {
        if (error instanceof ResearchCompanyNotFoundError) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Company not found" });
        }

        throw error;
      }
    }),

  requestOpenRouter: publicProcedure
    .input(researchRequestInputSchema)
    .mutation(async ({ input }) => {
      try {
        return await enqueueAndLogResearchJob(input.domain, "openrouter");
      } catch (error) {
        if (error instanceof ResearchCompanyNotFoundError) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Company not found" });
        }

        throw error;
      }
    }),

  /**
   * Get research job status for a domain.
   */
  status: publicProcedure
    .input(researchRequestInputSchema)
    .query(async ({ input }) => {
      try {
        return await getResearchRouteState(input.domain);
      } catch (error) {
        if (error instanceof ResearchCompanyNotFoundError) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Company not found" });
        }

        throw error;
      }
    }),

  summary: publicProcedure
    .input(researchRequestInputSchema)
    .query(async ({ input }) => {
      return getResearchSummaryCard(input.domain);
    }),

  /**
   * Get full parsed research data for the /research/{domain} page.
   * Uses safeParse on the JSONB (lenient read schema per conventions).
   */
  full: publicProcedure
    .input(researchRequestInputSchema)
    .query(async ({ input }) => {
      let snapshot;
      try {
        snapshot = await getResearchPageSnapshot(input.domain);
      } catch (error) {
        if (error instanceof ResearchCompanyNotFoundError) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Company not found" });
        }

        throw error;
      }
      const { company, researchState } = snapshot;

      // Parse research_data through Zod (lenient — safeParse)
      let research: ResearchData | null = null;
      if (company.researchData && typeof company.researchData === "object") {
        const parsed = researchDataSchema.safeParse(company.researchData);
        research = parsed.success ? parsed.data : (company.researchData as ResearchData);
        // Sanitize URLs — reject non-https protocols (Hunt: Principle 1)
        if (research) {
          sanitizeResearchUrls(research);
        }
      }

      // Compute effective score (shared with company.detail)
      const effectiveScore = computeEffectiveScore(company.score, company.originalScore, company.scoredAt);

      return {
        domain: company.domain,
        name: company.name,
        url: company.url,
        effectiveScore,
        researchData: research,
        researchState,
        jobStatus: researchState.latestJob?.status ?? null,
        jobExecutor: researchState.latestJob?.executor ?? null,
        jobError: researchState.latestJob?.error ?? null,
      };
    }),
});

/**
 * Sanitize all URLs in research_data — reject non-https protocols.
 * Prevents javascript:, data:, and other protocol injection from
 * web-scraped content rendered as clickable links. (Hunt: Principle 1)
 */
export function sanitizeResearchUrls(data: ResearchData): void {
  function isSafeUrl(url: string): boolean {
    try {
      return new URL(url).protocol === "https:";
    } catch {
      return false;
    }
  }

  function cleanUrl(url: string | undefined): string | undefined {
    if (!url) return url;
    return isSafeUrl(url) ? url : undefined;
  }

  if (data.companyIntel?.onlinePresence) {
    data.companyIntel.onlinePresence.websiteUrl = cleanUrl(
      data.companyIntel.onlinePresence.websiteUrl,
    );
  }

  data.companyIntel?.stageTraction?.revenueSignals?.forEach((item) => {
    item.sourceUrl = cleanUrl(item.sourceUrl);
  });
  data.companyIntel?.stageTraction?.growthSignals?.forEach((item) => {
    item.sourceUrl = cleanUrl(item.sourceUrl);
  });
  data.companyIntel?.techStack?.sources?.forEach((item) => {
    item.sourceUrl = cleanUrl(item.sourceUrl);
  });

  data.prospectIntel?.contentThoughtLeadership?.podcastAppearances?.forEach((item) => {
    item.url = cleanUrl(item.url);
  });
  data.prospectIntel?.contentThoughtLeadership?.conferenceTalks?.forEach((item) => {
    item.url = cleanUrl(item.url);
  });

  data.personalizationHooks?.forEach((item) => {
    item.sourceUrl = cleanUrl(item.sourceUrl);
  });
}
