-- CreateTable
CREATE TABLE "companies" (
    "domain" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT,
    "description" TEXT,
    "source" TEXT,
    "sources" JSONB,
    "source_data" JSONB,
    "state" TEXT NOT NULL DEFAULT 'discovered',
    "priority_score" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "pre_filter_result" TEXT,
    "pre_filter_confidence" DOUBLE PRECISION,
    "score" INTEGER,
    "original_score" INTEGER,
    "scored_at" TIMESTAMPTZ(6),
    "verdict" TEXT,
    "team_size" INTEGER,
    "team_size_source" TEXT,
    "team_size_confidence" TEXT,
    "funding_stage" TEXT,
    "funding_evidence" TEXT,
    "ats_platform" TEXT,
    "ats_data" JSONB,
    "enrichment_data" JSONB,
    "last_enriched" TIMESTAMPTZ(6),
    "last_scored" TIMESTAMPTZ(6),
    "snoozed_until" TIMESTAMPTZ(6),
    "dismissed" BOOLEAN NOT NULL DEFAULT false,
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "dream100" BOOLEAN NOT NULL DEFAULT false,
    "sequence_step" INTEGER,
    "sequence_started_at" TIMESTAMPTZ(6),
    "sequence_paused" BOOLEAN NOT NULL DEFAULT false,
    "last_touch_date" TIMESTAMPTZ(6),
    "has_new_signal" BOOLEAN NOT NULL DEFAULT false,
    "signal_type" TEXT,
    "signal_date" TIMESTAMPTZ(6),
    "has_pricing_page" BOOLEAN NOT NULL DEFAULT false,
    "has_signup" BOOLEAN NOT NULL DEFAULT false,
    "has_growth_hire" BOOLEAN NOT NULL DEFAULT false,
    "total_ats_roles" INTEGER NOT NULL DEFAULT 0,
    "last_run_id" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "companies_pkey" PRIMARY KEY ("domain")
);

-- CreateTable
CREATE TABLE "company_regions" (
    "domain" TEXT NOT NULL,
    "region" TEXT NOT NULL,

    CONSTRAINT "company_regions_pkey" PRIMARY KEY ("domain","region")
);

-- CreateTable
CREATE TABLE "touchpoints" (
    "id" SERIAL NOT NULL,
    "domain" TEXT NOT NULL,
    "touch_date" TIMESTAMPTZ(6) NOT NULL,
    "channel" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "notes" TEXT,
    "outcome" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "touchpoints_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pipeline_runs" (
    "run_id" TEXT NOT NULL,
    "started_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ(6),
    "run_type" TEXT NOT NULL,
    "companies_processed" INTEGER NOT NULL DEFAULT 0,
    "companies_qualified" INTEGER NOT NULL DEFAULT 0,
    "companies_rejected" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'running',
    "summary" TEXT,
    "region" TEXT NOT NULL DEFAULT 'uk',

    CONSTRAINT "pipeline_runs_pkey" PRIMARY KEY ("run_id")
);

-- CreateIndex
CREATE INDEX "companies_state_idx" ON "companies"("state");

-- CreateIndex
CREATE INDEX "companies_priority_score_idx" ON "companies"("priority_score" DESC);

-- CreateIndex
CREATE INDEX "companies_source_idx" ON "companies"("source");

-- CreateIndex
CREATE INDEX "company_regions_domain_idx" ON "company_regions"("domain");

-- CreateIndex
CREATE INDEX "touchpoints_domain_touch_date_idx" ON "touchpoints"("domain", "touch_date" DESC);

-- AddForeignKey
ALTER TABLE "company_regions" ADD CONSTRAINT "company_regions_domain_fkey" FOREIGN KEY ("domain") REFERENCES "companies"("domain") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "touchpoints" ADD CONSTRAINT "touchpoints_domain_fkey" FOREIGN KEY ("domain") REFERENCES "companies"("domain") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─── CHECK Constraints (hand-edited — Prisma cannot express these) ───────────

ALTER TABLE "companies" ADD CONSTRAINT "companies_state_check"
  CHECK ("state" IN ('discovered','pre_filtered','pre_filter_rejected','enriched','qualified','nurture','skip','disqualified','contacted','stale','dead'));

ALTER TABLE "companies" ADD CONSTRAINT "companies_verdict_check"
  CHECK ("verdict" IS NULL OR "verdict" IN ('qualify','nurture','skip','disqualify'));

ALTER TABLE "companies" ADD CONSTRAINT "companies_pre_filter_result_check"
  CHECK ("pre_filter_result" IS NULL OR "pre_filter_result" IN ('yes','no','maybe'));

ALTER TABLE "touchpoints" ADD CONSTRAINT "touchpoints_channel_check"
  CHECK ("channel" IN ('email','linkedin','loom','twitter','other'));

ALTER TABLE "pipeline_runs" ADD CONSTRAINT "pipeline_runs_run_type_check"
  CHECK ("run_type" IN ('seed','daily','enrich','score'));

ALTER TABLE "pipeline_runs" ADD CONSTRAINT "pipeline_runs_status_check"
  CHECK ("status" IN ('running','completed','failed','partial'));

-- ─── Partial Indexes (hand-edited — Prisma cannot express WHERE clauses) ─────

CREATE INDEX "idx_briefing" ON "companies"("pinned", "score") WHERE "dismissed" = false;
CREATE INDEX "idx_dream100" ON "companies"("last_touch_date") WHERE "dream100" = true;
CREATE INDEX "idx_reentry" ON "companies"("has_new_signal", "state") WHERE "has_new_signal" = true;
CREATE INDEX "idx_state_score" ON "companies"("state", "score" DESC);
CREATE INDEX "idx_state_funding" ON "companies"("state", "funding_stage");
CREATE INDEX "idx_team_size" ON "companies"("team_size", "state");

-- ─── Score Decay View (hand-edited — Prisma doesn't model views) ─────────────

CREATE OR REPLACE VIEW "companies_scored" AS
SELECT *,
  CASE
    WHEN "original_score" IS NOT NULL AND "scored_at" IS NOT NULL THEN
      CAST("original_score" * GREATEST(0.0,
        CASE
          WHEN EXTRACT(EPOCH FROM (now() - "scored_at")) / 86400.0 <= 30 THEN 1.0
          WHEN EXTRACT(EPOCH FROM (now() - "scored_at")) / 86400.0 <= 60 THEN 0.75
          WHEN EXTRACT(EPOCH FROM (now() - "scored_at")) / 86400.0 <= 90 THEN 0.50
          ELSE 0.0
        END
      ) AS INTEGER)
    ELSE COALESCE("score", 0)
  END AS "effective_score"
FROM "companies";
