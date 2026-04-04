-- Migration 002: Add CHECK constraints on state, verdict, pre_filter_result
-- SQLite can't add constraints to existing columns, so we recreate the table.

CREATE TABLE companies_new (
    domain TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    url TEXT,
    description TEXT,
    source TEXT,
    sources TEXT,
    source_data TEXT,
    state TEXT DEFAULT 'discovered' CHECK(state IN ('discovered','pre_filtered','pre_filter_rejected','enriched','qualified','nurture','skip','disqualified','contacted','stale','dead')),
    priority_score REAL DEFAULT 0.0,
    pre_filter_result TEXT CHECK(pre_filter_result IN ('yes','no','maybe') OR pre_filter_result IS NULL),
    pre_filter_confidence REAL,
    score INTEGER,
    original_score INTEGER,
    scored_at TEXT,
    verdict TEXT CHECK(verdict IN ('qualify','nurture','skip','disqualify') OR verdict IS NULL),
    team_size INTEGER,
    team_size_source TEXT,
    team_size_confidence TEXT,
    funding_stage TEXT,
    funding_evidence TEXT,
    ats_platform TEXT,
    ats_data TEXT,
    enrichment_data TEXT,
    last_enriched TEXT,
    last_scored TEXT,
    -- Triage columns
    snoozed_until TEXT,
    dismissed INTEGER DEFAULT 0 CHECK(dismissed IN (0,1)),
    pinned INTEGER DEFAULT 0 CHECK(pinned IN (0,1)),
    -- Dream 100 columns
    dream100 INTEGER DEFAULT 0 CHECK(dream100 IN (0,1)),
    sequence_step INTEGER,
    sequence_started_at TEXT,
    sequence_paused INTEGER DEFAULT 0 CHECK(sequence_paused IN (0,1)),
    last_touch_date TEXT,
    -- Signal tracking
    has_new_signal INTEGER DEFAULT 0 CHECK(has_new_signal IN (0,1)),
    signal_type TEXT,
    signal_date TEXT,
    -- Extracted hot fields from JSON
    has_pricing_page INTEGER DEFAULT 0 CHECK(has_pricing_page IN (0,1)),
    has_signup INTEGER DEFAULT 0 CHECK(has_signup IN (0,1)),
    has_growth_hire INTEGER DEFAULT 0 CHECK(has_growth_hire IN (0,1)),
    total_ats_roles INTEGER DEFAULT 0,
    -- Pipeline tracking
    last_run_id TEXT,
    -- Timestamps
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO companies_new (
    domain, name, url, description, source, sources, source_data, state,
    priority_score, pre_filter_result, pre_filter_confidence, score, verdict,
    team_size, team_size_source, team_size_confidence, funding_stage,
    funding_evidence, ats_platform, ats_data, enrichment_data,
    last_enriched, last_scored, created_at, updated_at
)
SELECT
    domain, name, url, description, source, sources, source_data, state,
    priority_score, pre_filter_result, pre_filter_confidence, score, verdict,
    team_size, team_size_source, team_size_confidence, funding_stage,
    funding_evidence, ats_platform, ats_data, enrichment_data,
    last_enriched, last_scored,
    COALESCE(created_at, datetime('now')),
    COALESCE(updated_at, datetime('now'))
FROM companies;

DROP TABLE companies;
ALTER TABLE companies_new RENAME TO companies;

-- Recreate indexes
CREATE INDEX idx_state ON companies(state);
CREATE INDEX idx_priority ON companies(priority_score DESC);
CREATE INDEX idx_source ON companies(source);
