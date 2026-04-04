# Spec: Deep Research

**Date:** 2026-03-23
**Status:** Draft

## Objective

Add an operator-initiated deep research step between Dream 100 selection and Loom recording. The existing enrichment pipeline produces enough data to qualify a company but not enough to personalise outreach. This feature automates the manual research the operator currently does before every Loom — founder deep-dives, growth challenges, CRO opportunities, and outreach angles — and surfaces it in the web dashboard.

## Context

The pipeline today: seed → enrich → score → triage → Dream 100 → **manual research** → record Loom → mark contacted. The manual research gap means the operator spends 10-20 minutes per company Googling the founder, reading their content, and figuring out what to say. The enrichment_data JSONB column stores qualification data (firmographics, tools, scoring). Research output is a separate concern with a different schema, different production process (manual agent skill such as Codex, not Python scripts), and different staleness model (research doesn't decay).

Three connected pieces: a job queue in Neon, a manual coding-agent skill (`/research`) that processes jobs, and UI integration on the brief page + a dedicated research page.

## Scope

### In scope
- `research_jobs` table with status lifecycle (pending → in_progress → completed/failed)
- `research_data` JSONB column on companies table (separate from enrichment_data)
- "Request Research" button on brief page with status-aware states
- Research summary card on brief page (renders when research_data exists)
- `/research/{domain}` full-page formatted research view
- Manual-agent `/research` skill that reads pending jobs, runs multi-phase web research, writes results back
- tRPC `research` router with request/status/full procedures
- Extend `company.brief` response to include research job status

### Out of scope
- Re-research (v1: once written, research_data is final)
- Real-time progress updates in web UI during research
- Batch "research all" button in web UI
- Research quality scoring or validation
- Research staleness/decay
- Loom script generation

### Non-goals
- Replacing the enrichment pipeline — research augments it, doesn't duplicate it
- Automatic research triggering — always operator-initiated

## Stories

### Story 1: Requesting research from the brief page

**When** I'm reviewing a company brief and decide I want deeper research before recording a Loom, **I want to** click a button to queue research, **so I can** continue triaging other companies while research happens asynchronously.

**Acceptance Criteria:**

Given a company brief with no existing research and no pending job
When the operator clicks "Request Research"
Then a pending job is created and the button changes to "Research Queued"

Given a company brief with a pending or in-progress research job
When the operator views the brief
Then the button shows the current status (queued or researching) and is not clickable

Given a company brief where research_data already exists
When the operator views the brief
Then the request button is hidden and the research summary card is visible instead

Given the operator clicks "Request Research" and a pending job already exists for this domain
When the request is submitted
Then no duplicate job is created (idempotent)

### Story 2: Processing the research queue via Codex

**When** research jobs are pending in the queue, **I want to** run `/research` in Codex (or another manual coding agent) to process them, **so I can** produce deep research dossiers without manual Googling.

**Acceptance Criteria:**

Given one or more pending research jobs in the queue
When the operator runs `/research`
Then each job is picked up, status set to in_progress, and the research pipeline runs

Given the skill is researching a company
When the research pipeline completes all phases
Then structured results are written to the company's research_data column, the job status is set to completed, and a confirmation is output to the terminal

Given the skill is researching a company and a phase fails
When an individual phase encounters an error
Then remaining phases continue executing and partial results are still written

Given the skill is invoked with `/research {domain}`
When a pending job exists for that domain
Then only that company's job is processed

Given the skill is invoked for a company that already has research_data
When the skill checks the company
Then it skips the company and reports that research already exists

Given no pending jobs exist in the queue
When the operator runs `/research`
Then the skill reports that the queue is empty and exits

### Story 3: Viewing research summary on the brief page

**When** research has completed for a company, **I want to** see a summary on the brief page, **so I can** quickly decide if the research is strong enough to record a Loom or if I need to open the full page.

**Acceptance Criteria:**

Given a company with completed research_data
When the operator views the brief page
Then a research summary card appears below the Intelligence section showing the 3-4 sentence summary and a link to the full research page

Given a company with no research_data
When the operator views the brief page
Then no research summary card renders

### Story 4: Reading full research before recording a Loom

**When** I'm about to record a personalised Loom, **I want to** read the full research on a dedicated page, **so I can** reference outreach angles, founder insights, and talking points on a second monitor.

**Acceptance Criteria:**

Given a company with completed research_data
When the operator opens `/research/{domain}`
Then they see a full-page formatted view with: summary, outreach angles with talking points, founder deep-dive with linked sources, growth challenges with source URLs, and CRO opportunities

Given the research page is open
When the operator clicks any source URL
Then it opens in a new tab

Given a company with no research_data
When the operator navigates to `/research/{domain}`
Then they see an empty state explaining research hasn't been run, with a link back to the brief

Given the research data has sections with no findings (e.g., no CRO opportunities found)
When the operator views the research page
Then those empty sections are not rendered

## Boundaries

### ✅ Always
- Follow conventions.md for all Prisma schema, tRPC, and frontend patterns
- Use `--create-only` for migrations; review SQL before applying
- Keep research_data completely separate from enrichment_data — different columns, different schemas, different processes
- Source-attribute every research finding — include URLs for all referenced content
- Use the company's existing enrichment_data as a head start in the skill to avoid redundant searches

### ⚠️ Ask first
- Database schema changes (the new table and column)
- Adding new tRPC router (research router)
- Creating new route (`/research/{domain}`)

### 🚫 Never
- Modify the enrichment_data column or enrichment pipeline
- Overwrite existing research_data (no re-research in v1)
- Scrape LinkedIn or any authenticated platform
- Store raw web search results in the database — only store structured, extracted findings
- Auto-trigger research without explicit operator action

## Data Shape

The `research_data` JSONB column stores:

- **founder_deep_dive** — published content (linked), talks/appearances (linked), opinions/positions, social activity (Twitter topics, LinkedIn posting)
- **growth_challenges** — signal, source (linked), implication
- **cro_opportunities** — observation, page/flow, severity (high/medium/low), TestKarma angle
- **outreach_angles** — hook, why it works, talking points (this is the primary output)
- **summary** — 3-4 sentence BLUF optimised for scanning before a Loom

## Success Metrics

- Operator spends under 2 minutes reviewing research before recording a Loom (down from 10-20 minutes of manual research)
- Research produces at least 2 outreach angles with source-attributed talking points per company
- 5-15 web searches per company (efficient use of manual-agent context)

## Assumptions

- The manual coding-agent skill has access to web search during `/research` execution (confirmed — same as existing `/prospect` skill)
- The operator will run `/research` manually in Codex after requesting from the UI (confirmed — no automatic bridge between web UI and the coding agent)
- Neon Postgres supports gen_random_uuid() for job IDs (confirmed — Postgres 13+)

---

*After implementing, compare results against each acceptance criterion above and list any unmet requirements.*
