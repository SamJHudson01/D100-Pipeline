CREATE INDEX CONCURRENTLY "research_jobs_executor_status_requested_at_idx"
    ON "research_jobs"("executor", "status", "requested_at");
