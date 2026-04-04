-- Migration 003: Touchpoints, pipeline_runs, and v3 indexes

-- Touchpoints table (append-only log per company)
CREATE TABLE IF NOT EXISTS touchpoints (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    domain TEXT NOT NULL REFERENCES companies(domain),
    touch_date TEXT NOT NULL,
    channel TEXT NOT NULL CHECK(channel IN ('email','linkedin','loom','twitter','other')),
    type TEXT NOT NULL,
    notes TEXT,
    outcome TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Pipeline runs table (audit + coordination)
CREATE TABLE IF NOT EXISTS pipeline_runs (
    run_id TEXT PRIMARY KEY,
    started_at TEXT NOT NULL DEFAULT (datetime('now')),
    completed_at TEXT,
    run_type TEXT NOT NULL CHECK(run_type IN ('seed','daily','enrich','score')),
    companies_processed INTEGER DEFAULT 0,
    companies_qualified INTEGER DEFAULT 0,
    companies_rejected INTEGER DEFAULT 0,
    status TEXT DEFAULT 'running' CHECK(status IN ('running','completed','failed','partial')),
    summary TEXT,
    region TEXT DEFAULT 'uk'
);

-- Score decay view
CREATE VIEW IF NOT EXISTS companies_scored AS
SELECT *,
    CASE
        WHEN original_score IS NOT NULL AND scored_at IS NOT NULL THEN
            CAST(original_score * MAX(0.0,
                CASE
                    WHEN julianday('now') - julianday(scored_at) <= 30 THEN 1.0
                    WHEN julianday('now') - julianday(scored_at) <= 60 THEN 0.75
                    WHEN julianday('now') - julianday(scored_at) <= 90 THEN 0.50
                    ELSE 0.0
                END
            ) AS INTEGER)
        ELSE score
    END AS effective_score
FROM companies;

-- V3 indexes
CREATE INDEX IF NOT EXISTS idx_briefing ON companies(pinned, score) WHERE dismissed = 0;
CREATE INDEX IF NOT EXISTS idx_dream100 ON companies(last_touch_date) WHERE dream100 = 1;
CREATE INDEX IF NOT EXISTS idx_touchpoints_domain ON touchpoints(domain, touch_date DESC);
CREATE INDEX IF NOT EXISTS idx_reentry ON companies(has_new_signal, state) WHERE has_new_signal = 1;
CREATE INDEX IF NOT EXISTS idx_state_score ON companies(state, score DESC);
CREATE INDEX IF NOT EXISTS idx_state_funding ON companies(state, funding_stage);
CREATE INDEX IF NOT EXISTS idx_team_size ON companies(team_size, state);
