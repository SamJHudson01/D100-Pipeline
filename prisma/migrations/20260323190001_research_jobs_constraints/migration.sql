-- File 2: CHECK constraints and partial unique index for research_jobs
-- Two-file pattern: constraints added as NOT VALID then validated separately.

-- CHECK: status must be one of the four lifecycle values
-- Cross-ref: researchJobStatusSchema in lib/domain.ts
ALTER TABLE "research_jobs"
    ADD CONSTRAINT "rj_status_check"
    CHECK ("status" IN ('pending', 'in_progress', 'completed', 'failed'))
    NOT VALID;
ALTER TABLE "research_jobs" VALIDATE CONSTRAINT "rj_status_check";

-- CHECK: started_at must be null when status is pending (prevents inconsistent state)
ALTER TABLE "research_jobs"
    ADD CONSTRAINT "rj_started_at_check"
    CHECK ("started_at" IS NULL OR "status" != 'pending')
    NOT VALID;
ALTER TABLE "research_jobs" VALIDATE CONSTRAINT "rj_started_at_check";

-- Partial unique index: at most one active job per domain
-- Prevents double-requesting from concurrent UI clicks
-- Violations handled as PrismaClientUnknownRequestError per conventions
CREATE UNIQUE INDEX "research_jobs_domain_active_uniq"
    ON "research_jobs"("domain")
    WHERE "status" IN ('pending', 'in_progress');

-- CHECK: research_data JSONB size cap (500KB)
ALTER TABLE "companies"
    ADD CONSTRAINT "companies_research_data_size"
    CHECK ("research_data" IS NULL OR pg_column_size("research_data") < 512000)
    NOT VALID;
ALTER TABLE "companies" VALIDATE CONSTRAINT "companies_research_data_size";
