---
name: research
description: Process pending deep research jobs from the database. Run /research to process all pending jobs, or /research {domain} for a specific company. Produces structured research dossiers (founder deep-dives, growth challenges, CRO opportunities, outreach angles) for personalised Loom outreach.
---

# Deep Research Skill

Process pending research jobs from Neon Postgres. The web UI creates jobs via the "Request Research" button on the brief page. This skill claims pending jobs, runs multi-phase web research, and writes structured results back to the database.

## Setup

The skill uses the same database connection as the prospect pipeline. Ensure `DATABASE_URL` is set in `.env`.

## Invocation

- `/research` — process all pending jobs in the queue
- `/research {domain}` — research a single company (processes that domain's pending job)

## Workflow

### Step 0: Housekeeping

Before processing any jobs, reap stale jobs and check the queue:

```bash
python3 -c "
import sys; sys.path.insert(0, 'scripts')
from research_db import get_db, reap_stale_jobs, get_pending_count
conn = get_db()
reaped = reap_stale_jobs(conn)
if reaped: print(f'Reaped {reaped} stale jobs')
pending = get_pending_count(conn)
print(f'{pending} pending research jobs')
conn.close()
"
```

If no pending jobs and no domain argument was provided, report the queue is empty and exit.

### Step 1: Claim a Job

If invoked with a specific domain (`/research {domain}`), ensure a pending job exists first — the /prospect pipeline may have created one, or the operator may be requesting directly:

```bash
python3 -c "
import sys; sys.path.insert(0, 'scripts')
from research_db import get_db, ensure_pending_job
conn = get_db()
created = ensure_pending_job(conn, 'DOMAIN_HERE')
print(f'Job created: {created}')
conn.close()
"
```

Then claim it:

```bash
python3 -c "
import sys, json; sys.path.insert(0, 'scripts')
from research_db import get_db, claim_next_job, get_enrichment_data
conn = get_db()
job = claim_next_job(conn, domain='DOMAIN_HERE')  # or domain=None for next in queue
if not job:
    print('No pending jobs')
else:
    print(json.dumps(job, default=str))
    enrichment = get_enrichment_data(conn, job['domain'])
    print('---ENRICHMENT---')
    print(json.dumps(enrichment, indent=2, default=str))
conn.close()
"
```

This atomically claims the job (pending → in_progress). Read the enrichment_data to avoid re-discovering known facts.

### Step 2: Research Pipeline

Process the company through 5 phases. Use the enrichment_data as a head start — do NOT re-search for firmographics (team size, funding, HQ) already in enrichment.

**Budget: 5-15 web searches total across all phases.**

---

#### Phase 1: Scope (no web searches)

Parse the enrichment_data. Note:
- Founder name(s) from `keyPeople`
- Company name and domain
- Funding stage/amount from `webSearch`
- Detected tools from `detectedTools`
- Any existing news from `webSearch.latestNews`

Plan which searches each subsequent phase needs. Skip phases where enrichment already has strong data.

---

#### Phase 2: Founder Deep-Dive (2-4 searches)

Search for the primary founder/CEO identified in enrichment_data.

Searches:
1. `"{founder name}" blog OR medium OR substack` — find published content
2. `"{founder name}" podcast OR conference OR talk OR interview` — find appearances
3. `"{founder name}" {company name} linkedin` — find LinkedIn profile and posting topics

For each finding, record:
- **title** — article/talk/post title
- **url** — MUST be an actual URL from the search results. Never fabricate.
- **platform** / **event** — where it was published/presented
- **date** — if visible
- **summary** — 1-2 sentence description of what they said or wrote

Also note:
- Opinions and positions the founder has expressed publicly
- Social media activity patterns (what they post about, how often)

**Rules:**
- Source-attribute at discovery time. If you can't find a URL, record the finding without one — never invent a URL.
- Flush raw search results from context after extracting findings.

---

#### Phase 3: Growth Challenges (2-4 searches)

Search for signals about the company's growth challenges and current trajectory.

Searches:
1. `"{company name}" G2 OR Capterra OR review` — find user reviews with pain points
2. `"{company name}" changelog OR "product update" OR "new feature"` — shipping velocity
3. `"{company name}" hiring growth OR marketing OR "head of growth"` — growth hiring signals
4. (Optional) `"{company name}" churn OR retention OR onboarding` — if PLG company

For each finding, record:
- **signal** — what you observed (e.g., "3 negative G2 reviews mention onboarding friction")
- **source** — where you found it (e.g., "G2 reviews")
- **sourceUrl** — URL of the source
- **implication** — what this means for TestKarma's outreach angle

**Rules:**
- Only record signals supported by actual search results. Never infer challenges from absence of data.
- Flush raw search results from context after extracting findings.

---

#### Phase 4: CRO Opportunity Spotting (1-3 searches)

Search for the company's pricing page, signup flow, and conversion-relevant pages.

Searches:
1. `site:{domain} pricing` — find their pricing page
2. `site:{domain} signup OR "get started" OR "free trial"` — find signup flow
3. (Optional) `site:{domain} customers OR "case studies"` — social proof pages

For each finding, record:
- **observation** — what you noticed (e.g., "Pricing page has 4 tiers but no annual toggle")
- **pageOrFlow** — which page or flow (e.g., "/pricing")
- **severity** — "high", "medium", or "low"
- **testkarmaAngle** — how TestKarma could help with this specific issue

**Rules:**
- Be specific about what you observed, not generic. "No annual toggle" is useful. "Could improve pricing" is not.
- Flush raw search results from context after extracting findings.

---

#### Phase 5: Synthesis (no web searches)

Using ONLY the structured findings from Phases 2-4 (not raw search results), generate:

1. **companyIntel** — structured company intelligence:
   - **productMarket**: whatTheyDo, coreProductService, targetCustomer, businessModel, pricingModel, keyDifferentiator
   - **stageTraction**: fundingStageAmount, keyInvestors[], estimatedTeamSize, founded, revenueSignals[] (each: text, source, sourceUrl), growthSignals[] (same shape)
   - **onlinePresence**: websiteUrl, trafficEstimate, blogContentStrategy, seoPresence

2. **prospectIntel** — founder/CEO intelligence:
   - **background**: name, role, careerHistory[], education[], previousCompaniesExits[], backgroundType
   - **contentThoughtLeadership**: linkedinPosting, blogNewsletter, podcastAppearances[] (each: title, url, platform, date, summary), conferenceTalks[] (each: title, url, event, date, summary), twitterPresence, keyOpinions[]
   - **personalitySignals**: interestsOutsideWork[], communicationStyle, values[]

3. **painPointHypotheses** — 3-5 ranked pain points, each with:
   - **painPoint** — the specific problem (e.g., "Publishing 13+ blog posts/month but zero product analytics to measure which drive sign-ups")
   - **evidenceOrSignal** — what you observed that supports this (with sources)
   - **relevantCapability** — how TestKarma specifically helps with this

4. **personalizationHooks** — 4-6 hooks for Loom outreach, each with:
   - **hook** — the personalised observation (e.g., "Deepak spoke about laziness on the Founder Favourites podcast — that friction insight applies to his own signup funnel")
   - **source** — where you found it
   - **sourceUrl** — URL of the source

5. **summary** — 3-4 sentence BLUF-style summary of the most compelling research findings, optimised for quick scanning before recording a Loom.

**Rules:**
- Every pain point and hook must reference at least one real finding from a previous phase.
- The summary must be specific to this company, not generic.
- Rank pain points by specificity and evidence strength. Rank hooks by personalisation strength — the most unique angle first.

---

### Step 3: Backfill Enrichment Data

Research discovers company intel that the enrichment pipeline missed — especially for `nourl:` entries. **After synthesising findings but before writing research_data**, update the `companies` row with everything you learned:

#### 3a. Update `enrichment_data` JSONB

Merge into the existing `enrichment_data` (don't overwrite — read first, then update keys):

- **`keyPeople`** — replace with discovered founders/execs. Each entry:
  ```json
  {"name": "...", "role": "CEO", "title": "Co-Founder & CEO", "source": "web_research", "linkedinUrl": "https://linkedin.com/in/..."}
  ```
  Only include `linkedinUrl` if you found one in search results. Never fabricate LinkedIn URLs.

- **`webSearch`** — merge these fields (don't overwrite existing values that are already correct):
  - `fundingStage` — e.g. "Pre-seed", "Seed", "Series A", "Grant", "Accelerator"
  - `fundingAmount` — e.g. "$13M Series A ($16M total)", "Geovation £100k grant"
  - `hqLocation` — e.g. "London, UK"
  - `foundedYear` — integer
  - `employeeCount` — integer (best estimate)

#### 3b. Update top-level company columns

Set these columns on the `companies` row:

| Column | What to write |
|--------|---------------|
| `description` | 1-line product description (only if currently NULL) |
| `funding_stage` | Normalised stage: "pre-seed", "seed", "Series A", "grant", "bootstrapped" |
| `funding_evidence` | Human-readable funding string with investors and dates |
| `team_size` | Integer employee count (only if more accurate than current value) |
| `has_pricing_page` | `true` if you found/observed a pricing page |
| `has_signup` | `true` if you found a self-serve signup or app download flow |

#### 3c. Example backfill SQL

```python
# Read existing enrichment, merge new data, write back
cur.execute("SELECT enrichment_data FROM companies WHERE domain = %s", (domain,))
row = cur.fetchone()
existing = row[0] if row and row[0] and isinstance(row[0], dict) else {}

existing["keyPeople"] = [...]  # replace with discovered founders
if "webSearch" not in existing:
    existing["webSearch"] = {}
existing["webSearch"].update({
    "fundingStage": "...",
    "fundingAmount": "...",
    "hqLocation": "...",
    "foundedYear": 2024,
    "employeeCount": 10
})

cur.execute("""
    UPDATE companies
    SET enrichment_data = %s,
        description = COALESCE(description, %s),
        funding_stage = %s,
        funding_evidence = %s,
        team_size = COALESCE(%s, team_size),
        has_pricing_page = %s,
        has_signup = %s
    WHERE domain = %s
""", (json.dumps(existing), description, funding_stage, funding_evidence,
      team_size, has_pricing_page, has_signup, domain))
conn.commit()
```

**Rules:**
- Always read `enrichment_data` before writing — merge, don't overwrite.
- Use `COALESCE(description, %s)` for description so you don't clobber existing values.
- For `team_size`, only update if your estimate is more accurate (e.g. enrichment says 2 but you found 20 employees).
- This backfill runs in the **same connection** as the research write — do it right after `write_research()`.

---

### Step 4: Write Research Results

Compile all findings into the research_data JSON shape and write to the database:

```python
# CRITICAL: This schema MUST match researchDataSchema in lib/domain.ts.
# The app uses Zod lenient parsing — wrong field names are silently dropped.
research_data = {
    "version": 1,
    "researchedAt": "ISO-8601 timestamp",
    "summary": "...",                           # from Phase 5
    "companyIntel": {                           # from Phase 5 (using Phase 3-4 findings + enrichment)
        "productMarket": {
            "whatTheyDo": "...",
            "coreProductService": "...",
            "targetCustomer": "...",
            "businessModel": "...",
            "pricingModel": "...",
            "keyDifferentiator": "..."
        },
        "stageTraction": {
            "fundingStageAmount": "...",
            "keyInvestors": ["..."],
            "estimatedTeamSize": "...",
            "founded": "...",
            "revenueSignals": [{"text": "...", "source": "...", "sourceUrl": "..."}],
            "growthSignals": [{"text": "...", "source": "...", "sourceUrl": "..."}]
        },
        "onlinePresence": {
            "websiteUrl": "...",
            "trafficEstimate": "...",
            "blogContentStrategy": "...",
            "seoPresence": "..."
        }
    },
    "prospectIntel": {                          # from Phase 2
        "background": {
            "name": "...",
            "role": "...",
            "careerHistory": ["..."],
            "education": ["..."],
            "previousCompaniesExits": ["..."],
            "backgroundType": "..."
        },
        "contentThoughtLeadership": {
            "linkedinPosting": "...",
            "blogNewsletter": "...",
            "podcastAppearances": [{"title": "...", "url": "...", "platform": "...", "date": "...", "summary": "..."}],
            "conferenceTalks": [{"title": "...", "url": "...", "event": "...", "date": "...", "summary": "..."}],
            "twitterPresence": "...",
            "keyOpinions": ["..."]
        },
        "personalitySignals": {
            "interestsOutsideWork": ["..."],
            "communicationStyle": "...",
            "values": ["..."]
        }
    },
    "painPointHypotheses": [                    # from Phase 5 (using Phase 3-4 findings)
        {"painPoint": "...", "evidenceOrSignal": "...", "relevantCapability": "..."}
    ],
    "personalizationHooks": [                   # from Phase 5 (using Phase 2-4 findings)
        {"hook": "...", "source": "...", "sourceUrl": "..."}
    ],
    "meta": {
        "totalSearches": 0,
        "phasesCompleted": ["scope", "founder", "challenges", "cro", "synthesis"],
        "phasesFailed": []
    }
}
```

Write to database:

```bash
python3 -c "
import sys, json; sys.path.insert(0, 'scripts')
from research_db import get_db, write_research
conn = get_db()
research_data = json.loads('''PASTE_JSON_HERE''')
write_research(conn, 'DOMAIN', 'JOB_ID', research_data)
conn.close()
print('Research written successfully')
"
```

If research fails completely, mark the job as failed:

```bash
python3 -c "
import sys; sys.path.insert(0, 'scripts')
from research_db import get_db, fail_job
conn = get_db()
fail_job(conn, 'JOB_ID', 'Error description here')
conn.close()
"
```

### Step 5: Continue or Exit

If processing all pending jobs (`/research` without a domain), loop back to Step 1 to claim the next job. Continue until no more pending jobs remain. Each iteration writes both research_data (Step 4) and enrichment backfill (Step 3) before claiming the next job.

Report completion: "Research complete. Processed N companies. Results available on brief pages."

---

## Error Handling

- If a phase fails (search returns nothing useful), skip it and continue with remaining phases.
- Record failed phases in `meta.phasesFailed`.
- Partial research (some phases completed, some failed) is still written to the database.
- If ALL phases fail, mark the job as failed with `fail_job()`.

## Rules

1. **Source-attribute every finding.** Include the URL where you found it. Never fabricate URLs.
2. **Flush between phases.** After extracting findings from a phase's searches, discard the raw search results before starting the next phase. This prevents context rot.
3. **Use enrichment_data as a head start.** Don't re-search for firmographics. Focus on depth, not breadth.
4. **5-15 searches total.** Be efficient. If Phase 2 finds rich founder content in 2 searches, don't use the remaining budget on Phase 2 — move to Phase 3.
5. **Never scrape LinkedIn or any authenticated platform.** Google search results that reference LinkedIn are fine; navigating to LinkedIn is not.
6. **Never store raw HTML or full page content.** Only store extracted, structured findings.
7. **No re-research.** If research_data already exists for a company, skip it.
