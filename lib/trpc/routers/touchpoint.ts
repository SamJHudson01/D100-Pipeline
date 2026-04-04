import { TRPCError } from "@trpc/server";
import { router, publicProcedure } from "../init";
import { prisma } from "../../prisma";
import { markContactedInputSchema } from "../../domain";

export const touchpointRouter = router({
  markContacted: publicProcedure
    .input(markContactedInputSchema)
    .mutation(async ({ input }) => {
      const { domain } = input;

      // Verify company exists
      const company = await prisma.company.findUnique({
        where: { domain },
        select: { domain: true },
      });
      if (!company) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Company not found" });
      }

      // Atomic: insert touchpoint + update company in one transaction
      await prisma.$transaction([
        prisma.touchpoint.create({
          data: {
            domain,
            touchDate: new Date(),
            channel: "loom",
            type: "Initial outreach",
          },
        }),
        prisma.company.update({
          where: { domain },
          data: {
            state: "contacted",
            dream100: true,
            sequenceStep: 1,
            sequenceStartedAt: new Date(),
            lastTouchDate: new Date(),
          },
        }),
      ]);

      return { success: true };
    }),
});
