import { Prisma } from "../generated/prisma/client.ts";

const DEFAULT_MAX_ATTEMPTS = 3;
const BASE_DELAY_MS = 25;

function isSerializableConflict(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2034"
  );
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function withSerializableRetry<T>(
  operation: () => Promise<T>,
  options?: { maxAttempts?: number },
): Promise<T> {
  const maxAttempts = options?.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (!isSerializableConflict(error) || attempt === maxAttempts) {
        throw error;
      }

      await wait(BASE_DELAY_MS * attempt);
    }
  }

  throw new Error("Serializable retry exhausted without returning");
}
