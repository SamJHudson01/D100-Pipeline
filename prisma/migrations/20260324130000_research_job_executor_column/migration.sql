-- File 1: Add executor provenance to research_jobs
-- Existing rows are backfilled to claude to preserve the current workflow.

ALTER TABLE "research_jobs" ADD COLUMN "executor" TEXT;

UPDATE "research_jobs"
SET "executor" = 'claude'
WHERE "executor" IS NULL;

ALTER TABLE "research_jobs"
    ALTER COLUMN "executor" SET DEFAULT 'claude';

ALTER TABLE "research_jobs"
    ALTER COLUMN "executor" SET NOT NULL;
