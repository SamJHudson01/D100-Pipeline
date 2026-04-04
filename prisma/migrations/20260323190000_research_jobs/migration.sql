-- File 1: Create research_jobs table and add research_data column to companies
-- Part of two-file migration pattern (constraints in File 2)

-- Add research_data JSONB column to companies (nullable, metadata-only lock)
ALTER TABLE "companies" ADD COLUMN "research_data" JSONB;

-- Create research_jobs table
CREATE TABLE "research_jobs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "domain" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "requested_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "started_at" TIMESTAMPTZ(6),
    "completed_at" TIMESTAMPTZ(6),
    "error" TEXT,

    CONSTRAINT "research_jobs_pkey" PRIMARY KEY ("id")
);

-- Foreign key: domain → companies.domain with CASCADE delete
ALTER TABLE "research_jobs"
    ADD CONSTRAINT "research_jobs_domain_fkey"
    FOREIGN KEY ("domain") REFERENCES "companies"("domain")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- Indexes (new table, no CONCURRENTLY needed)
CREATE INDEX "research_jobs_domain_idx" ON "research_jobs"("domain");
CREATE INDEX "research_jobs_domain_status_idx" ON "research_jobs"("domain", "status");
