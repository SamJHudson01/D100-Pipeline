"""Deterministic BLUF and talking point generation from enrichment data.

Generates the outreach angle and talking points from validated enrichment
signals. No LLM — pure rules. The LLM-generated personal hook is added
by SKILL.md during the pipeline orchestration phase.

Categories:
- GROWTH STACK GAP — missing analytics/experimentation/replay tools
- CONVERSION FRICTION — high signup friction, missing OAuth
- TIMING + OPPORTUNITY — recent funding + identifiable gaps
- PLG MOTION — self-serve product with monetisation
- MONETISATION GAP — missing annual toggle, no free tier
- LIMITED DATA — insufficient enrichment signals
"""

import sys

from .schema import EnrichmentData

eprint = lambda *a, **kw: print(*a, file=sys.stderr, **kw)


def generate_bluf(enrichment: EnrichmentData) -> dict:
    """Generate a data-driven BLUF from enrichment signals.

    Returns {"bluf": {"category": str, "text": str}} or empty dict.
    """
    signals = _rank_signals(enrichment)

    if not signals:
        return {"bluf": {
            "category": "LIMITED DATA",
            "text": "Enrichment couldn't detect enough growth signals. Consider manual website review before investing Loom time.",
        }}

    # Pick the best category and combine top signals
    top = signals[0]
    category = top["category"]

    # Build BLUF text from top 2-3 signals
    parts = [s["text"] for s in signals[:3]]
    text = " ".join(parts)

    return {"bluf": {"category": category, "text": text}}


def generate_talking_points(enrichment: EnrichmentData) -> list[str]:
    """Generate 3-5 speakable talking points from enrichment data.

    Each point is a complete sentence, 15-25 words, no ellipses.
    Gaps first (opportunities), then positive signals (credibility builders).
    """
    points: list[str] = []

    ws = enrichment.get("webSearch", {})
    pricing = enrichment.get("pricing", {})
    signup = enrichment.get("signup", {})
    social = enrichment.get("socialProof", {})
    cta = enrichment.get("cta", {})
    content = enrichment.get("content", {})
    gm = enrichment.get("growthMaturity", {})
    gaps = enrichment.get("growthGaps", [])
    kp = enrichment.get("keyPeople", [])
    ss = enrichment.get("structuredSources", {})

    # Gap-based talking points (opportunities)
    if signup.get("pageFound") and signup.get("formFieldCount") and signup["formFieldCount"] > 4:
        count = signup["formFieldCount"]
        points.append(
            f"Your signup asks for {count} pieces of information — reducing to email-only with progressive profiling typically doubles conversion."
        )

    if signup.get("pageFound") and not signup.get("oauthProviders"):
        points.append(
            "No social login on your signup — adding Google OAuth removes the biggest friction point for B2B users."
        )

    if pricing.get("pageFound") and pricing.get("hasAnnualToggle") is False:
        points.append(
            "Your pricing page doesn't offer annual billing — most SaaS companies see 15-20% revenue uplift from adding it."
        )

    if social.get("caseStudyCount", 0) == 0 and social.get("customerLogoCount", 0) > 0:
        points.append(
            "You've got customer logos but no published case studies — a single case study on the homepage can lift conversion 10-15%."
        )

    if social.get("customerLogoCount", 0) == 0 and social.get("testimonialCount", 0) == 0:
        points.append(
            "No customer logos or testimonials on the homepage — this is a significant trust gap for new visitors."
        )

    # Growth gap talking points
    for gap in gaps[:2]:
        tp = gap.get("talkingPoint", "")
        if tp and len(tp) < 120:
            points.append(tp)

    # Positive signal talking points (credibility builders)
    if ss.get("yc"):
        batch = ss["yc"].get("batch", "")
        if batch:
            points.append(f"Coming out of YC {batch} gives you a strong foundation — the question is how to convert that momentum into systematic growth.")

    funding = ws.get("fundingStage")
    amount = ws.get("fundingAmount")
    if funding and amount:
        points.append(
            f"With your recent {funding} of {amount}, you have the runway to invest in growth experimentation before the next milestone."
        )
    elif funding:
        points.append(
            f"Coming off your {funding}, the pressure to show growth metrics to investors is real — structured experimentation accelerates that."
        )

    if cta.get("type") == "plg":
        points.append(
            "Your self-serve model means every signup-to-activation improvement compounds — this is where growth experimentation has the highest ROI."
        )

    # Content/community positive signals
    if content.get("communityChannels"):
        channels = ", ".join(content["communityChannels"][:2])
        points.append(f"Your {channels} community is a growth asset most startups at your stage don't have.")

    # Cap at 5, prioritize gaps
    return points[:5]


def _rank_signals(enrichment: EnrichmentData) -> list[dict]:
    """Rank enrichment signals by outreach impact. Returns list of {category, text, score}."""
    signals = []

    ws = enrichment.get("webSearch", {})
    pricing = enrichment.get("pricing", {})
    signup = enrichment.get("signup", {})
    social = enrichment.get("socialProof", {})
    gm = enrichment.get("growthMaturity", {})
    gaps = enrichment.get("growthGaps", [])
    tools = enrichment.get("detectedTools", [])

    # TIMING + OPPORTUNITY: recent funding + gaps
    funding = ws.get("fundingStage")
    amount = ws.get("fundingAmount")
    if funding:
        gap_count = len(gaps)
        if gap_count > 0:
            signals.append({
                "category": "TIMING + OPPORTUNITY",
                "text": f"Just raised {funding}{' of ' + amount if amount else ''} with {gap_count} identifiable growth gaps.",
                "score": 10,
            })
        else:
            signals.append({
                "category": "TIMING + OPPORTUNITY",
                "text": f"Recently raised {funding}{' of ' + amount if amount else ''} — now is the optimal window for growth investment.",
                "score": 7,
            })

    # CONVERSION FRICTION
    if signup.get("pageFound") and (signup.get("formFieldCount") or 0) > 4:
        signals.append({
            "category": "CONVERSION FRICTION",
            "text": f"Signup has {signup['formFieldCount']} form fields{' and no OAuth' if not signup.get('oauthProviders') else ''} — likely losing 40-60% of interested users at the door.",
            "score": 9,
        })

    # GROWTH STACK GAP
    if gm and gm.get("level") in ("pre-data-driven",):
        signals.append({
            "category": "GROWTH STACK GAP",
            "text": "Running without product analytics — flying blind on user behaviour. Every growth insight will be new to them.",
            "score": 8,
        })
    elif gm and gm.get("level") == "data-aware" and not gm.get("hasSessionReplay"):
        signals.append({
            "category": "GROWTH STACK GAP",
            "text": "Data-aware (has product analytics) but no session replay — can see what users do but not watch them struggle.",
            "score": 7,
        })

    # MONETISATION GAP
    if pricing.get("pageFound") and not pricing.get("hasAnnualToggle"):
        signals.append({
            "category": "MONETISATION GAP",
            "text": "Pricing page has no annual billing toggle — typically 15-20% revenue left on the table.",
            "score": 6,
        })

    # PLG MOTION
    if signup.get("pageFound") and pricing.get("hasFreeTier"):
        signals.append({
            "category": "PLG MOTION",
            "text": "Product-led with free tier and self-serve signup — activation and conversion experiments have the highest ROI here.",
            "score": 5,
        })

    # Sort by score descending
    signals.sort(key=lambda s: s["score"], reverse=True)
    return signals
