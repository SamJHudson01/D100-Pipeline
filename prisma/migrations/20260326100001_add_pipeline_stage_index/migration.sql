-- Partial index on pipeline_stage filtered to dream100 companies.
-- CONCURRENTLY avoids locking the table during creation.
-- Must be the sole statement in this migration (CONCURRENTLY cannot run inside a transaction).
CREATE INDEX CONCURRENTLY "idx_pipeline_stage_dream100" ON "companies" ("pipeline_stage") WHERE "dream100" = true;
