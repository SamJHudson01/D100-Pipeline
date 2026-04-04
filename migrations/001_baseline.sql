-- Migration 001: Baseline
-- Records that the existing schema is in place and creates company_regions if missing.
-- WAL mode persists on the file.

PRAGMA journal_mode=WAL;

CREATE TABLE IF NOT EXISTS company_regions (
    domain TEXT NOT NULL,
    region TEXT NOT NULL,
    PRIMARY KEY (domain, region)
);

CREATE INDEX IF NOT EXISTS idx_company_regions_domain ON company_regions(domain, region);
