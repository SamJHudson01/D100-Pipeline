-- DropPriorityScore
-- Remove the priority_score column and its index.
-- Recreate the companies_scored view without the dropped column.

DROP INDEX IF EXISTS "companies_priority_score_idx";
DROP INDEX IF EXISTS "idx_priority";

-- The view depends on the column, so drop and recreate it.
DROP VIEW IF EXISTS "companies_scored";

ALTER TABLE "companies" DROP COLUMN IF EXISTS "priority_score";

CREATE VIEW "companies_scored" AS
SELECT
    domain, name, url, description, source, sources, source_data,
    state, pre_filter_result, pre_filter_confidence,
    score, original_score, scored_at, verdict,
    team_size, team_size_source, team_size_confidence,
    funding_stage, funding_evidence,
    ats_platform, ats_data, enrichment_data,
    last_enriched, last_scored,
    snoozed_until, dismissed, pinned,
    dream100, sequence_step, sequence_started_at, sequence_paused, last_touch_date,
    has_new_signal, signal_type, signal_date,
    has_pricing_page, has_signup, has_growth_hire, total_ats_roles,
    last_run_id, created_at, updated_at,
    CASE
        WHEN original_score IS NOT NULL AND scored_at IS NOT NULL THEN
            (original_score::numeric * GREATEST(0.0,
                CASE
                    WHEN (EXTRACT(epoch FROM now() - scored_at) / 86400.0) <= 30 THEN 1.0
                    WHEN (EXTRACT(epoch FROM now() - scored_at) / 86400.0) <= 60 THEN 0.75
                    WHEN (EXTRACT(epoch FROM now() - scored_at) / 86400.0) <= 90 THEN 0.50
                    ELSE 0.0
                END))::integer
        ELSE COALESCE(score, 0)
    END AS effective_score
FROM companies;
