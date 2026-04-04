/**
 * Server-side tRPC caller for use in Server Components.
 *
 * Usage:
 *   import { createCaller } from "@/lib/trpc/server";
 *   const trpc = await createCaller();
 *   const data = await trpc.company.pool({ page: 1 });
 */

import "server-only";
import { createTRPCContext } from "./init";
import { appRouter } from "./router";

export async function createCaller() {
  const ctx = await createTRPCContext();
  return appRouter.createCaller(ctx);
}
