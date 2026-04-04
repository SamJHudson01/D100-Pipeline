/**
 * tRPC initialization — base procedures and error handling.
 *
 * All procedures use publicProcedure for now. When Clerk is added,
 * insert a protectedProcedure base here and every router inherits auth.
 */

import { initTRPC, TRPCError } from "@trpc/server";
import { Prisma } from "../generated/prisma/client";
import superjson from "superjson";

export const createTRPCContext = async () => {
  // When Clerk is added: extract auth from headers here
  return {};
};

export type TRPCContext = Awaited<ReturnType<typeof createTRPCContext>>;

const t = initTRPC.context<TRPCContext>().create({
  transformer: superjson,
  errorFormatter({ shape, error }) {
    return {
      ...shape,
      message:
        process.env.NODE_ENV === "production" && error.code === "INTERNAL_SERVER_ERROR"
          ? "An internal error occurred"
          : shape.message,
    };
  },
});

/**
 * Middleware: translate Prisma errors to tRPC errors.
 * P2002 → CONFLICT, P2025 → NOT_FOUND, all others → sanitised INTERNAL_SERVER_ERROR.
 *
 * In tRPC v11, `next()` does NOT throw on procedure errors — it returns
 * `{ ok: false, error: TRPCError }` where the original throw is wrapped as
 * `error.cause`. We inspect the result object rather than using try/catch.
 */
const prismaErrorHandler = t.middleware(async ({ next }) => {
  const result = await next();

  if (!result.ok) {
    const cause = result.error.cause;

    if (cause instanceof Prisma.PrismaClientKnownRequestError) {
      if (cause.code === "P2002") {
        throw new TRPCError({
          code: "CONFLICT",
          message: "A record with this identifier already exists",
        });
      }
      if (cause.code === "P2025") {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Record not found",
        });
      }
    }

    // Catch-all: wrap any Prisma error into a sanitised TRPCError.
    // Do not set `cause` — superjson would serialize .meta with table/column names.
    if (
      cause instanceof Prisma.PrismaClientKnownRequestError ||
      cause instanceof Prisma.PrismaClientValidationError ||
      cause instanceof Prisma.PrismaClientInitializationError
    ) {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "An internal error occurred",
      });
    }

    // Non-Prisma error — re-throw the original TRPCError as-is
    throw result.error;
  }

  return result;
});

export const router = t.router;
export const publicProcedure = t.procedure.use(prismaErrorHandler);
