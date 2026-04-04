"""Homepage HTML analysis enrichers — social proof, CTA, content maturity, referral.

All run against already-scraped homepage HTML (no extra Firecrawl credits).
Registered as Tier 3 enrichers that depend on website_scrape.
"""

import re
import sys
import xml.etree.ElementTree as ET
from urllib.parse import urljoin

import requests

from .registry import register
from .schema import EnrichmentContext

eprint = lambda *a, **kw: print(*a, file=sys.stderr, **kw)

# ─── Social Proof ─────────────────────────────────────────────────────────────

LOGO_PATTERNS = [
    r'(?:trusted\s+by|used\s+by|loved\s+by|powering|our\s+customers|companies\s+(?:that|who))',
    r'(?:customer|client|partner)\s*(?:logo|brand)',
    r'logo[\s-]*(?:strip|bar|grid|wall|carousel|section)',
]

TESTIMONIAL_PATTERNS = [
    r'(?:testimonial|quote|review|what\s+(?:our|people)\s+(?:customers?|users?|clients?)\s+say)',
    r'(?:blockquote|❝|❞|"|")',
]

REVIEW_PLATFORMS = {
    "g2.com": "G2", "g2crowd": "G2",
    "capterra": "Capterra",
    "trustpilot": "Trustpilot",
    "getapp": "GetApp",
    "trustradius": "TrustRadius",
    "producthunt.com": "Product Hunt",
}


@register("social_proof", depends_on=["website_scrape"], tier=3)
def social_proof(ctx: EnrichmentContext) -> dict:
    content = ctx.get("homepage_markdown", "") or ctx.get("homepage_html", "")
    if not content:
        return {"socialProof": {"status": "skipped"}}

    content_lower = content.lower()

    # Count logo sections
    logo_count = 0
    for pattern in LOGO_PATTERNS:
        if re.search(pattern, content_lower):
            # Count img tags or markdown images near the logo section
            imgs = len(re.findall(r'!\[.*?\]\(.*?\)|<img\s', content[:5000]))
            logo_count = max(logo_count, min(imgs, 30))
            break

    # Count testimonials
    testimonial_count = 0
    for pattern in TESTIMONIAL_PATTERNS:
        matches = re.findall(pattern, content_lower)
        testimonial_count = max(testimonial_count, len(matches))

    # Case studies
    case_study_count = len(re.findall(r'(?:case[\s-]?stud(?:y|ies))', content_lower))
    case_study_links = len(re.findall(r'(?:/case-stud|/customers?/)', content_lower))
    case_study_count = max(case_study_count, case_study_links)

    # Review platforms
    platforms = []
    for keyword, platform in REVIEW_PLATFORMS.items():
        if keyword in content_lower:
            platforms.append(platform)

    return {"socialProof": {
        "status": "success",
        "customerLogoCount": logo_count,
        "testimonialCount": min(testimonial_count, 20),
        "caseStudyCount": min(case_study_count, 10),
        "reviewPlatforms": list(set(platforms)),
    }}


# ─── CTA Classification ──────────────────────────────────────────────────────

PLG_PATTERNS = [
    r'(?:start|get\s+started|try|sign\s*up|create\s+account|free\s+trial|try\s+free|start\s+free)',
    r'(?:free\s+(?:plan|tier|version)|no\s+credit\s+card)',
]

SALES_PATTERNS = [
    r'(?:book\s+(?:a\s+)?demo|schedule\s+(?:a\s+)?demo|request\s+(?:a\s+)?demo)',
    r'(?:talk\s+to\s+(?:sales|us)|contact\s+(?:sales|us)|get\s+(?:a\s+)?quote)',
    r'(?:request\s+(?:a\s+)?(?:quote|pricing|consultation))',
]


