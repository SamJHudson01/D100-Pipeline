---
name: prospect
description: This skill should be used when the user asks to "find prospects", "prospect", "run prospecting", "find startups", "qualify companies", "daily prospect scan", "seed the pool", or invokes /prospect. Identifies and qualifies 3-5 startup prospects matching TestKarma's ICP from a persistent pool of thousands of companies sourced from YC, ProductHunt, accelerator directories, and SBIR.gov. Two modes: seed (build pool) and daily/pipeline (pick, filter, enrich, score, report).
---

# Prospect Qualifier v2

Identify and qualify 3-5 startup prospects per day matching TestKarma's ICP. Maintain a persistent Neon Postgres pool of thousands of companies. Two run modes: **seed** builds the pool, **daily** picks, filters, enriches, scores, and reports.

## Setup (First Run Only)

1. Install Python dependencies:
   ```
   pip install -r requirements.txt
   ```
2. Verify `.env` contains `DATABASE_URL` and `FIRECRAWL_API_KEY`. The Python sidecar reads Postgres connection details from `DATABASE_URL`.
   ```
   cat .env
   ```
3. If the database schema has not been applied yet, deploy the Prisma migrations:
   ```
   npx prisma migrate deploy
   ```

**Legacy note:** `scripts/init_db.py` and `scripts/migrate_to_neon.py` are SQLite-era utilities kept for historical migration work. Do not use them for fresh setups.

---

## Run Modes

### Seed Mode (`/prospect seed`)

Goal: Build the pool. Run once initially, then periodically to refresh with new companies.

**Step 1 — Gather.** Run your custom gathering scripts to populate the pool:
```bash
python scripts/gather_yoursource.py
```

See `scripts/gather_example.py` for the template. Each script calls `pool_db.upsert_company()` to insert companies into the Neon Postgres pool via `DATABASE_URL`. If a script fails, log the error and continue — partial results are acceptable.

**Step 2 — Display pool stats.** Query the pool for totals by state:
```bash
python scripts/pool_db.py stats
```

Report the total pool size, new additions, and breakdown by source.

---

### Daily Mode (`/prospect` or `/prospect daily` or `/prospect daily {region}`)

Goal: Pick candidates from pool, pre-filter, enrich, score, report. Five phases, executed sequentially.

**Region selection:** Ask the user which region to prospect in before starting. Accepted values: `uk`, `global`, or `all` (default). The chosen region is passed to the pick command and determines which slice of the pool to draw from. Example: `/prospect daily uk` prospects only UK-region companies.

---

#### Phase 1: Pick

Start the run through the pipeline entrypoint so the batch is logged in `pipeline_runs` and emitted as JSON:

```bash
python3 scripts/pipeline.py --region {region}
```

This prints a JSON payload with `run_id`, `region`, and `batch`. Use that batch for the rest of the skill run.

Use `python3 scripts/pipeline.py --pick --batch-size 20 --region {region}` only for ad hoc inspection or debugging. The normal `/prospect` run should use the full pipeline entrypoint above.

If fewer than 20 unenriched candidates remain, run seed mode first.

**⚠️ NEVER filter candidates by URL status.** Do NOT add `WHERE domain NOT LIKE 'nourl:%'` or any URL-based filter to the pick query. Companies with missing URLs (`nourl:` prefix), empty descriptions, or malformed domains are **still candidates** — their data gets fixed in Phase 2 Step 1. Filtering them out in SQL silently discards prospects that may be excellent ICP fits.

---

#### Phase 2: Pre-Filter (LLM In-Context)

Conserve Firecrawl credits by filtering out obvious non-fits before enrichment. The default is PASS. Rejection requires proof.

**Step 1: Fix missing data first.**
Before classifying ANY company, scan the full list for missing or malformed data (no URL, `nourl:` prefix, empty description). For each one, run a quick WebSearch (`"{company name}"`) to find the correct domain/URL. Update the record with the found URL and domain before proceeding to classification.

