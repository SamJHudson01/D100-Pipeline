import { TRPCError } from "@trpc/server";
import { router, publicProcedure } from "../init";
import { prisma } from "../../prisma";
import { triageInputSchema, triageQuerySchema } from "../../domain";

export const triageRouter = router({
  prospects: publicProcedure.input(triageQuerySchema).query(async ({ input }) => {
    const { region } = input;

    return prisma.company.findMany({
      where: {
        state: "qualified",
        dismissed: false,
        OR: [
          { snoozedUntil: null },
          { snoozedUntil: { lt: new Date() } },
        ],
        regions: { some: { region } },
      },
      select: {
        domain: true,
        name: true,
        url: true,
        description: true,
        score: true,
        originalScore: true,
        scoredAt: true,
        source: true,
        fundingStage: true,
        teamSize: true,
      },
      orderBy: { score: { sort: "desc", nulls: "last" } },
      take: 5,
    });
  }),

  stats: publicProcedure.input(triageQuerySchema).query(async ({ input }) => {
    const { region } = input;
    const regionFilter = { regions: { some: { region } } };

    const [total, qualified, discovered] = await Promise.all([
      prisma.company.count({ where: regionFilter }),
      prisma.company.count({ where: { ...regionFilter, state: "qualified" } }),
      prisma.company.count({ where: { ...regionFilter, state: "discovered" } }),
    ]);

    return { total, qualified, discovered };
  }),

  decide: publicProcedure.input(triageInputSchema).mutation(async ({ input }) => {
    const { domain, decision, snoozeUntil } = input;

    // Verify company exists
    const company = await prisma.company.findUnique({
      where: { domain },
      select: { domain: true },
    });
    if (!company) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Company not found" });
    }

    switch (decision) {
      case "select":
        await prisma.company.update({
          where: { domain },
          data: {
            state: "contacted",
            pinned: true,
            dream100: true,
            sequenceStep: 0,
            sequenceStartedAt: new Date(),
          },
        });
        break;

      case "skip":
        await prisma.company.update({
          where: { domain },
          data: { state: "nurture", pinned: false },
        });
        break;

      case "snooze":
        await prisma.company.update({
          where: { domain },
          data: {
            snoozedUntil: snoozeUntil ? new Date(snoozeUntil) : null,
            pinned: false,
          },
        });
        break;

      case "dismiss":
        await prisma.company.update({
          where: { domain },
          data: { dismissed: true, pinned: false },
        });
        break;
    }

    return { success: true };
  }),
});
