-- CHECK constraints on workflow state columns (matching the pipeline_stage pattern from AP-1).
-- Uses NOT VALID + separate VALIDATE to avoid ACCESS EXCLUSIVE lock on existing rows.

ALTER TABLE "companies" ADD CONSTRAINT "companies_state_check"
  CHECK ("state" IN ('discovered', 'pre_filtered', 'pre_filter_rejected', 'enriched', 'qualified', 'nurture', 'skip', 'disqualified', 'contacted', 'stale', 'dead'))
  NOT VALID;

ALTER TABLE "companies" VALIDATE CONSTRAINT "companies_state_check";

ALTER TABLE "research_jobs" ADD CONSTRAINT "research_jobs_status_check"
  CHECK ("status" IN ('pending', 'in_progress', 'completed', 'failed'))
  NOT VALID;

ALTER TABLE "research_jobs" VALIDATE CONSTRAINT "research_jobs_status_check";

ALTER TABLE "pipeline_runs" ADD CONSTRAINT "pipeline_runs_status_check"
  CHECK ("status" IN ('running', 'completed', 'failed'))
  NOT VALID;

ALTER TABLE "pipeline_runs" VALIDATE CONSTRAINT "pipeline_runs_status_check";