**⚠️ CRITICAL: A missing URL is NOT a reason to skip, filter out, or reject a company.** URLs can almost always be found with a quick search. NEVER skip a company because of bad pool data. NEVER add URL-based WHERE clauses to SQL queries. The fix is always to SEARCH for the URL, not to exclude the company. If you catch yourself writing SQL that filters by `nourl:` or NULL URLs — stop, that is wrong.

**Step 2: Confirm region with a quick search.**
If prospecting a specific region (not "all"), verify each company actually belongs to that region. Run a quick WebSearch (`"{company name}" headquarters OR "based in"`) and check whether the company is genuinely located in the target region. Companies that are clearly based elsewhere (e.g., a US company showing up in the UK pool because a UK VC invested in them) should be rejected with reason "not based in {region}". This does NOT count against the 5-rejection cap since it is a data quality issue, not a judgment call.

**Step 3: The Loom Test.**
Before classifying, apply this test to every company: **"Could I record a 2-minute Loom walkthrough of their homepage that clearly shows growth opportunities?"** This is the single most important filter. If the product is too technical, too niche, or too meta, the outreach won't land.

**Reject if ANY of these are true:**

1. **Marketing/growth/analytics platform.** Companies that sell marketing tools, growth platforms, analytics dashboards, or CRO products will think they already have growth covered. They are not going to hire a growth consultancy. Examples: customer intelligence platforms, marketing automation tools, A/B testing products.

2. **Deep-tech or hard-to-explain product.** If you can't explain what the company does in one plain sentence, the founder conversation will be too technical for a growth consultancy pitch. Examples: commodity price AI, EV fleet financing infrastructure, quantum computing, semiconductor tooling, manufacturing execution systems.

3. **Not a "proper startup."** The ICP is companies building consumer or B2B SaaS products that normal people can understand — where growth experimentation on signups, activation, and conversion makes obvious sense. Infrastructure companies, developer tools, and enterprise middleware are poor fits even if they technically match on size and funding.

4. **Physical product / non-software.** Retail, restaurants, hardware manufacturers, biotech labs, construction materials. No software = no growth levers.

5. **Not a company at all.** Accelerator program names, cohort labels, city names, conferences, or events scraped from directories.

**The "pass" test:** Ask yourself — "Is this a SaaS product where more people signing up and using it is the core growth challenge?" If yes, pass. If the growth challenge is enterprise sales cycles, deep-tech partnerships, or regulatory approvals, skip.

**Do NOT penalise small funding amounts or small teams.** A company with £300K in grants + accelerator backing and 3 people is a normal early-stage startup. Grants, small raises, and accelerator funding all count as funding signals. A 3-person company with Techstars or YC backing is a STRONGER signal than a 30-person company with no backing. Only disqualify on funding if there is literally zero funding AND zero traction signals. NEVER use "too early" or "too small" as a reason to skip a company that otherwise passes the Loom test and has any form of backing.

**Note on non-company entries:** Pool sources like accelerator directories sometimes produce entries that are program names, cohort labels, or city names rather than actual companies (e.g., "FinTech Amsterdam", "Commerce Melbourne", "Afritech ASIP"). These should be rejected with reason "not a company — accelerator program/cohort name". This does NOT count against the 5-rejection cap since they aren't companies at all.

**Update the pool:**
- Mark rejected companies as `pre_filter_rejected` with a one-sentence reason.
- Mark all others as `pre_filtered`.

Proceed to Phase 3 with all `pre_filtered` companies (max 15).

---

#### Phase 3: Enrich

Process each pre-filtered company ONE AT A TIME (max 15 companies). For each company, do TWO enrichment passes:

---

**Pass A — LLM Web Research (YOU do this).** Before running any scripts, search for the company yourself using WebSearch. This is the single most important enrichment step — a lazy Pass A produces a bad score and wastes everyone's time downstream.