@register("cta_classification", depends_on=["website_scrape"], tier=3)
def cta_classification(ctx: EnrichmentContext) -> dict:
    content = ctx.get("homepage_markdown", "") or ctx.get("homepage_html", "")
    if not content:
        return {"cta": {"status": "skipped"}}

    content_lower = content.lower()

    plg_matches = []
    for pattern in PLG_PATTERNS:
        plg_matches.extend(re.findall(pattern, content_lower))

    sales_matches = []
    for pattern in SALES_PATTERNS:
        sales_matches.extend(re.findall(pattern, content_lower))

    # Extract actual CTA button/link texts
    cta_texts = []
    # Markdown links with CTA-like text
    for m in re.finditer(r'\[([^\]]{3,40})\]\(', content):
        text = m.group(1).strip()
        text_lower = text.lower()
        if any(re.search(p, text_lower) for p in PLG_PATTERNS + SALES_PATTERNS):
            cta_texts.append(text)

    has_plg = len(plg_matches) > 0
    has_sales = len(sales_matches) > 0

    if has_plg and has_sales:
        cta_type = "hybrid"
    elif has_plg:
        cta_type = "plg"
    elif has_sales:
        cta_type = "sales_led"
    else:
        cta_type = "sales_led"  # Default if no clear signal

    return {"cta": {
        "status": "success",
        "type": cta_type,
        "texts": cta_texts[:5],
    }}


# ─── Blog/Changelog/Community Detection ──────────────────────────────────────

COMMUNITY_PATTERNS = {
    "discord.gg/": "Discord",
    "discord.com/invite/": "Discord",
    ".slack.com": "Slack",
    "community.": "Community Forum",
    "forum.": "Forum",
    "github.com/": "GitHub",
}


@register("content_maturity", depends_on=["website_scrape"], tier=3)
def content_maturity(ctx: EnrichmentContext) -> dict:
    content = ctx.get("homepage_markdown", "") or ctx.get("homepage_html", "")
    url = ctx.get("url", "")
    if not content or not url:
        return {"content": {"status": "skipped"}}

    content_lower = content.lower()
    result = {"status": "success"}

    # Community channels
    channels = []
    for pattern, channel in COMMUNITY_PATTERNS.items():
        if pattern in content_lower:
            channels.append(channel)
    result["communityChannels"] = list(set(channels))

    # Blog detection via RSS
    base = url.rstrip("/")
    rss_urls = [f"{base}/feed", f"{base}/rss", f"{base}/blog/feed", f"{base}/atom.xml"]
    blog_posts_per_month = None

    for rss_url in rss_urls:
        try:
            resp = requests.get(rss_url, timeout=5, headers={"User-Agent": "Mozilla/5.0"})
            if resp.status_code == 200 and ("<?xml" in resp.text[:100] or "<rss" in resp.text[:200]):
                root = ET.fromstring(resp.text)
                items = root.findall(".//item") or root.findall(".//{http://www.w3.org/2005/Atom}entry")
                if items:
                    blog_posts_per_month = round(len(items) / 3, 1)  # Rough estimate
                    break
        except Exception:
            continue

    result["blogPostsPerMonth"] = blog_posts_per_month

    # Changelog detection
    changelog_found = any(kw in content_lower for kw in ["/changelog", "/updates", "/whats-new", "what's new"])
    result["hasActiveChangelog"] = changelog_found

    # Referral detection
    referral_patterns = ["growsurf", "rewardful", "firstpromoter", "/referral", "/refer-a-friend", "/invite"]
    has_referral = any(p in content_lower for p in referral_patterns)
    result["hasReferralProgram"] = has_referral

    return {"content": result}


# ─── Pricing Page Analysis ────────────────────────────────────────────────────

