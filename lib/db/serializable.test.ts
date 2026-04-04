import { describe, it, expect, vi } from "vitest";
import { withSerializableRetry } from "./serializable";
import { Prisma } from "../generated/prisma/client";

function makeP2034Error(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError("Transaction conflict", {
    code: "P2034",
    clientVersion: "6.0.0",
  });
}

describe("withSerializableRetry", () => {
  it("returns result on first successful attempt", async () => {
    const result = await withSerializableRetry(async () => "success");
    expect(result).toBe("success");
  });

  it("retries on Prisma P2034 and succeeds on second attempt", async () => {
    let attempt = 0;
    const operation = vi.fn(async () => {
      attempt += 1;
      if (attempt === 1) throw makeP2034Error();
      return "recovered";
    });

    const result = await withSerializableRetry(operation);
    expect(result).toBe("recovered");
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it("throws immediately for non-P2034 errors", async () => {
    const operation = vi.fn(async () => {
      throw new Error("connection refused");
    });

    await expect(withSerializableRetry(operation)).rejects.toThrow(
      "connection refused",
    );
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it("throws after exhausting max attempts", async () => {
    const operation = vi.fn(async () => {
      throw makeP2034Error();
    });

    await expect(
      withSerializableRetry(operation, { maxAttempts: 3 }),
    ).rejects.toThrow(Prisma.PrismaClientKnownRequestError);
    expect(operation).toHaveBeenCalledTimes(3);
  });

  it("respects custom maxAttempts of 1", async () => {
    const operation = vi.fn(async () => {
      throw makeP2034Error();
    });

    await expect(
      withSerializableRetry(operation, { maxAttempts: 1 }),
    ).rejects.toThrow(Prisma.PrismaClientKnownRequestError);
    expect(operation).toHaveBeenCalledTimes(1);
  });
});
