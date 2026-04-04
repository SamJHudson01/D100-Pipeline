-- Composite index covering the primary pool query access pattern (archived + state).
-- CONCURRENTLY avoids locking the table during creation.
CREATE INDEX CONCURRENTLY "companies_archived_state_idx" ON "companies" ("archived", "state");