**Step 0: Check existing enrichment data.** Before searching, read the company's `enrichment_data` from the database. If it already contains data from a previous enrichment run (e.g. Perplexity batch), note what's already populated and SKIP searches that would duplicate it.

```bash
python3 -c "
import sys, json; sys.path.insert(0, 'scripts')
from pool_db import get_db
import psycopg2.extras
conn = get_db()
cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
cur.execute('SELECT enrichment_data, team_size, funding_stage FROM companies WHERE domain = %s', ('DOMAIN_HERE',))
row = cur.fetchone()
if row and row['enrichment_data']:
    print(json.dumps(row['enrichment_data'], indent=2, default=str))
else:
    print('No existing enrichment')
conn.close()
"
```

**Determine which searches to run.** Check the existing data against this table:

| Search | Skip if enrichment_data already has |
|--------|-------------------------------------|
| #1 funding | `fundingAmount` AND `fundingStage` both populated |
| #2 founder linkedin | Never skip — always needed for personalisation |
| #3 team size | `employeeCount` is populated with a number |
| #4 growth leadership | Never skip — hard disqualifier check |
| #5 founder background | Never skip — always needed for personalisation |

**Required searches (run all that aren't skipped):**

1. `"{company name}" {domain} funding` — Crunchbase profiles, funding announcements, press coverage. **Skip if funding data already exists.**
2. `"{company name}" founder CEO linkedin` — founder names, LinkedIn profiles, bios, background. **Always run.**
3. `"{company name}" employees team size OR headcount` — headcount from LinkedIn, Crunchbase, or press. **Skip if team size already exists.**
4. `"{company name}" "head of growth" OR "growth lead" OR "marketing director" OR "VP marketing"` — existing growth/marketing leadership. **Always run.**
5. `"{founder name}" {company name}` — founder's background, previous companies, expertise areas. **Always run.**

**Why search 4 and 5 matter:** If the company already has dedicated growth leadership, or the founder is a growth expert themselves, the ICP score changes dramatically. Missing this wastes a Dream 100 slot on a company that doesn't need TestKarma.

From the search results (combined with any existing enrichment data), extract and record in a JSON object:
- **Founders:** Full names, titles, LinkedIn URLs. Search until you find LinkedIn — it's almost always there.
- **Founder background:** Previous companies, expertise areas, notable achievements. This is critical for personalisation later.
- **Team size:** Use existing value if already populated, otherwise extract from search results. Note the source.
- **Funding:** Use existing values if already populated, otherwise extract from search results. Note the source.
- **Founded year**
- **HQ location**
- **Recent news:** Relevant articles only — funding announcements, product launches, partnerships, hires. Include the URL for each article. Filter out unrelated results. Max 5 articles.
- **Growth leadership status:** Does the company already have a Head of Growth, VP Marketing, Growth Lead, or similar dedicated growth role? Name the person if found. This is a HARD DISQUALIFIER check — not optional.

Write the research JSON to `/tmp/research_{domain}.json` for the enrichment pipeline to pick up. Include ALL data — both newly searched and carried forward from existing enrichment.

**Validation gate — do NOT move to the next company until you have:**
- [ ] At least one founder name with LinkedIn URL
- [ ] Founder background (previous companies or expertise)
- [ ] Team size from a named source (existing enrichment counts)
- [ ] Funding stage/amount OR confirmation that the company is bootstrapped (existing enrichment counts)
- [ ] Growth leadership check completed (found someone OR confirmed nobody exists)
- [ ] At least 1 recent news article with URL

If any of these are missing after your searches, run 1-2 more targeted searches to fill the gap. Only move on when the checklist is complete or you've exhausted 7 searches for a single company.

**Rules for web research:**
- Source-attribute every fact: "Crunchbase snippet", "TechCrunch article", "LinkedIn company page"
- If you can't find a fact after dedicated searching, record `null` — never fabricate
- Flush all search results from context after writing the JSON, before starting the next company

---

**Pass B — Automated enrichment pipeline.** After writing the research JSON, run the Python pipeline which handles deterministic checks:

```bash
python -m scripts.enrichers --domain "example.com" --name "Example Co" --url "https://example.com" --research /tmp/research_example.com.json
```

The pipeline runs:
- **ATS check:** Greenhouse/Lever/Ashby for open roles and growth hire detection
- **DNS/HTTP headers:** Hosting provider, CDN, email provider (zero cost)
- **Website scrape:** Homepage analysis for CTA type, social proof, pricing/signup detection
- **Tool detection:** Growth stack tools from page HTML
- **LinkedIn finder:** Google search for founder LinkedIn profile URLs
- **Email finder:** Pattern generation + SMTP verification using founder name from Pass A

Results are written to the pool database. The research JSON from Pass A is merged into the enrichment data.

**⚠️ Tool detection is a weak signal.** Detected (or missing) tools in page HTML are unreliable indicators of ICP fit. Many companies load analytics/experimentation tools server-side, via tag managers, or behind auth. Do NOT use tool detection or growth gaps as primary qualification signals. Use them as conversation context only — never as reasons to qualify or disqualify.

**Important:** The ATS field `has_growth_hire` means the company is **hiring for** a growth/marketing role. This is a POSITIVE signal — it means they DON'T currently have one. Score growth hire absence as 5 (maximum) when ATS shows open growth roles.

After enrichment completes for a company, **flush all raw page content and search results from context** before processing the next company.

---

#### Phase 3.5: Deep Research (Agent-Dispatched)

After ALL companies have completed enrichment (Phase 3), dispatch deep research for each enriched company before scoring. This research produces founder deep-dives, growth challenges, CRO opportunities, and outreach angles that feed into qualification.

**For each enriched company, use the Agent tool to spawn a subagent. In Codex, this should run the repo's `/research` workflow for that domain:**

```
Agent tool:
  description: "Research {company name}"
  prompt: "Run the /research workflow for {domain}"
```

Spawn agents for all enriched companies in parallel — they are independent. Wait for all agents to complete before proceeding to Phase 4.

If an agent fails, note it and continue — the company can still be scored on enrichment data alone, but the score will be less informed.

After all research agents complete, the `research_data` JSONB column will be populated for each company. Phase 4 (scoring) uses this data alongside enrichment data.

**Why this matters:** The deep research catches disqualifying signals that basic enrichment misses — existing growth leadership, founder expertise in growth, and specific company context that changes the ICP fit assessment. Without it, unqualified companies waste Dream 100 slots.

---

#### Phase 4: Qualify (Two-Phase LLM Scoring)

Read `references/icp-criteria.md` and `references/scoring-rubric.md`. Process each enriched company one at a time with two sequential passes.

**Before scoring each company, read the research data from the database:**

```bash
python3 -c "
import sys, json; sys.path.insert(0, 'scripts')
from research_db import get_db, get_enrichment_data
import psycopg2.extras
conn = get_db()
cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
cur.execute('SELECT research_data FROM companies WHERE domain = %s', ('DOMAIN_HERE',))
row = cur.fetchone()
if row and row['research_data']:
    print(json.dumps(row['research_data'], indent=2, default=str))
else:
    print('No research data')
conn.close()
"
```

This was written by the Phase 3.5 research agents. Use it alongside enrichment data for scoring.

**Pass 1 — Fact Extraction.** Extract ONLY observable facts from the enrichment data AND research data. Never infer or fabricate:
- Team size (about page, team page, ATS job count)
- Funding (source data, SEC EDGAR, website mentions)
- Growth motion (self-serve signup, free tier, demo-required, pricing page)
- Traction signals (customer logos, testimonials, integrations, changelog)
- Growth/marketing hires (ATS open roles, team page titles, **research_data.painPointHypotheses showing existing growth leadership**)
- Founder background (**research_data.prospectIntel** — previous companies, expertise areas, growth experience)
- Founder presence (linked socials, blog authorship)
- Timing signals (recent funding, recent launch, hiring burst)

**⚠️ Research data is the most reliable source for growth leadership and founder background.** If research_data found a Head of Growth or the founder has growth expertise, this overrides weaker signals from ATS checks or enrichment.

For each fact, note source and confidence. If no evidence exists, state "No evidence found" — do NOT guess.

**Pass 2 — ICP Scoring.** Using ONLY extracted facts from Pass 1:
1. Apply hard disqualifiers first. If ANY triggers, mark `disqualified` with reason, skip remaining criteria.
2. Score each criterion 1-5 per the rubric definitions.
3. Assign confidence: HIGH (direct evidence), MEDIUM (indirect), LOW (weak signal), UNKNOWN (no evidence, score 0).
4. Multiply score x weight per criterion. Sum for total (0-100).
5. Determine verdict: >= 70 QUALIFY, 50-69 NURTURE, < 50 SKIP.
6. Write 2-3 key signals and a recommended action.
7. If 3+ criteria have UNKNOWN confidence, flag as "insufficient data" regardless of score.

Update each company's pool record with score, verdict, and state (`qualified`, `nurture`, or `disqualified`).

---

#### Phase 5: Report

Pipe scored companies through the output script:
```bash
echo '[...scored companies json...]' | python scripts/output_formats.py --date YYYY-MM-DD
```

Generates three files in `prospects/`:
- `shortlist-{date}.md` — Markdown report
- `shortlist-{date}.json` — Machine-readable JSON
- `shortlist-{date}.csv` — Spreadsheet-compatible CSV

Display the markdown report in the terminal. Include pool health summary: total pool size, today's enrichment count, qualified/nurture/skip/disqualified breakdown.

---

## Reference Files

Consult during qualification phases:

- **`references/icp-criteria.md`** — ICP definition, hard disqualifiers, target profile. Read in Phase 2 and Phase 4.
- **`references/scoring-rubric.md`** — Per-criterion scoring definitions, weights, confidence levels. Read in Phase 4.
- **`references/sources.md`** — Data source configuration, endpoints, rate limits. Read during seed mode.

---

## Scripts

All scripts live in `scripts/`. They handle data fetching and formatting — the LLM handles judgment.

| Script | Purpose |
|---|---|
| `pipeline.py` | Current pipeline entrypoint: creates `pipeline_runs`, emits the batch JSON, reports pool stats, and supports score decay via flags |
| `pool_db.py` | Shared pool database utilities; CLI for stats and pick operations |
| `research_db.py` | Deep research queue helpers used by the separate `/research` skill |
| `gather_example.py` | Template for writing your own gathering scripts — shows the `upsert_company()` interface |
| `enrich_website.py` | Website scraping via Firecrawl with curl fallback, 7-day cache |
| `enrich_ats.py` | Greenhouse/Lever/Ashby public API checks for open roles |
| `enrich_funding.py` | Multi-source funding detection (pool data, SEC EDGAR, website) |
| `output_formats.py` | Markdown, JSON, CSV report generation |

---

## Boundaries

### Always
- Use Neon Postgres via `DATABASE_URL` for all persistent state — no JSON file pools
- Run LLM pre-filter before spending Firecrawl credits on enrichment
- Check ATS boards for every enriched company (growth hire detection)
- Check multiple sources for funding and team size signals
- Flush raw page content from context after fact extraction — never hold 2+ companies' raw content simultaneously
- Include confidence levels and evidence source for every scoring criterion

### Ask First
- Adding new pool sources
- Changing hard disqualifier criteria
- Resetting or clearing the prospect pool
- Installing new Python packages

### Never
- Scrape LinkedIn or any authenticated platform
- Send outreach of any kind
- Use paid APIs beyond Firecrawl
- Fabricate or infer company information not present in source data
- Hold 2+ companies' raw website content in context simultaneously
- Store API keys in SKILL.md or scripts
- Filter candidates out of SQL queries by URL status (`nourl:`, NULL URL, malformed domain) — fix the data instead
