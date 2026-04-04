# Prospect Scoring Rubric

Weighted additive model on a 0-100 scale for qualifying startup prospects.

---

## How Scoring Works

Each criterion is scored on a 1-5 scale, then multiplied by its weight. The weighted scores are summed to produce a total. A criterion with no evidence (confidence = UNKNOWN) receives a score of 0 for that criterion.

```
total = sum(criterion_score * criterion_weight) for all criteria
```

Maximum possible score: **100** (every criterion scores 5).

| Criterion | Weight | Max Contribution |
|-----------|--------|------------------|
| Team size | 15 | 15 |
| Funding stage | 15 | 15 |
| Growth motion | 20 | 20 |
| Traction signals | 15 | 15 |
| Growth hire absence | 15 | 15 |
| Founder reachability | 10 | 10 |
| Timing signal | 10 | 10 |

---

## Per-Criterion Scoring Guide

### Team Size (Weight: 15)

| Score | Definition |
|-------|------------|
| 5 | 5-15 employees. Sweet spot: small enough to lack dedicated growth resources, large enough to have real product and customers. |
| 3 | 16-30 employees. Growing but may already have some marketing/growth capacity in-house. |
| 1 | 31-50 employees. Likely has internal teams covering growth functions; harder to sell into, lower urgency. |

### Funding Stage (Weight: 15)

| Score | Definition |
|-------|------------|
| 5 | Seed or Series A raised within the last 12 months. Fresh capital, active spend mode, pressure to show growth metrics to investors. |
| 3 | Seed or Series A raised more than 12 months ago. Capital deployed but growth pressure remains; may have already committed budget elsewhere. |
| 1 | Unfunded but revenue-generating. Bootstrapped or pre-seed with demonstrable revenue. Budget-conscious, slower sales cycles, but real business. |

### Growth Motion (Weight: 20)

| Score | Definition |
|-------|------------|
| 5 | Product-led growth with self-serve signup and a free tier or free trial. Users can adopt without talking to sales. This is the highest-value motion because growth levers (activation, conversion, expansion) are directly improvable. |
| 3 | Hybrid model combining PLG with a sales-assist layer. Self-serve exists but enterprise or upsell deals involve sales. Growth work still valuable but partially gated by sales process. |
| 1 | Sales-led with demo required. No self-serve path; every customer goes through a salesperson. Growth levers are limited to top-of-funnel demand gen. |

### Traction Signals (Weight: 15)

| Score | Definition |
|-------|------------|
| 5 | Multiple concrete indicators present: consistent shipping cadence (changelogs, release notes), visible user base (community, reviews on G2/Capterra/Product Hunt), third-party integrations listed, public customer logos or case studies. |
| 3 | Some indicators present but incomplete picture. For example, product exists and ships updates but no public reviews or user evidence, or reviews exist but shipping cadence is unclear. |
| 1 | Single weak indicator only. Product exists but little evidence of users, engagement, or iteration. May be very early or stalled. |

### Growth Hire Absence (Weight: 15)

| Score | Definition |
|-------|------------|
| 5 | No growth, marketing, or demand-gen roles visible anywhere (LinkedIn, careers page, job boards). The company has zero dedicated growth capacity, making external help most valuable. |
| 3 | One junior marketing hire visible (e.g., "Marketing Associate," "Content Marketing Manager"). Some coverage exists but no strategic growth leadership. |
| 1 | A marketing team exists but remains small (2-3 people). They have some internal capacity; external value proposition shifts from "do growth" to "augment/accelerate growth." |

### Founder Reachability (Weight: 10)

| Score | Definition |
|-------|------------|
| 5 | Founder is active on Twitter/X, Hacker News, or GitHub. Email address is findable (personal site, GitHub profile, public talks). They engage publicly and are reachable through warm or semi-warm channels. |
| 3 | Some public presence: occasional posts, a personal site, or conference appearances, but not consistently active. Email findable with moderate effort. |
| 1 | No meaningful public presence. Founder is not active on social platforms, does not appear at events, and email is not readily discoverable. Cold outreach only. |

### Timing Signal (Weight: 10)

| Score | Definition |
|-------|------------|
| 5 | Active trigger event within the last 30 days: new funding round announced, Product Hunt or Hacker News launch, hiring burst (3+ roles posted simultaneously), major product release, or public pivot. |
| 3 | Moderate recency: trigger event occurred 1-3 months ago, or a slower-burn signal like steady hiring over the past quarter. Still relevant but urgency is lower. |
| 1 | No recent trigger. Last notable event was 3+ months ago, or no discernible event at all. Company may be in steady-state or quiet period. |

---

## Technographic Signals

Technographic signals are **additive evidence that feeds into existing criteria**. They are not scored as a separate criterion. When detected, they strengthen (or weaken) the confidence and score of the relevant criterion.

### Positive Evidence

| Signal Detected | Feeds Into | Reasoning |
|----------------|------------|-----------|
| Stripe | Traction signals | Company is actively monetizing. Confirms real revenue flow and paying users. |
| PostHog, Amplitude, or Mixpanel | Growth motion | Company is instrumenting product analytics. Indicates data-informed approach to growth and a PLG or hybrid motion. |
| Segment + data warehouse (Snowflake, BigQuery, Redshift) | Traction signals | Data maturity signal. Company has invested in infrastructure to understand users at scale, implying meaningful volume. |

### Negative Evidence

| Signal Detected | Feeds Into | Reasoning |
|----------------|------------|-----------|
| Marketo, Eloqua, HubSpot Enterprise, or Pardot | Growth hire absence | Enterprise marketing automation implies a dedicated marketing team operating these tools. Reduces the "growth hire absence" score since internal capacity likely exists. |

### How to Apply

- If a technographic signal is detected, use it to adjust your confidence level for the associated criterion (e.g., from MEDIUM to HIGH).
- If a technographic signal contradicts other evidence, note the conflict and weight the direct evidence more heavily.
- Technographic signals alone do not override criterion scores; they corroborate or challenge other findings.

---

## Confidence Levels

Every criterion score must be accompanied by a confidence level indicating the strength of the underlying evidence.

| Level | Definition | Scoring Implication |
|-------|------------|---------------------|
| HIGH | Direct, verifiable evidence found. Source is authoritative (company website, Crunchbase, LinkedIn, official announcements). | Score the criterion normally using the rubric above. |
| MEDIUM | Indirect or inferred evidence. Conclusion drawn from partial data, third-party mentions, or reasonable inference from related signals. | Score the criterion normally but flag the inference in notes. |
| LOW | Weak signal only. Evidence is anecdotal, outdated (6+ months), or based on a single ambiguous data point. | Score the criterion conservatively (bias toward the lower end of the applicable range). |
| UNKNOWN | No evidence available for this criterion. | Score the criterion as **0**. Do not guess. The total score will reflect the gap, and the missing criterion should be flagged for follow-up research. |
