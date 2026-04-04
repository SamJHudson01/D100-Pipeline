import { TRPCError } from "@trpc/server";
import { router, publicProcedure } from "../init";
import { prisma } from "../../prisma";
import { poolFilterSchema, companyDetailInputSchema, enrichmentDataSchema, domainSchema, ALL_REGIONS, computeEffectiveScore } from "../../domain";
import type { EnrichmentData } from "../../domain";
import { Prisma } from "../../generated/prisma/client";
import { getResearchRouteState } from "../../research/service";
import { z } from "zod";

const PAGE_SIZE = 50;

export const companyRouter = router({
  // publicProcedure is intentional — pool is a read-only explorer with no auth.
  // The endpoint surfaces research status (which companies have been investigated).
  // If auth is added elsewhere, audit whether this should remain public. (Hunt: Principle 7)
  pool: publicProcedure.input(poolFilterSchema).query(async ({ input }) => {
    const { source, state, q, page, minScore, region, sortBy, showArchived } = input;
    const offset = (page - 1) * PAGE_SIZE;

    // Region filter for totalPool and facet queries (no per-filter duplication)
    const regionFilter: Prisma.CompanyWhereInput =
      region === ALL_REGIONS ? {} : { regions: { some: { region } } };

    // Build raw SQL WHERE clauses for items + count query.
    // Raw SQL is required because Prisma cannot express computed columns
    // (research_data IS NOT NULL) or sort on expressions. (Leach: Principle 4)
    const conditions: Prisma.Sql[] = [Prisma.sql`1=1`];
    // Archived filter — parameterised via Prisma.sql, never string-interpolated (Hunt: Principle 1)
    conditions.push(showArchived ? Prisma.sql`c."archived" = true` : Prisma.sql`c."archived" = false`);
    if (region !== ALL_REGIONS) {
      conditions.push(
        Prisma.sql`EXISTS (SELECT 1 FROM "company_regions" cr WHERE cr."domain" = c."domain" AND cr."region" = ${region})`
      );
    }
    if (source) conditions.push(Prisma.sql`c."source" = ${source}`);
    if (state) conditions.push(Prisma.sql`c."state" = ${state}`);
    if (q) {
      conditions.push(
        Prisma.sql`(c."name" ILIKE ${"%" + q + "%"} OR c."description" ILIKE ${"%" + q + "%"})`
      );
    }
    if (minScore > 0) conditions.push(Prisma.sql`c."score" >= ${minScore}`);

    const whereClause = Prisma.join(conditions, " AND ");

    // Items query: raw SQL for computed hasResearch boolean + research-first sort.
    // COUNT(*) OVER() returns the total filtered count in every row, eliminating
    // the need for a separate Prisma count query (Leach: Principle 4 — single WHERE).
    type PoolItemRow = {
      domain: string;
      name: string;
      url: string | null;
      description: string | null;
      state: string;
      source: string | null;
      score: number | null;
      team_size: number | null;
      funding_stage: string | null;
      has_research: boolean;
      total_filtered: bigint;
    };

    // Research-first is always the primary sort; secondary sort depends on toggle
    const orderByClause =
      sortBy === "team_size_asc"
        ? Prisma.sql`(c."research_data" IS NOT NULL) DESC, c."team_size" ASC NULLS LAST, c."score" DESC NULLS LAST, c."created_at" DESC`
        : Prisma.sql`(c."research_data" IS NOT NULL) DESC, c."score" DESC NULLS LAST, c."created_at" DESC`;

    const [itemsRaw, totalPool, sourceFacetsRaw] = await Promise.all([
      prisma.$queryRaw<PoolItemRow[]>(Prisma.sql`
        SELECT
          c."domain",
          c."name",
          c."url",
          c."description",
          c."state",
          c."source",
          c."score",
          c."team_size",
          c."funding_stage",
          (c."research_data" IS NOT NULL) AS "has_research",
          COUNT(*) OVER() AS "total_filtered"
        FROM "companies" c
        WHERE ${whereClause}
        ORDER BY ${orderByClause}
        LIMIT ${PAGE_SIZE}
        OFFSET ${offset}
      `),
      prisma.company.count({ where: { ...regionFilter, archived: showArchived } }),
      prisma.company.groupBy({
        by: ["source"],
        where: { ...regionFilter, archived: showArchived },
        _count: { source: true },
        orderBy: { _count: { source: "desc" } },
        take: 20,
      }),
    ]);

    // total_filtered comes from COUNT OVER() — same for every row, 0 if no rows
    const totalFiltered = itemsRaw.length > 0 ? Number(itemsRaw[0].total_filtered) : 0;

    // Map snake_case raw SQL rows to camelCase for the frontend
    const items = itemsRaw.map((row) => ({
      domain: row.domain,
      name: row.name,
      url: row.url,
      description: row.description,
      state: row.state,
      source: row.source,
      score: row.score,
      teamSize: row.team_size,
      fundingStage: row.funding_stage,
      hasResearch: row.has_research,
    }));

    const sourceFacets = sourceFacetsRaw
      .filter((s): s is typeof s & { source: string } => s.source !== null)
      .map((s) => ({
        source: s.source!,
        count: s._count.source,
      }));

    return {
      items,
      totalFiltered,
      totalPool,
      sourceFacets,
      totalPages: Math.ceil(totalFiltered / PAGE_SIZE),
    };
  }),

  detail: publicProcedure.input(companyDetailInputSchema).query(async ({ input }) => {
    const company = await prisma.company.findUnique({
      where: { domain: input.domain },
      select: {
        domain: true,
        name: true,
        url: true,
        description: true,
        source: true,
        state: true,
        score: true,
        originalScore: true,
        scoredAt: true,
        teamSize: true,
        fundingStage: true,
        dream100: true,
        archived: true,
        sequenceStep: true,
        sequencePaused: true,
        lastTouchDate: true,
        hasSignup: true,
        hasPricingPage: true,
        hasGrowthHire: true,
        totalAtsRoles: true,
        atsPlatform: true,
        touchpoints: {
          orderBy: { touchDate: "desc" },
          take: 5,
          select: {
            id: true,
            touchDate: true,
            channel: true,
            type: true,
            notes: true,
          },
        },
      },
    });

    if (!company) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Company not found" });
    }

    const effectiveScore = computeEffectiveScore(company.score, company.originalScore, company.scoredAt);

    return { ...company, effectiveScore };
  }),

  brief: publicProcedure.input(companyDetailInputSchema).query(async ({ input }) => {
    const company = await prisma.company.findUnique({
      where: { domain: input.domain },
      select: {
        domain: true,
        name: true,
        url: true,
        description: true,
        source: true,
        state: true,
        score: true,
        originalScore: true,
        scoredAt: true,
        teamSize: true,
        teamSizeSource: true,
        fundingStage: true,
        fundingEvidence: true,
        atsPlatform: true,
        hasSignup: true,
        hasPricingPage: true,
        hasGrowthHire: true,
        totalAtsRoles: true,
        dream100: true,
        archived: true,
        sequenceStep: true,
        enrichmentData: true,
        touchpoints: {
          orderBy: { touchDate: "desc" },
          take: 5,
          select: {
            id: true,
            touchDate: true,
            channel: true,
            type: true,
            notes: true,
          },
        },
      },
    });

    if (!company) {
      const { TRPCError } = await import("@trpc/server");
      throw new TRPCError({ code: "NOT_FOUND", message: "Company not found" });
    }

    const effectiveScore = computeEffectiveScore(company.score, company.originalScore, company.scoredAt);

    // Parse enrichment data through Zod schema (safe parse — graceful on invalid)
    let enrichment: EnrichmentData = {};
    if (company.enrichmentData && typeof company.enrichmentData === "object") {
      const parsed = enrichmentDataSchema.safeParse(company.enrichmentData);
      if (parsed.success) {
        enrichment = parsed.data;
      } else {
        // Log validation failure — never cast raw data past a failed gate (Collina: Principle 1)
        console.warn(`[brief] enrichmentData safeParse failed for ${input.domain}:`, parsed.error.issues.slice(0, 3));
      }
    }

    const researchState = await getResearchRouteState(input.domain);
    const researchJobStatus = researchState.latestJob?.status ?? null;

    return {
      domain: company.domain,
      name: company.name,
      url: company.url,
      description: company.description,
      source: company.source,
      state: company.state,
      effectiveScore,
      teamSize: enrichment.webSearch?.employeeCount ?? company.teamSize,
      fundingStage: enrichment.webSearch?.fundingStage ?? company.fundingStage,
      fundingAmount: enrichment.webSearch?.fundingAmount ?? null,
      fundingDate: enrichment.webSearch?.fundingDate ?? null,
      fundingSource: enrichment.webSearch?.fundingSource ?? null,
      foundedYear: enrichment.webSearch?.foundedYear ?? null,
      hqLocation: enrichment.webSearch?.hqLocation ?? null,
      hasSignup: company.hasSignup,
      hasPricingPage: company.hasPricingPage,
      hasGrowthHire: company.hasGrowthHire,
      totalAtsRoles: company.totalAtsRoles,
      atsPlatform: company.atsPlatform,
      dream100: company.dream100,
      archived: company.archived,
      touchpoints: company.touchpoints,
      // Research status (from latest job, lightweight — no JSONB loaded)
      researchState,
      researchJobStatus: researchJobStatus as string | null,
      researchJobExecutor: researchState.latestJob?.executor ?? null,
      researchJobError: researchState.latestJob?.error ?? null,
      hasResearchData: researchState.hasResearchData,
      // Enrichment sections
      keyPeople: enrichment.keyPeople ?? [],
      infrastructure: enrichment.infrastructure ?? null,
      structuredSources: enrichment.structuredSources ?? null,
      detectedTools: enrichment.detectedTools ?? [],
      growthMaturity: enrichment.growthMaturity ?? null,
      pricing: enrichment.pricing ?? null,
      signup: enrichment.signup ?? null,
      socialProof: enrichment.socialProof ?? null,
      cta: enrichment.cta ?? null,
      content: enrichment.content ?? null,
      contact: enrichment.contact ?? null,
      latestNews: enrichment.webSearch?.latestNews ?? [],
      meta: enrichment.meta ?? null,
    };
  }),

  // publicProcedure is intentional — archive is a lightweight state toggle on a single-user tool.
  // If auth is added elsewhere, audit whether this should remain public. (Hunt: Principle 7)
  archive: publicProcedure
    .input(z.object({ domain: domainSchema }))
    .mutation(async ({ input }) => {
      try {
        await prisma.company.update({
          where: { domain: input.domain },
          data: { archived: true },
        });
      } catch (error) {
        // publicProcedure has no translatePrismaErrors middleware — catch P2025 explicitly (Collina: Principle 3)
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
          throw new TRPCError({ code: "NOT_FOUND", message: "Company not found" });
        }
        throw error;
      }
      return { success: true };
    }),

  updateUrl: publicProcedure
    .input(z.object({ domain: domainSchema, url: z.string().url().max(2048) }))
    .mutation(async ({ input }) => {
      try {
        await prisma.company.update({
          where: { domain: input.domain },
          data: { url: input.url },
        });
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
          throw new TRPCError({ code: "NOT_FOUND", message: "Company not found" });
        }
        throw error;
      }
      return { success: true };
    }),

  unarchive: publicProcedure
    .input(z.object({ domain: domainSchema }))
    .mutation(async ({ input }) => {
      try {
        await prisma.company.update({
          where: { domain: input.domain },
          data: { archived: false },
        });
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
          throw new TRPCError({ code: "NOT_FOUND", message: "Company not found" });
        }
        throw error;
      }
      return { success: true };
    }),
});

