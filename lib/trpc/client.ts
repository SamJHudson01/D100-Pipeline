/**
 * tRPC client hooks for Client Components.
 *
 * Usage:
 *   import { trpcClient } from "@/lib/trpc/client";
 *   const mutation = trpcClient.triage.decide.useMutation();
 */

import { createTRPCClient, httpBatchLink } from "@trpc/client";
import type { AppRouter } from "./router";
import superjson from "superjson";

function getBaseUrl() {
  if (typeof window !== "undefined") return "";
  // Railway / server-side
  if (process.env.RAILWAY_PUBLIC_DOMAIN)
    return `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`;
  return `http://localhost:${process.env.PORT ?? 3005}`;
}

export const trpcClient = createTRPCClient<AppRouter>({
  links: [
    httpBatchLink({
      url: `${getBaseUrl()}/api/trpc`,
      transformer: superjson,
    }),
  ],
});
