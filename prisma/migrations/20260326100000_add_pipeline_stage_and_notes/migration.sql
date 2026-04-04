-- Add pipeline_stage column for kanban board.
-- Postgres 11+ handles ADD COLUMN with a constant default as metadata-only (no table rewrite).
ALTER TABLE "companies" ADD COLUMN "pipeline_stage" TEXT NOT NULL DEFAULT 'backlog';

-- CHECK constraint enforces valid stage values at the database level.
ALTER TABLE "companies" ADD CONSTRAINT "companies_pipeline_stage_check"
  CHECK ("pipeline_stage" IN ('backlog', 'outreach', 'follow_up', 'call', 'closed', 'not_closed'));

-- Add scratchpad notes column (nullable — NULL means no notes written yet).
ALTER TABLE "companies" ADD COLUMN "notes" TEXT;
