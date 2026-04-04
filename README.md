# Prospectatron

A full-stack B2B prospecting pipeline that enriches companies with firmographic data, scores them against your ICP, deep-researches founders for personalisation, and manages outreach through a Dream 100 sequence. Built for a growth consultancy's daily workflow, now open-sourced as a reference implementation of what's possible when you wire [Claude Code](https://docs.anthropic.com/en/docs/claude-code) skills into a real product.

## But why?

Cold outreach at scale is a solved problem. Cold outreach that actually converts is not. The difference is research depth — knowing what a founder wrote on their blog last month, what their pricing page is missing, why their signup flow has friction. That research takes 10-20 minutes per company. Multiply by a Dream 100 list and you've burned your entire week on tab switching.

Prospectatron automates the boring parts (firmographics, scoring) and the time-consuming parts (founder deep-dives, CRO opportunity spotting, outreach angle generation) while keeping the human in the loop for judgment calls. The operator decides who to pursue and what to say. The system does the legwork.

This was built for my own daily use with no initial intention to release it. It's tuned to a specific ICP (B2B SaaS startups that need growth help) and a specific outreach method (personalised Loom recordings). Adapting it to your ICP and outreach style is straightforward — the pipeline structure is universal, only the scoring rubric and skill instructions change.

**You bring your own companies.** Prospectatron doesn't ship with scraping scripts for specific platforms. Instead, it gives you `pool_db.upsert_company()` — a simple Python interface to insert companies from whatever sources you have. CSV export from LinkedIn Sales Navigator, a CRM dump, an API call to Crunchbase, a manual list — the pipeline doesn't care where the companies come from. See `scripts/gather_example.py` for the template.


## The Two-Interface Architecture

This is the interesting part. Prospectatron isn't just a dashboard or just a CLI tool — it's both, sharing a single Postgres database as the contract between them.

```
┌─────────────────────┐         ┌───────────────┐         ┌──────────────────────┐
│   Claude Code CLI   │         │               │         │   Next.js Dashboard  │
│                     │         │  Neon Postgres │         │                      │
│  /prospect          │────────▶│               │◀────────│  /pool               │
│  /research          │         │  companies    │         │  /triage             │
│                     │         │  research_jobs│         │  /brief/{domain}     │
│  Python enrichers   │────────▶│  touchpoints  │         │  /dream-100          │
│                     │         │  pipeline_runs│         │  /dream-100/pipeline │
│                     │         │               │         │  /research/{domain}  │
└─────────────────────┘         └───────────────┘         └──────────────────────┘
```

**The dashboard** is a read-heavy operator interface. You browse the pool, triage prospects in a card-stack UI, read company briefs with score breakdowns and intelligence cards, track outreach sequences, and drag companies across a Kanban pipeline board. It can trigger work (clicking "Request Research" creates a pending job in the database) but it doesn't do the heavy lifting.

**Claude Code** is where the intelligence work happens. The `/prospect` skill runs the full pipeline — picking candidates, pre-filtering with LLM judgment, running Python enrichment scripts, scoring against 7 ICP criteria. The `/research` skill claims pending research jobs from the database, runs 5-phase web research (founder deep-dive, growth challenges, CRO opportunities, synthesis), and writes structured dossiers back. The dashboard picks them up on next load.

**The handoff is the database.** The dashboard creates a research job row with `status: pending` and shows the operator "Open Claude Code and run `/research`". Claude Code claims the job with `FOR UPDATE SKIP LOCKED`, does the work, writes results. No WebSocket, no polling, no shared process. Just Postgres as a job queue.

There's also an automated path — an OpenRouter worker that long-polls for pending jobs and processes them without human involvement. The dashboard lets you choose "Run with OpenRouter" vs "Request Research (Claude Code)" per company.


## The Pipeline

```
Your data  →  /prospect daily  →  Dashboard /triage  →  /research  →  Dream 100
   │                │                    │                   │              │
  CSV, API,      5 phases:          Card-stack UI:      5-phase web    8-step, 30-day
  CRM export,   1. Pick 20         select / skip /     research per    outreach sequence
  manual list   2. Pre-filter      snooze / dismiss    company with    with Kanban board
  into pool     3. Enrich                              founder deep-   and touchpoint
                4. Score                               dive, CRO       logging
                5. Report                              analysis
```

### Seed — Bring Your Own Companies

Prospectatron ships with a template (`scripts/gather_example.py`) and a database interface (`pool_db.upsert_company()`). You write gathering scripts for your sources. The contract is simple:

```python
from pool_db import get_db, upsert_company

conn = get_db()
upsert_company(
    conn,
    domain="example.com",
    name="Example Corp",
    url="https://example.com",
    description="What they do in one sentence.",
    source="your_source_name",        # Tag for filtering in the dashboard
    source_data={"batch": "W24"},     # Optional metadata
)
conn.commit()
```

The upsert is atomic — `INSERT ON CONFLICT` merges duplicates, deduplicates sources, and patches metadata. Run the same script twice and nothing breaks. Write as many gather scripts as you need for your sources and add them to the `make seed` target.

### Daily Pipeline — Pick, Filter, Enrich, Score, Report

The `/prospect` skill runs 5 sequential phases:

1. **Pick** — `pipeline.py` selects 20 unenriched candidates from the pool, creates a `pipeline_runs` audit record, emits a JSON batch.

2. **Pre-filter (LLM)** — Claude Code applies qualification logic you define in the skill. The default uses a "Loom Test": could you record a 2-minute walkthrough of their product showing growth opportunities? Rejects obvious non-fits. Fixes missing URLs via web search. Max 15 companies proceed.

3. **Enrich (two passes per company)** — Pass A: Claude Code does web research (funding, founders, team size, growth leadership, recent news). Pass B: Python enrichers run automated checks:

   | Enricher | What it does | Cost |
   |----------|-------------|------|
   | `web_search.py` | Perplexity Sonar via OpenRouter | ~$0.15/1k companies |
   | `website_scrape.py` | Firecrawl homepage analysis | Per-credit |
   | `dns_headers.py` | Hosting, CDN, email provider detection | Free |
   | `tool_detection.py` | Growth stack tools from page HTML | Free |
   | `enrich_ats.py` | Greenhouse/Lever/Ashby job boards | Free |
   | `email_finder.py` | Pattern generation + SMTP verify | Free |
   | `linkedin_finder.py` | Google search for founder LinkedIn | Free |

4. **Score** — Two-pass LLM scoring. Pass 1 extracts observable facts. Pass 2 scores 1-5 on 7 weighted criteria. Score 0-100 with time decay (100% at 0-30 days, 75% at 31-60, 50% at 61-90, 0% after 90). Criteria and weights are defined in `references/scoring-rubric.md` — edit to match your ICP.

5. **Report** — Generates markdown, JSON, and CSV shortlists.

### Triage — Morning Briefing

The dashboard shows the top 5 qualified prospects at `/triage`. Swipe through them: **Select** (add to Dream 100), **Skip** (nurture), **Snooze** (revisit later), **Dismiss** (remove). Keyboard shortcuts for speed.

### Research — Deep Personalisation

For each company you select, request deep research from the brief page. The `/research` skill runs 5 phases with 5-15 web searches:

1. **Scope** — Parse existing enrichment data, plan searches
2. **Founder deep-dive** — Blog posts, podcast appearances, LinkedIn activity, opinions
3. **Growth challenges** — G2 reviews, shipping velocity, growth hiring signals
4. **CRO opportunity spotting** — Pricing page analysis, signup friction, social proof gaps
5. **Synthesis** — Structured dossier with pain point hypotheses and personalisation hooks

The output is a structured JSON dossier with source-attributed findings. The dashboard renders it at `/research/{domain}` with sections for Company Intel, Prospect Intel, Pain Points, and Personalisation Hooks.

### Outreach — Dream 100

An 8-step, 30-day sequence:

| Day | Step | Channel |
|-----|------|---------|
| 1 | Personalised Loom | Video |
| 2 | LinkedIn connect | LinkedIn |
| 4 | Comment on their post | LinkedIn |
| 7 | Value-add email | Email |
| 10 | LinkedIn DM | LinkedIn |
| 14 | Quick question email | Email |
| 21 | Share customer win | Email |
| 30 | Direct ask | Email |

The Dream 100 page tracks sequence progress with days-since-last-touch. The Kanban board at `/dream-100/pipeline` has 6 columns: Backlog, Outreach, Follow-up, Call, Closed, Dead.

## Getting Started

### Prerequisites

- Node.js 22+
- Python 3.11+
- A PostgreSQL database ([Neon](https://neon.tech/) free tier works perfectly)
- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) (for the `/prospect` and `/research` skills)

### Setup

```bash
git clone https://github.com/SamJHudson01/prospectatron.git
cd prospectatron
cp .env.example .env
```

Fill in your `.env`:

```bash
# Required — your Postgres connection
DATABASE_URL=postgresql://user:password@ep-xxx-pooler.region.aws.neon.tech/neondb?sslmode=require
DIRECT_URL=postgresql://user:password@ep-xxx.region.aws.neon.tech/neondb?sslmode=require

# Required for enrichment — website scraping
FIRECRAWL_API_KEY=fc-your-key-here

# Optional — enables automated research worker
OPENROUTER_API_KEY=sk-or-your-key-here

# Optional — news relevance filtering in enrichment
ANTHROPIC_API_KEY=sk-ant-your-key-here
```

Then:

```bash
make setup    # Installs Node + Python deps, generates Prisma client
make migrate  # Applies database migrations
make dev      # Starts the dashboard at http://localhost:3005
```

### Populating the pool

Write a gathering script for your data source (see `scripts/gather_example.py`), then:

```bash
python scripts/gather_yoursource.py
python scripts/pool_db.py stats          # Check pool health
```

Or open Claude Code and run `/prospect seed`.

### With Docker

```bash
cp .env.example .env    # Fill in your keys
docker compose -f docker/docker-compose.yml up -d
```

This starts Postgres + the Next.js app. The dashboard is at `http://localhost:3005`.

### Install the Claude Code skills

As a plugin:

```bash
claude plugin install prospectatron
```

Or symlink manually:

```bash
ln -s $(pwd)/skills/prospect ~/.claude/skills/prospect
ln -s $(pwd)/skills/research ~/.claude/skills/research
```

Then open Claude Code in the project directory and run `/prospect daily` to run a pipeline.


## Adapting for Your Use Case

The pipeline is generic. The judgment criteria are specific. To make Prospectatron yours:

1. **Write gathering scripts** — Copy `scripts/gather_example.py` and implement your data collection. CSV import, API call, CRM export, web scrape — anything that produces `(domain, name, url, description, source)` tuples.
2. **Edit `references/icp-criteria.md`** — Define your ideal customer profile, hard disqualifiers, and target signals.
3. **Edit `references/scoring-rubric.md`** — Adjust the 7 scoring criteria, weights, and threshold definitions.
4. **Edit the pre-filter rules in `skills/prospect/SKILL.md`** — The qualification logic is in Phase 2. Replace with your own.
5. **Edit `prompts/research-methodology.md`** — The research phases and output schema. Adjust for your outreach style.

The pipeline structure, database schema, dashboard, enrichment scripts, and research system don't change. Only the judgment criteria and data sources.


## Dashboard

| Route | What it does |
|-------|-------------|
| `/pool` | Browse all companies. Search, filter by source/state/region/score, sort by score or team size. Pagination. |
| `/triage` | Morning briefing. Top 5 qualified prospects as swipeable cards. Select, skip, snooze, dismiss. |
| `/brief/{domain}` | Full company dossier. Score breakdown (7 criteria as bar charts), growth maturity meter, key person card, intelligence cards (pricing, signup, social proof, content), timeline, research summary. |
| `/research/{domain}` | Deep research findings. Company intel, prospect personal intel, pain point hypotheses, personalisation hooks. All source-attributed. |
| `/dream-100` | Outreach targets. Sequence progress dots, days since last touch, enrichment snippets, research BLUF. |
| `/dream-100/pipeline` | Kanban board. Drag-and-drop across 6 pipeline stages. Editable notes per card. |
| `/settings` | Pool health. Total companies, state breakdown, top sources, recent pipeline runs. |


## Tech Stack

| Layer | Choice | Why |
|-------|--------|-----|
| Frontend | Next.js 16, React 19 | App Router with SSR prefetch + client hydration. Server Components by default. |
| Styling | CSS Modules + BEM | No Tailwind. Design system with 4px grid, amber accent, dark mode. Warm editorial aesthetic. |
| API | tRPC 11, Zod 4, SuperJSON | End-to-end type safety. One router per entity. Discriminated union results. |
| Database | PostgreSQL via Prisma 7 | Neon-compatible. JSONB for enrichment + research data. CHECK constraints. Serializable isolation for job queue. |
| Query layer | TanStack Query 5 | 30s stale time, retry: false, refetchOnWindowFocus. tRPC cache is source of truth. |
| Enrichment | Python 3 | Parallel execution across 4 tiers with per-tier timeouts. Fail-open design. |
| Research | OpenRouter or Claude Code | Two executor paths. Job queue with `FOR UPDATE SKIP LOCKED`. Lenient schema normalisation. |
| Drag-and-drop | @dnd-kit | Native for Kanban board. |


## Repo Structure

```
prospectatron/
├── .claude-plugin/
│   └── plugin.json          # Claude Code plugin manifest
├── skills/
│   ├── prospect/
│   │   ├── SKILL.md         # /prospect skill — daily pipeline
│   │   └── references/      # ICP criteria, scoring rubric, tool signatures
│   └── research/
│       └── SKILL.md         # /research skill — deep dossiers
├── app/                     # Next.js routes
│   ├── pool/                #   Company explorer
│   ├── triage/              #   Morning briefing card-stack
│   ├── brief/[domain]/      #   Company dossier
│   ├── research/[domain]/   #   Research findings
│   ├── dream-100/           #   Outreach tracking
│   │   └── pipeline/        #   Kanban board
│   ├── settings/            #   Pool health
│   └── api/trpc/            #   tRPC endpoint
├── lib/                     # Shared TypeScript
│   ├── domain.ts            #   State machine, Zod schemas, score decay
│   ├── prisma.ts            #   Database client
│   ├── manual-agent.ts      #   Agent label config
│   ├── trpc/                #   tRPC init, router, 6 entity routers
│   ├── research/            #   Research service, queue, presentation, OpenRouter client
│   └── db/                  #   Serializable transaction retry
├── components/              # Shared React components (badges)
├── prisma/                  # Schema + 14 migrations
├── scripts/                 # Python enrichers + Node dev scripts
│   ├── enrichers/           #   23 Python modules (orchestrator, registry, cache, rate limiter)
│   ├── gather_example.py    #   Template for writing your own data sources
│   ├── pipeline.py          #   Pipeline entrypoint
│   ├── pool_db.py           #   Shared Postgres utilities + upsert_company() interface
│   ├── research_db.py       #   Research queue helpers
│   ├── dev.ts               #   Dev server supervisor
│   └── openrouter-worker.ts #   Automated research worker
├── prompts/                 # LLM methodology (research-methodology.md)
├── references/              # ICP criteria, scoring rubric
├── docker/                  # Docker Compose + Dockerfile
├── Makefile                 # make setup, make dev, make seed, make test
├── package.json
├── tsconfig.json
└── .env.example
```

## Development

```bash
make help              # Show all available commands
make setup             # Install Node + Python deps, generate Prisma
make dev               # Start Next.js + OpenRouter worker
make dev-web           # Start Next.js only (port 3005)
make dev-worker        # Start OpenRouter worker only
make seed              # Run your gathering scripts + show pool stats
make migrate           # Apply Prisma migrations
make test              # Run unit tests (262 tests)
make test-integration  # Run integration tests (requires DB)
make lint              # ESLint
make typecheck         # TypeScript check
make docker            # Docker Compose up
```

## What's Not Built

Being honest about scope:

- No authentication (single-operator tool, no multi-user)
- No bulk actions (no multi-select, no "research all")
- No UI-triggered pipeline (enrichment and scoring run from Claude Code only)
- No sequence step advancement beyond step 1 (the mutation doesn't exist yet)
- No re-research (write-once design in v1)
- No region selector in UI (hardcoded to "uk", backend supports all regions)
- No snooze date picker (field exists in schema, UI always passes null)

## Requirements

- [Node.js](https://nodejs.org/) 22+
- [Python](https://www.python.org/) 3.11+ with pip
- [PostgreSQL](https://www.postgresql.org/) 15+ (or [Neon](https://neon.tech/) free tier)
- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) for the `/prospect` and `/research` skills
- [Firecrawl](https://firecrawl.dev/) API key for website scraping during enrichment

## License

MIT
