"""Growth tool detection from page HTML using tool-signatures.json.

Detects SaaS tools by matching script URLs, global JS variables, and
DOM patterns against a reference file. Assesses growth stack maturity
based on detected tool combinations.

Registered as Tier 3 (depends on website_scrape for HTML).
"""

import json
import os
import sys

from .registry import register
from .schema import EnrichmentContext

eprint = lambda *a, **kw: print(*a, file=sys.stderr, **kw)

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
SIGNATURES_PATH = os.path.join(SCRIPT_DIR, "..", "..", "references", "tool-signatures.json")

# Categories that count as product analytics (for maturity assessment)
PRODUCT_ANALYTICS_CATS = {"product_analytics"}
SESSION_REPLAY_CATS = {"session_replay"}
EXPERIMENTATION_CATS = {"experimentation"}
ONBOARDING_CATS = {"onboarding"}

# Tools that include capabilities beyond their primary category.
# PostHog is a full platform: analytics + session replay + experimentation + feature flags.
# Amplitude and Mixpanel include experimentation (feature flags, A/B testing).
TOOLS_WITH_EXPERIMENTATION = {"PostHog", "Amplitude", "Mixpanel"}
TOOLS_WITH_SESSION_REPLAY = {"PostHog"}


def _load_signatures() -> dict:
    try:
        with open(SIGNATURES_PATH) as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError) as e:
        eprint(f"  [tool_detection] Failed to load signatures: {e}")
        return {}


def _detect_tools(content: str, signatures: dict) -> list[dict]:
    """Match content against tool signatures."""
    content_lower = content.lower()
    detected = []

    for category, tools in signatures.items():
        for tool in tools:
            name = tool["name"]
            for pattern in tool["patterns"]:
                if pattern.lower() in content_lower:
                    detected.append({
                        "name": name,
                        "category": category,
                        "source": f"pattern: {pattern}",
                    })
                    break  # One match per tool is enough

    return detected


def _assess_maturity(detected: list[dict]) -> dict:
    """Assess growth stack maturity from detected tools."""
    categories = {t["category"] for t in detected}
    tool_names = {t["name"] for t in detected}

    has_product_analytics = bool(categories & PRODUCT_ANALYTICS_CATS)
    has_session_replay = bool(
        (categories & SESSION_REPLAY_CATS) or
        (tool_names & TOOLS_WITH_SESSION_REPLAY)
    )
    # Experimentation: either a dedicated platform OR a tool that includes it
    has_experimentation = bool(
        (categories & EXPERIMENTATION_CATS) or
        (tool_names & TOOLS_WITH_EXPERIMENTATION)
    )
    has_onboarding = bool(categories & ONBOARDING_CATS)

    if has_product_analytics and has_session_replay and has_experimentation:
        level = "sophisticated"
    elif has_product_analytics and has_session_replay:
        level = "behaviour-informed"
    elif has_product_analytics:
        level = "data-aware"
    else:
        level = "pre-data-driven"

    return {
        "level": level,
        "hasProductAnalytics": has_product_analytics,
        "hasSessionReplay": has_session_replay,
        "hasExperimentation": has_experimentation,
        "hasOnboardingTooling": has_onboarding,
    }


def _identify_gaps(maturity: dict, detected: list[dict]) -> list[dict]:
    """Identify growth stack gaps based on maturity level.

    Does NOT flag gaps that are covered by multi-capability tools.
    E.g., PostHog covers both analytics and experimentation, so
    "no experimentation" is not a gap when PostHog is detected.
    """
    gaps = []

    if not maturity["hasProductAnalytics"]:
        gaps.append({
            "type": "no_product_analytics",
            "description": "No product analytics detected (Amplitude, Mixpanel, PostHog, Heap)",
            "talkingPoint": "You're running without product analytics — understanding what users do inside your product is the foundation for growth experimentation.",
            "impact": "high",
        })

    if maturity["hasProductAnalytics"] and not maturity["hasSessionReplay"]:
        gaps.append({
            "type": "no_session_replay",
            "description": "Product analytics present but no session replay (Hotjar, FullStory, LogRocket, Clarity)",
            "talkingPoint": "You're tracking events but can't watch users struggle — session replay shows exactly where and why people drop off.",
            "impact": "high",
        })

    if maturity["hasProductAnalytics"] and not maturity["hasExperimentation"]:
        # Only flag if no tool with built-in experimentation is detected
        gaps.append({
            "type": "no_experimentation",
            "description": "No experimentation platform detected (standalone or built into analytics)",
            "talkingPoint": "You have the data foundation but no structured way to run experiments — that's where compound growth comes from.",
            "impact": "medium",
        })

    if not maturity["hasOnboardingTooling"]:
        gaps.append({
            "type": "no_onboarding_tooling",
            "description": "No onboarding/digital adoption tool detected (Appcues, UserFlow, Chameleon)",
            "talkingPoint": "No onboarding tooling detected — most activation gains come from guiding users through their first value moment.",
            "impact": "medium",
        })

    return gaps


@register("tool_detection", depends_on=["website_scrape"], tier=3)
def tool_detection(ctx: EnrichmentContext) -> dict:
    """Detect SaaS tools and assess growth stack maturity."""
    content = ctx.get("homepage_html", "") or ctx.get("homepage_markdown", "")
    if not content:
        return {}

    signatures = _load_signatures()
    if not signatures:
        return {}

    detected = _detect_tools(content, signatures)
    eprint(f"  [tool_detection] Found {len(detected)} tools")

    maturity = _assess_maturity(detected)
    gaps = _identify_gaps(maturity, detected)

    return {
        "detectedTools": detected,
        "growthMaturity": maturity,
        "growthGaps": gaps,
    }
