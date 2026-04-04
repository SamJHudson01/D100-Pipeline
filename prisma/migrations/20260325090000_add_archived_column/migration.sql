-- Add archived boolean to companies table.
-- Postgres 11+ handles ADD COLUMN with a constant default as metadata-only (no table rewrite).
ALTER TABLE "companies" ADD COLUMN "archived" BOOLEAN NOT NULL DEFAULT false;
