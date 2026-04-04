-- File 2: CHECK constraints for research_jobs.executor
-- Two-file pattern: constraints added as NOT VALID then validated separately.

-- CHECK: executor must be one of the supported research executors
-- Cross-ref: researchExecutorSchema in lib/domain.ts
ALTER TABLE "research_jobs"
    ADD CONSTRAINT "rj_executor_check"
    CHECK ("executor" IN ('claude', 'openrouter'))
    NOT VALID;
ALTER TABLE "research_jobs" VALIDATE CONSTRAINT "rj_executor_check";
