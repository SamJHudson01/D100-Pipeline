# Ideal Customer Profile (ICP) Definition

This file defines the qualification criteria for evaluating startup prospects on behalf of TestKarma, a growth experimentation consultancy. The skill reads this file at runtime to determine how prospects are scored and routed. To change qualification behavior, edit the criteria below -- no changes to skill logic are required.

---

## Hard Disqualifiers

If **any one** of the following is true, the prospect is immediately **DISQUALIFIED** regardless of other signals.

- **Pre-product.** There is no live product accessible via a URL. Landing pages with a waitlist but no functional product count as pre-product.
- **Not a product company.** The company is a consultancy, agency, or freelancer marketplace rather than a product business.
- **Already has a dedicated growth team.** Two or more employees with growth or marketing titles are visible (LinkedIn, team page, job boards). **Even one senior growth hire (Head of Growth, VP Marketing, Growth Lead) is a strong negative signal** — check this explicitly during enrichment, not just via ATS boards.
- **Founder is a growth expert.** If the founder's background is in growth hacking, growth marketing, or they previously ran/founded a growth consultancy or agency, the pitch is fundamentally different — they don't need to be educated on growth experimentation. Treat as a soft disqualifier: score down significantly on the "growth hire absence" criterion.
- **Team size exceeds 50 employees.** Headcount is verifiable through LinkedIn, Crunchbase, or the company's own site.
- **No funding and no visible revenue or traction signals.** The company has raised no disclosed funding AND shows no evidence of revenue, paying customers, or meaningful traction.

---

## Target Profile

The ideal TestKarma prospect looks like this:

- **Product type:** B2B or B2C SaaS with a live, functional product.
- **Team size:** 5 to 30 employees.
- **Funding stage:** Seed or Series A funding closed within the last 12 months, OR bootstrapped with visible revenue (pricing page, customer logos, case studies, public metrics).
- **Growth ownership:** No dedicated growth or marketing hire yet. Growth is founder-led.
- **Go-to-market motion:** Product-led growth (PLG) is preferred. Sales-led motions are also valid if the product has in-app surfaces where experimentation can drive conversion or retention.
- **Shipping cadence:** Active and recent product development. Look for recent changelog entries, product update announcements, frequent commits to public repos, or visible feature launches.

---

## Score Routing

After evaluation, assign a score from 0 to 100 and route accordingly.

- **70 and above -- QUALIFY.** Full Loom-worthy target. This prospect fits the ICP closely enough to justify personalized outreach and a recorded Loom walkthrough.
- **50 to 69 -- NURTURE.** Promising but not ready or not enough signal. Add to the watch list and re-evaluate in 2 to 4 weeks.
- **Below 50 -- SKIP.** Does not warrant further investigation. Log the reason and move on.
