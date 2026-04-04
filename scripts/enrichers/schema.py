"""Enrichment data schema — Python side of the contract.

Mirrors the Zod schema in app/lib/domain.ts. Every section is optional.
The enrichment pipeline validates output against this shape before writing
to the database.
"""

from typing import TypedDict, Optional, Literal


class NewsItem(TypedDict, total=False):
    title: str
    source: str
    date: str
    url: str


class WebSearchResult(TypedDict, total=False):
    status: Literal["success", "failed", "timeout", "rate_limited", "skipped"]
    employeeCount: Optional[int]
    employeeCountSource: str
    fundingStage: Optional[str]
    fundingAmount: Optional[str]
    fundingDate: Optional[str]
    fundingSource: str
    foundedYear: Optional[int]
    hqLocation: Optional[str]
    latestNews: list[NewsItem]


class KeyPerson(TypedDict, total=False):
    name: str
    title: str
    role: Literal["founder", "ceo", "cto", "coo", "other"]
    source: str
    linkedinUrl: str
    twitterHandle: str
    githubUsername: str
    githubAvatarUrl: str
    githubBio: str
    githubLocation: str
    githubBlogUrl: str
    githubPublicRepos: int
    podcastAppearances: list[dict]
    conferenceTalks: list[dict]
    hasNewsletter: bool
    newsletterPlatform: str


class InfrastructureResult(TypedDict, total=False):
    status: Literal["success", "failed", "timeout", "rate_limited", "skipped"]
    hostingProvider: Optional[str]
    hostingSource: str
    cdn: Optional[str]
    emailProvider: Optional[str]
    appHosting: Optional[str]


class DetectedTool(TypedDict, total=False):
    name: str
    category: str
    source: str


class GrowthGap(TypedDict, total=False):
    type: str
    description: str
    talkingPoint: str
    impact: Literal["high", "medium", "low"]


class GrowthMaturity(TypedDict, total=False):
    level: Literal["pre-data-driven", "data-aware", "behaviour-informed", "sophisticated"]
    hasProductAnalytics: bool
    hasSessionReplay: bool
    hasExperimentation: bool
    hasOnboardingTooling: bool


class PricingResult(TypedDict, total=False):
    status: Literal["success", "failed", "timeout", "rate_limited", "skipped"]
    pageFound: bool
    pageUrl: str
    tierCount: int
    hasFreeTier: bool
    trialDays: Optional[int]
    ccRequired: bool
    hasAnnualToggle: bool
    hasEnterpriseTier: bool
    pricePoints: list[str]


class SignupResult(TypedDict, total=False):
    status: Literal["success", "failed", "timeout", "rate_limited", "skipped"]
    pageFound: bool
    pageUrl: str
    formFieldCount: int
    oauthProviders: list[str]
    hasCaptcha: bool
    isMultiStep: bool
    frictionLevel: Literal["low", "medium", "high"]


class SocialProofResult(TypedDict, total=False):
    status: Literal["success", "failed", "timeout", "rate_limited", "skipped"]
    customerLogoCount: int
    testimonialCount: int
    caseStudyCount: int
    reviewPlatforms: list[str]


class CTAResult(TypedDict, total=False):
    status: Literal["success", "failed", "timeout", "rate_limited", "skipped"]
    type: Literal["plg", "sales_led", "hybrid"]
    texts: list[str]


class ContentResult(TypedDict, total=False):
    status: Literal["success", "failed", "timeout", "rate_limited", "skipped"]
    blogPostsPerMonth: Optional[float]
    hasActiveChangelog: bool
    lastChangelogDate: Optional[str]
    communityChannels: list[str]
    hasReferralProgram: bool


class ContactResult(TypedDict, total=False):
    status: Literal["success", "failed", "timeout", "rate_limited", "skipped"]
    founderEmail: Optional[str]
    emailSource: Literal["website_mailto", "pattern_verified", "pattern_unverified"]
    emailConfidence: Literal["high", "medium", "low"]
    smtpVerified: bool
    catchAllDomain: bool
    companyEmails: list[str]
    candidatesTried: list[str]
    candidatesFailed: list[str]


class BLUFResult(TypedDict, total=False):
    category: str
    text: str


class StructuredSources(TypedDict, total=False):
    yc: dict
    github: dict
    news: list[NewsItem]


class EnrichmentMeta(TypedDict, total=False):
    enrichedAt: str
    firecrawlCreditsUsed: int
    pagesScraped: list[str]
    searchResultsFound: bool
    sourcesChecked: list[str]
    totalDurationMs: int


class EnrichmentData(TypedDict, total=False):
    webSearch: WebSearchResult
    keyPeople: list[KeyPerson]
    infrastructure: InfrastructureResult
    structuredSources: StructuredSources
    detectedTools: list[DetectedTool]
    growthMaturity: GrowthMaturity
    growthGaps: list[GrowthGap]
    pricing: PricingResult
    signup: SignupResult
    socialProof: SocialProofResult
    cta: CTAResult
    content: ContentResult
    contact: ContactResult
    bluf: BLUFResult
    personalHook: str
    meta: EnrichmentMeta


# ─── Enrichment Context ──────────────────────────────────────────────────────
# Mutable accumulator passed through the enrichment chain.

class EnrichmentContext(TypedDict, total=False):
    """Accumulated state passed through the enrichment pipeline."""
    domain: str
    name: str
    url: str
    description: str
    # Raw HTML from Firecrawl (consumed by Tier 2/3 analysers, never stored)
    homepage_html: str
    homepage_markdown: str
    pricing_html: str
    signup_html: str
    # Accumulated enrichment result (this is what gets stored)
    result: EnrichmentData
