# Dream 100 Research Methodology

Repo-owned source of truth for deep research executors.

This document defines the executor-agnostic methodology for producing
`research_data` for Dream 100 prospects. Executors may differ in transport and
runtime, but they must follow the same phases, respect the same search budget,
and produce the same final contract.

Cross-reference:
- Read contract: `prospect-qualifier/app/lib/domain.ts` -> `researchDataSchema`
- Product spec: `prospect-qualifier/specs/deep-research.md`

## Goals

Produce a structured research dossier that helps an operator understand:

- the company and market the prospect is operating in
- the specific person being contacted
- the likely pain points that connect to the outreach reason
- concrete personalization hooks grounded in public evidence

This is not a CRO teardown and it is not an outreach-angle generator.
If conversion or website observations are useful, they belong only as supporting
evidence inside company intel or pain-point hypotheses.

## Rules

1. Enrichment is optional context, not a dependency.
   Use `enrichment_data` as a head start when available, but do not stop because
   enrichment is sparse. Web research is the primary path.
2. Use public-web evidence only.
   Every concrete finding must be traceable to a public source URL when one is
   available. Never fabricate URLs.
3. Do not scrape LinkedIn.
   It is acceptable to record a public LinkedIn profile URL surfaced by search
   results, but do not scrape LinkedIn page bodies or depend on LinkedIn
   scraping for required findings.
4. Prefer direct sources over generic commentary.
   Prioritize company sites, public profiles, interviews, podcasts, conference
   pages, reputable press, job posts, docs, and public code over generic
   marketing-advice articles.
5. Partial results are valid.
   If one or more sections fail but the dossier is still useful and grounded,
   return the partial dossier and record failed phases in metadata.
6. Do not persist raw transcripts or scraped HTML.
   Keep the stored payload to structured findings, summary text, and source URLs.

## Search Budget

- Total budget: 8-20 web searches per prospect
- Phase 1: Company intel, 3-6 searches
- Phase 2: Prospect intel, 3-6 searches
- Phase 3: Pain-point synthesis, 1-3 searches
- Phase 4: Personalization hooks, 0-2 searches
- Phase 5: Summary, 0 searches

Executors may use fewer searches when enrichment already provides strong,
fresh context.

## Phases

### Phase 1: Company Intel

Build the company picture first.

Capture where available:

- what the company does in one line
- core product or service
- target customer / ICP
- business model and pricing model
- differentiator or moat
- funding stage, amount, investors, founded year
- estimated team size and notable revenue or growth signals
- tech stack and notable tools/integrations
- website, blog/content motion, SEO/distribution surface, traffic estimate

Use direct evidence such as company pages, docs, pricing pages, job postings,
funding announcements, and public profiles.

### Phase 2: Prospect Personal Intel

Research the actual person being contacted.

Capture where available:

- name and current role
- career history and prior companies/exits
- education
- technical vs. commercial background
- public content and thought leadership
- podcast appearances and talks
- Twitter/X, blog, newsletter, or other public posting behavior
- interests, personality signals, communication style, and values

This section should feel like intelligence on the person, not just a list of
links.

### Phase 3: Pain Point Hypothesis

Using the company stage, product, market, and personal background, identify the
most likely problems that connect to the outreach reason.

For each pain point, record:

- `painPoint`
- `evidenceOrSignal`
- `relevantCapability`

Keep this grounded. Do not invent pains without observable signals.

### Phase 4: Personalization Hooks

Produce 3-5 concrete hooks that can be referenced in outreach to prove the work
was done.

Each hook should:

- be specific to the company or person
- reference a real public signal
- be phrased as something an operator can actually mention

### Phase 5: Summary

Write a concise high-signal summary that explains why this prospect matters and
what the key context is before outreach.

## Output Contract

Executors must produce a JSON payload compatible with `researchDataSchema`:

```json
{
  "version": 1,
  "researchedAt": "ISO-8601 timestamp",
  "summary": "string",
  "companyIntel": {
    "productMarket": {
      "whatTheyDo": "string",
      "coreProductService": "string",
      "targetCustomer": "string",
      "businessModel": "string",
      "pricingModel": "string",
      "keyDifferentiator": "string"
    },
    "stageTraction": {
      "fundingStageAmount": "string",
      "keyInvestors": ["string"],
      "estimatedTeamSize": "string",
      "founded": "string",
      "revenueSignals": ["string"],
      "growthSignals": ["string"]
    },
    "techStack": {
      "frontend": ["string"],
      "backend": ["string"],
      "infrastructure": ["string"],
      "notableToolsIntegrations": ["string"],
      "sources": ["string"]
    },
    "onlinePresence": {
      "websiteUrl": "string",
      "trafficEstimate": "string",
      "blogContentStrategy": "string",
      "seoPresence": "string"
    }
  },
  "prospectIntel": {
    "background": {
      "name": "string",
      "role": "string",
      "careerHistory": ["string"],
      "education": ["string"],
      "previousCompaniesExits": ["string"],
      "backgroundType": "string"
    },
    "contentThoughtLeadership": {
      "linkedinPosting": "string",
      "blogNewsletter": "string",
      "podcastAppearances": ["string"],
      "conferenceTalks": ["string"],
      "twitterPresence": "string",
      "keyOpinions": ["string"]
    },
    "personalitySignals": {
      "interestsOutsideWork": ["string"],
      "communicationStyle": "string",
      "values": ["string"]
    }
  },
  "painPointHypotheses": [
    {
      "painPoint": "string",
      "evidenceOrSignal": "string",
      "relevantCapability": "string"
    }
  ],
  "personalizationHooks": ["string"],
  "meta": {
    "totalSearches": 0,
    "totalDurationMs": 0,
    "phasesCompleted": [],
    "phasesFailed": []
  }
}
```

The contract is lenient on optional sections, but these must remain true:

- `version` must stay `1`
- `summary` must be company-specific, not template filler
- `painPointHypotheses` must connect to the outreach reason
- `personalizationHooks` should be specific and reference real findings
- `meta.phasesFailed` must explain any skipped or failed phases

## Persistence Contract

The accepted stored artifact is `companies.research_data`.
Once that field is populated for a company, v1 treats the dossier as final.
Executors must not overwrite an existing accepted dossier.