@register("pricing_analysis", depends_on=["website_scrape"], tier=3)
def pricing_analysis(ctx: EnrichmentContext) -> dict:
    """Analyze pricing page if it exists."""
    pricing_html = ctx.get("pricing_html", "")
    url = ctx.get("url", "")

    if not pricing_html:
        # Check if homepage mentions pricing
        content = ctx.get("homepage_markdown", "") or ""
        has_pricing_link = bool(re.search(r'(?:/pricing|/plans|/packages)', content.lower()))
        if not has_pricing_link:
            return {"pricing": {"status": "success", "pageFound": False}}

        # Try to fetch pricing page with a simple GET (no Firecrawl credit)
        base = url.rstrip("/") if url else ""
        if not base:
            return {"pricing": {"status": "skipped", "pageFound": False}}

        for path in ["/pricing", "/plans", "/packages"]:
            try:
                resp = requests.get(f"{base}{path}", timeout=10,
                                  headers={"User-Agent": "Mozilla/5.0"},
                                  allow_redirects=True)
                if resp.status_code == 200 and len(resp.text) > 500:
                    pricing_html = resp.text
                    break
            except Exception:
                continue

    if not pricing_html:
        return {"pricing": {"status": "success", "pageFound": False}}

    text = pricing_html.lower()

    # Extract pricing signals
    tier_count = len(re.findall(r'(?:\$|£|€)\s*\d+', text))
    tier_count = min(max(tier_count, 0), 10)

    has_free = bool(re.search(r'(?:free\s*(?:plan|tier|forever|trial)|(?:\$|£|€)\s*0)', text))
    trial_match = re.search(r'(\d+)[\s-]*day\s*(?:free\s*)?trial', text)
    trial_days = int(trial_match.group(1)) if trial_match else None
    cc_required = bool(re.search(r'(?:credit\s*card|card\s*required)', text))
    has_annual = bool(re.search(r'(?:annual|yearly|per\s*year|billed\s*annually|/yr)', text))
    has_enterprise = bool(re.search(r'(?:enterprise|contact\s*(?:us|sales)|custom\s*pricing|get\s*(?:a\s*)?quote)', text))

    # Extract price points
    prices = re.findall(r'(?:\$|£|€)\s*\d+(?:\.\d{2})?(?:/mo(?:nth)?)?', text)
    prices = list(dict.fromkeys(prices))[:6]

    return {"pricing": {
        "status": "success",
        "pageFound": True,
        "tierCount": tier_count if tier_count > 0 else None,
        "hasFreeTier": has_free,
        "trialDays": trial_days,
        "ccRequired": cc_required,
        "hasAnnualToggle": has_annual,
        "hasEnterpriseTier": has_enterprise,
        "pricePoints": prices,
    }}


# ─── Signup Friction ──────────────────────────────────────────────────────────

@register("signup_friction", depends_on=["website_scrape"], tier=3)
def signup_friction(ctx: EnrichmentContext) -> dict:
    """Analyze signup page for friction signals."""
    signup_html = ctx.get("signup_html", "")
    url = ctx.get("url", "")

    if not signup_html:
        # Try to find signup page
        content = ctx.get("homepage_markdown", "") or ""
        has_signup_link = bool(re.search(r'(?:/signup|/register|/get-started|/trial|/create-account)', content.lower()))
        if not has_signup_link:
            return {"signup": {"status": "success", "pageFound": False}}

        base = url.rstrip("/") if url else ""
        if not base:
            return {"signup": {"status": "skipped", "pageFound": False}}

        for path in ["/signup", "/register", "/get-started", "/trial", "/sign-up"]:
            try:
                resp = requests.get(f"{base}{path}", timeout=10,
                                  headers={"User-Agent": "Mozilla/5.0"},
                                  allow_redirects=True)
                if resp.status_code == 200 and len(resp.text) > 300:
                    signup_html = resp.text
                    break
            except Exception:
                continue

    if not signup_html:
        return {"signup": {"status": "success", "pageFound": False}}

    text = signup_html.lower()

    # Count form fields
    field_count = len(re.findall(r'<input\s[^>]*type=["\'](?:text|email|password|tel|number)', text))
    if field_count == 0:
        # Try markdown input patterns
        field_count = len(re.findall(r'(?:email|password|name|phone|company|organization)\s*(?:\*|required)', text))

    # OAuth detection
    oauth_providers = []
    if "accounts.google.com" in text or "google" in text and "sign in with" in text:
        oauth_providers.append("Google")
    if "github.com/login" in text or "github" in text and "sign in with" in text:
        oauth_providers.append("GitHub")
    if "login.microsoftonline" in text or "microsoft" in text and "sign in with" in text:
        oauth_providers.append("Microsoft")
    if "apple" in text and "sign in with" in text:
        oauth_providers.append("Apple")

    # CAPTCHA
    has_captcha = bool(re.search(r'(?:recaptcha|hcaptcha|turnstile)', text))

    # Multi-step
    is_multi_step = bool(re.search(r'(?:step\s*\d|next\s*step|continue|progress[\s-]*bar)', text))

    # Friction level
    if field_count <= 3:
        friction = "low"
    elif field_count <= 5:
        friction = "medium"
    else:
        friction = "high"

    return {"signup": {
        "status": "success",
        "pageFound": True,
        "formFieldCount": field_count if field_count > 0 else None,
        "oauthProviders": oauth_providers,
        "hasCaptcha": has_captcha,
        "isMultiStep": is_multi_step,
        "frictionLevel": friction,
    }}
