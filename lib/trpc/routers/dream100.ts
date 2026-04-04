import { TRPCError } from "@trpc/server";
import { router, publicProcedure } from "../init";
import { prisma } from "../../prisma";
import { domainSchema, moveStageInputSchema, updateNotesInputSchema } from "../../domain";
import { z } from "zod";

export const dream100Router = router({
  list: publicProcedure.query(async () => {
    return prisma.company.findMany({
      where: { dream100: true },
      select: {
        domain: true,
        name: true,
        url: true,
        description: true,
        score: true,
        sequenceStep: true,
        sequencePaused: true,
        lastTouchDate: true,
        sequenceStartedAt: true,
        teamSize: true,
        fundingStage: true,
        source: true,
        enrichmentData: true,
      },
      orderBy: { lastTouchDate: { sort: "asc", nulls: "last" } },
    });
  }),

  pipeline: publicProcedure.query(async () => {
    return prisma.company.findMany({
      where: { dream100: true },
      select: {
        domain: true,
        name: true,
        description: true,
        score: true,
        pipelineStage: true,
        notes: true,
        lastTouchDate: true,
      },
      orderBy: { score: { sort: "desc", nulls: "last" } },
    });
  }),

  moveStage: publicProcedure
    .input(moveStageInputSchema)
    .mutation(async ({ input }) => {
      const updated = await prisma.company.update({
        where: { domain: input.domain },
        data: { pipelineStage: input.stage },
        select: { pipelineStage: true },
      });
      return { pipelineStage: updated.pipelineStage };
    }),

  updateNotes: publicProcedure
    .input(updateNotesInputSchema)
    .mutation(async ({ input }) => {
      const updated = await prisma.company.update({
        where: { domain: input.domain },
        data: { notes: input.notes },
        select: { notes: true },
      });
      return { notes: updated.notes };
    }),

  addCompany: publicProcedure
    .input(z.object({ domain: domainSchema }))
    .mutation(async ({ input }) => {
      const company = await prisma.company.findUnique({
        where: { domain: input.domain },
        select: { domain: true, dream100: true },
      });
      if (!company) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Company not found" });
      }
      if (company.dream100) {
        return { success: true, alreadyAdded: true };
      }
      await prisma.company.update({
        where: { domain: input.domain },
        data: {
          dream100: true,
          sequenceStep: 0,
          sequenceStartedAt: new Date(),
          pipelineStage: "backlog",
        },
      });
      return { success: true, alreadyAdded: false };
    }),

  removeCompany: publicProcedure
    .input(z.object({ domain: domainSchema }))
    .mutation(async ({ input }) => {
      await prisma.company.update({
        where: { domain: input.domain },
        data: {
          dream100: false,
          sequenceStep: null,
          sequenceStartedAt: null,
          sequencePaused: false,
          pipelineStage: "backlog",
          notes: null,
        },
      });
      return { success: true };
    }),
});
