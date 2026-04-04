"""Email finder — scrape extraction + pattern generation + SMTP verification.

Zero external API cost. Runs last in the enrichment sequence.

Steps:
1. Extract emails from scraped HTML (mailto: links, regex)
2. Generate candidates from founder name + domain patterns
3. SMTP verify candidates against MX server (no email sent)
"""

import re
import smtplib
import socket
import subprocess
import sys

from .registry import register
from .schema import EnrichmentContext

eprint = lambda *a, **kw: print(*a, file=sys.stderr, **kw)

GENERIC_PREFIXES = {"info", "support", "hello", "contact", "team", "sales", "admin",
                    "help", "billing", "press", "marketing", "careers", "jobs", "hr"}

DOMAIN_RE = re.compile(r'^[a-z0-9]([a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$')


def _extract_emails_from_html(html: str, domain: str) -> tuple[list[str], list[str]]:
    """Extract personal and generic emails from HTML content."""
    if not html:
        return [], []

    # Find all emails matching the company domain
    email_pattern = re.compile(
        rf'[a-zA-Z0-9._%+-]+@{re.escape(domain)}',
        re.IGNORECASE,
    )

    # Also check mailto: links
    mailto_pattern = re.compile(r'mailto:([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})', re.IGNORECASE)

    all_emails = set()
    for m in email_pattern.finditer(html):
        all_emails.add(m.group(0).lower())
    for m in mailto_pattern.finditer(html):
        email = m.group(1).lower()
        if domain in email:
            all_emails.add(email)

    personal = []
    generic = []
    for email in all_emails:
        prefix = email.split("@")[0].lower()
        if prefix in GENERIC_PREFIXES:
            generic.append(email)
        else:
            personal.append(email)

    return personal, generic


def _generate_candidates(first_name: str, last_name: str, domain: str) -> list[str]:
    """Generate email candidates from common SaaS patterns."""
    first = first_name.lower().strip()
    last = last_name.lower().strip()
    if not first or not last:
        return [f"{first}@{domain}"] if first else []

    return [
        f"{first}@{domain}",
        f"{first}.{last}@{domain}",
        f"{first[0]}{last}@{domain}",
        f"{first[0]}.{last}@{domain}",
        f"{first}{last}@{domain}",
    ]


def _get_mx_host(domain: str) -> str | None:
    """Look up MX record for domain."""
    if not DOMAIN_RE.match(domain.lower()):
        return None
    try:
        result = subprocess.run(
            ["dig", "+short", "MX", domain],
            capture_output=True, text=True, timeout=5, shell=False,
        )
        if result.returncode != 0 or not result.stdout.strip():
            return None
        # Parse MX records (format: "10 mx.example.com.")
        lines = result.stdout.strip().split("\n")
        for line in sorted(lines):  # Lowest priority first
            parts = line.split()
            if len(parts) >= 2:
                return parts[1].rstrip(".")
        return None
    except (subprocess.TimeoutExpired, FileNotFoundError):
        return None


def _smtp_verify(email: str, mx_host: str, timeout: int = 5) -> bool | None:
    """Verify email via SMTP RCPT TO. Returns True/False/None (error)."""
    try:
        smtp = smtplib.SMTP(timeout=timeout)
        smtp.connect(mx_host, 25)
        smtp.helo("prospectqualifier.local")
        smtp.mail("verify@prospectqualifier.local")
        code, _ = smtp.rcpt(email)
        smtp.quit()
        return code == 250
    except (smtplib.SMTPException, socket.error, OSError) as e:
        eprint(f"  [email_finder] SMTP error for {email}: {e}")
        return None


def _detect_catch_all(domain: str, mx_host: str) -> bool:
    """Check if domain has a catch-all policy by testing a random address."""
    random_email = f"xyznonexistent12345@{domain}"
    result = _smtp_verify(random_email, mx_host)
    return result is True  # If random address is accepted, it's catch-all


@register("email_finder", depends_on=["web_search", "website_scrape"], tier=4)
def email_finder(ctx: EnrichmentContext) -> dict:
    """Find founder email via scrape extraction, pattern generation, and SMTP."""
    domain = ctx.get("domain", "")
    result = ctx.get("result", {})
    key_people = result.get("keyPeople", [])

    if not domain or not DOMAIN_RE.match(domain.lower()):
        return {"contact": {"status": "skipped"}}

    contact = {"status": "success"}

    # Step 1: Extract from scraped HTML
    html = ctx.get("homepage_html", "") or ctx.get("homepage_markdown", "")
    personal_emails, generic_emails = _extract_emails_from_html(html, domain)

    if generic_emails:
        contact["companyEmails"] = generic_emails

    if personal_emails:
        contact["founderEmail"] = personal_emails[0]
        contact["emailSource"] = "website_mailto"
        contact["emailConfidence"] = "high"
        contact["smtpVerified"] = False  # Found directly, skip SMTP
        eprint(f"  [email_finder] Found email on website: {personal_emails[0]}")
        return {"contact": contact}

    # Step 2: Generate candidates from founder name
    founder = None
    for person in key_people:
        if person.get("role") in ("founder", "ceo"):
            founder = person
            break
    if not founder and key_people:
        founder = key_people[0]

    if not founder:
        contact["status"] = "success"
        contact["founderEmail"] = None
        return {"contact": contact}

    name_parts = founder["name"].split()
    if len(name_parts) < 2:
        contact["founderEmail"] = None
        return {"contact": contact}

    first_name = name_parts[0]
    last_name = name_parts[-1]
    candidates = _generate_candidates(first_name, last_name, domain)

    # Step 3: SMTP verification
    mx_host = _get_mx_host(domain)
    if not mx_host:
        # No MX — use best guess pattern without verification
        contact["founderEmail"] = candidates[0] if candidates else None
        contact["emailSource"] = "pattern_unverified"
        contact["emailConfidence"] = "low"
        contact["smtpVerified"] = False
        contact["candidatesTried"] = candidates[:1]
        return {"contact": contact}

    # Check catch-all first
    is_catch_all = _detect_catch_all(domain, mx_host)
    if is_catch_all:
        contact["founderEmail"] = candidates[0] if candidates else None
        contact["emailSource"] = "pattern_unverified"
        contact["emailConfidence"] = "low"
        contact["smtpVerified"] = False
        contact["catchAllDomain"] = True
        contact["candidatesTried"] = candidates[:1]
        eprint(f"  [email_finder] Catch-all domain: {domain}")
        return {"contact": contact}

    # Verify candidates
    tried = []
    failed = []
    for email in candidates:
        tried.append(email)
        verified = _smtp_verify(email, mx_host)
        if verified:
            contact["founderEmail"] = email
            contact["emailSource"] = "pattern_verified"
            contact["emailConfidence"] = "high"
            contact["smtpVerified"] = True
            contact["candidatesTried"] = tried
            contact["candidatesFailed"] = failed
            eprint(f"  [email_finder] Verified: {email}")
            return {"contact": contact}
        elif verified is False:
            failed.append(email)

    # No verified email found
    contact["founderEmail"] = candidates[0] if candidates else None
    contact["emailSource"] = "pattern_unverified"
    contact["emailConfidence"] = "low"
    contact["smtpVerified"] = False
    contact["candidatesTried"] = tried
    contact["candidatesFailed"] = failed
    return {"contact": contact}
