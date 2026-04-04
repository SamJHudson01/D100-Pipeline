import { describe, it, expect } from "vitest";
import { TRPCError } from "@trpc/server";
import { router, publicProcedure } from "./init";
import { Prisma } from "../generated/prisma/client";

/**
 * Build a one-procedure router + caller that throws the given error.
 * Uses tRPC's createCallerFactory so the middleware chain executes end-to-end.
 */
function buildCallerThatThrows(error: Error) {
  const appRouter = router({
    fail: publicProcedure.mutation(async () => {
      throw error;
    }),
  });

  // createCallerFactory is on the router itself in tRPC v11
  const createCaller = appRouter.createCaller;
  const caller = createCaller({});
  return caller;
}

/**
 * Build a one-procedure router + caller that returns data successfully.
 */
function buildCallerThatSucceeds(data: unknown) {
  const appRouter = router({
    ok: publicProcedure.query(async () => data),
  });

  const createCaller = appRouter.createCaller;
  const caller = createCaller({});
  return caller;
}

describe("prismaErrorHandler middleware", () => {
  it("translates P2002 (unique constraint) to TRPCError CONFLICT", async () => {
    const prismaError = new Prisma.PrismaClientKnownRequestError(
      "Unique constraint failed on the fields: (`domain`)",
      { code: "P2002", clientVersion: "6.0.0", meta: { target: ["domain"] } },
    );
    const caller = buildCallerThatThrows(prismaError);

    try {
      await caller.fail();
      expect.unreachable("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(TRPCError);
      const trpcErr = err as TRPCError;
      expect(trpcErr.code).toBe("CONFLICT");
      expect(trpcErr.message).toBe(
        "A record with this identifier already exists",
      );
      // Must NOT leak the original Prisma error as cause (no table/column names)
      expect(trpcErr.cause).toBeUndefined();
    }
  });

  it("translates P2025 (record not found) to TRPCError NOT_FOUND", async () => {
    const prismaError = new Prisma.PrismaClientKnownRequestError(
      "An operation failed because it depends on one or more records that were required but not found.",
      { code: "P2025", clientVersion: "6.0.0" },
    );
    const caller = buildCallerThatThrows(prismaError);

    try {
      await caller.fail();
      expect.unreachable("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(TRPCError);
      const trpcErr = err as TRPCError;
      expect(trpcErr.code).toBe("NOT_FOUND");
      expect(trpcErr.message).toBe("Record not found");
      expect(trpcErr.cause).toBeUndefined();
    }
  });

  it("wraps other PrismaClientKnownRequestError codes as INTERNAL_SERVER_ERROR", async () => {
    const prismaError = new Prisma.PrismaClientKnownRequestError(
      "Foreign key constraint failed on the field: `companyId`",
      { code: "P2003", clientVersion: "6.0.0" },
    );
    const caller = buildCallerThatThrows(prismaError);

    try {
      await caller.fail();
      expect.unreachable("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(TRPCError);
      const trpcErr = err as TRPCError;
      expect(trpcErr.code).toBe("INTERNAL_SERVER_ERROR");
      expect(trpcErr.message).toBe("An internal error occurred");
      // Must NOT set cause — superjson would serialize .meta with table/column names
      expect(trpcErr.cause).toBeUndefined();
    }
  });

  it("wraps PrismaClientValidationError as INTERNAL_SERVER_ERROR", async () => {
    const prismaError = new Prisma.PrismaClientValidationError(
      "Argument `data` is missing.",
      { clientVersion: "6.0.0" },
    );
    const caller = buildCallerThatThrows(prismaError);

    try {
      await caller.fail();
      expect.unreachable("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(TRPCError);
      const trpcErr = err as TRPCError;
      expect(trpcErr.code).toBe("INTERNAL_SERVER_ERROR");
      expect(trpcErr.message).toBe("An internal error occurred");
      expect(trpcErr.cause).toBeUndefined();
    }
  });

  it("wraps PrismaClientInitializationError as INTERNAL_SERVER_ERROR", async () => {
    const prismaError = new Prisma.PrismaClientInitializationError(
      "Can't reach database server",
      "6.0.0",
    );
    const caller = buildCallerThatThrows(prismaError);

    try {
      await caller.fail();
      expect.unreachable("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(TRPCError);
      const trpcErr = err as TRPCError;
      expect(trpcErr.code).toBe("INTERNAL_SERVER_ERROR");
      expect(trpcErr.message).toBe("An internal error occurred");
      expect(trpcErr.cause).toBeUndefined();
    }
  });

  it("passes through non-Prisma errors unchanged", async () => {
    const genericError = new Error("Something unrelated broke");
    const caller = buildCallerThatThrows(genericError);

    try {
      await caller.fail();
      expect.unreachable("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(TRPCError);
      const trpcErr = err as TRPCError;
      // tRPC wraps unknown errors as INTERNAL_SERVER_ERROR, middleware should not alter that
      expect(trpcErr.code).toBe("INTERNAL_SERVER_ERROR");
      // The cause should be the original error (middleware didn't strip it)
      expect(trpcErr.cause).toBeInstanceOf(Error);
      expect((trpcErr.cause as Error).message).toBe(
        "Something unrelated broke",
      );
    }
  });

  it("passes through TRPCErrors thrown by the procedure unchanged", async () => {
    const trpcError = new TRPCError({
      code: "FORBIDDEN",
      message: "Not allowed",
    });
    const caller = buildCallerThatThrows(trpcError);

    try {
      await caller.fail();
      expect.unreachable("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(TRPCError);
      const trpcErr = err as TRPCError;
      expect(trpcErr.code).toBe("FORBIDDEN");
      expect(trpcErr.message).toBe("Not allowed");
    }
  });

  it("returns data on success without interference", async () => {
    const caller = buildCallerThatSucceeds({ id: 1, name: "Test" });
    const result = await caller.ok();
    expect(result).toEqual({ id: 1, name: "Test" });
  });
});
