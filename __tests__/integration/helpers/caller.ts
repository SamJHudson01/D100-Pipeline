import { appRouter } from "@/lib/trpc/router";

/**
 * Build a tRPC caller that flows through the real middleware stack
 * (prismaErrorHandler). No auth in this project — publicProcedure only.
 */
export function buildCaller() {
  return appRouter.createCaller({});
}
