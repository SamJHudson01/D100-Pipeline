import { router, publicProcedure } from "../init";
import { prisma } from "../../prisma";
import { settingsQuerySchema } from "../../domain";

export const settingsRouter = router({
  overview: publicProcedure.input(settingsQuerySchema).query(async ({ input }) => {
    const { region } = input;

    const [
      totalCompanies,
      regionCompanies,
      stateBreakdownRaw,
      sourceBreakdownRaw,
      recentRuns,
    ] = await Promise.all([
      prisma.company.count(),
      prisma.company.count({
        where: { regions: { some: { region } } },
      }),
      prisma.company.groupBy({
        by: ["state"],
        _count: { state: true },
        orderBy: { _count: { state: "desc" } },
      }),
      prisma.company.groupBy({
        by: ["source"],
        _count: { source: true },
        orderBy: { _count: { source: "desc" } },
        take: 20,
      }),
      prisma.pipelineRun.findMany({
        orderBy: { startedAt: "desc" },
        take: 5,
      }),
    ]);

    const stateBreakdown = stateBreakdownRaw.map((s) => ({
      state: s.state,
      count: s._count.state,
    }));

    const sourceBreakdown = sourceBreakdownRaw
      .filter((s): s is typeof s & { source: string } => s.source !== null)
      .map((s) => ({
        source: s.source!,
        count: s._count.source,
      }));

    return {
      totalCompanies,
      regionCompanies,
      stateBreakdown,
      sourceBreakdown,
      recentRuns,
    };
  }),
});
