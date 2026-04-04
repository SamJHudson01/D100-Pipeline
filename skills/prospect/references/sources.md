# Data Sources (v2)

v2 splits sources into two categories: **pool building** (seed mode, bulk discovery)
and **enrichment** (daily mode, per-company detail). This file is the single reference
for which scripts run, what they need, and what they return.

---

## Pool Building Sources (Seed Mode)

These scripts discover new companies in bulk and feed them into the prospect pool.

| Source | Script | Volume | Auth | Notes |
|--------|--------|--------|------|-------|
| YC API | gather_yc.py | 5,500+ companies | None | Single GET, JSON. Filters: Active, team_size 1-50, last 6 batches |
| ProductHunt | gather_producthunt.py | 30+ per crawl | FIRECRAWL_API_KEY | Crawls producthunt.com, extracts trending products |
| Entrepreneur First | gather_accelerators.py | 600+ | FIRECRAWL_API_KEY | Portfolio page scrape |
| Seedcamp | gather_accelerators.py | 550+ | FIRECRAWL_API_KEY | Portfolio page scrape |
| Alchemist | gather_accelerators.py | 400+ | FIRECRAWL_API_KEY | Portfolio page scrape |
| Techstars | gather_accelerators.py | 4,900+ | FIRECRAWL_API_KEY | Portfolio page scrape |
| Antler | gather_accelerators.py | 1,800+ | FIRECRAWL_API_KEY | Portfolio page scrape |
| Startupbootcamp | gather_accelerators.py | 1,600+ | FIRECRAWL_API_KEY | Portfolio page scrape |
| Founders Factory | gather_accelerators.py | 300+ | FIRECRAWL_API_KEY | Portfolio page scrape |
| SBIR.gov | gather_sbir.py | 100K+ awards | None | API query, filters for NSF Phase I software awards |

---

## Enrichment Sources (Daily Mode, Per-Company)

These scripts run against each company already in the pool to add qualification signals.

| Source | Script | Data Provided | Auth | Cost |
|--------|--------|---------------|------|------|
| Firecrawl | enrich_website.py | Full website content, team page parsing | API key | Free tier 500/mo |
| Greenhouse API | enrich_ats.py | Open roles, departments | None | Free |
| Lever API | enrich_ats.py | Open roles | None | Free |
| Ashby API | enrich_ats.py | Open roles | None | Free |
| SEC EDGAR | enrich_funding.py | Form D filings (funding) | None | Free |
| GitHub org API | gather_github.py | Public member count | Optional PAT | Free |
| Company website | enrich_website.py | Team size, pricing, signup detection | Firecrawl | Included |

---

## Removed from v1

| Source | Reason |
|--------|--------|
| CSP header parsing | Zero detections -- early-stage startups don't set CSP |
| Segment config detection | Zero detections -- same reason |
| HN Show HN (as pool source) | Too noisy -- mostly side projects |
| TrustMRR | Returns non-SaaS companies |
| LinkedIn scraping | 47% failure rate |
| SEC EDGAR (as pool source) | Returns established companies and investment funds |

---

## Cache TTLs

| Data Type | TTL | Rationale |
|-----------|-----|-----------|
| Website content | 7 days | Company sites change slowly |
| ATS job boards | 7 days | Hiring changes weekly |
| SEC EDGAR lookups | 30 days | Filings are infrequent |
| GitHub org data | 7 days | Activity changes weekly |

---

## Future Sources (Config-Only Add)

These are planned additions that would require only a config entry to enable:

- YC directory crawl (alternative to API)
- Creative Destruction Lab
- VC portfolio pages (Bessemer, Point Nine, Precursor, Floodgate)
- Indie Hackers product directory
- There's An AI For That
- G2/Capterra new listings
