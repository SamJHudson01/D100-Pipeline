import { PrismaClient } from "@/lib/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { config as dotenvConfig } from "dotenv";
import path from "node:path";
import { beforeAll, afterAll } from "vitest";

// Load .env from the parent directory (same as lib/prisma.ts).
dotenvConfig({ path: path.resolve(process.cwd(), "..", ".env") });

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL must be set for integration tests");
}

// Safety guard: refuse to run against production databases.
const isLocal = /localhost|127\.0\.0\.1/.test(databaseUrl);
const hasBranchSuffix = /[-_](test|dev|branch)/i.test(databaseUrl);
const isAllowed = !!process.env.ALLOW_INTEGRATION_DB;
if (!isLocal && !hasBranchSuffix && !isAllowed) {
  throw new Error(
    "DATABASE_URL does not look like a test/dev database. " +
      "Set ALLOW_INTEGRATION_DB=1 to override.",
  );
}

// Single PrismaClient for the entire test suite — avoids connection exhaustion.
const adapter = new PrismaPg({ connectionString: databaseUrl });
const prisma = new PrismaClient({ adapter });

/** Get the shared test PrismaClient. Never import PrismaClient directly in test files. */
export function getTestDb() {
  return prisma;
}

/** Call once per test file's top-level scope to set up DB lifecycle. */
export function setupTestDb() {
  beforeAll(async () => {
    // Warmup query — absorbs Neon cold-start latency before any assertions.
    await prisma.$executeRawUnsafe("SELECT 1");
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });
}
