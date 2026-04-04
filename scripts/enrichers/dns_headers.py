"""DNS and HTTP header enrichment — zero cost, unlimited.

Detects hosting provider, CDN, email provider from DNS records
and HTTP response headers.
"""

import re
import subprocess
import sys

import requests

from .registry import register
from .schema import EnrichmentContext

eprint = lambda *a, **kw: print(*a, file=sys.stderr, **kw)

# Domain validation — prevent SSRF
DOMAIN_RE = re.compile(r'^[a-z0-9]([a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$')

HOSTING_HEADERS = {
    "x-vercel-id": "Vercel",
    "x-powered-by: next.js": "Vercel (Next.js)",
    "via: 1.1 vegur": "Heroku",
    "server: cloudflare": "Cloudflare",
    "x-amz-cf-id": "AWS CloudFront",
    "x-github-request-id": "GitHub Pages",
    "server: netlify": "Netlify",
    "x-fly-request-id": "Fly.io",
    "server: render": "Render",
}

MX_PROVIDERS = {
    "google": "Google Workspace",
    "aspmx": "Google Workspace",
    "outlook": "Microsoft 365",
    "protection.outlook": "Microsoft 365",
    "pphosted": "Proofpoint",
    "mimecast": "Mimecast",
    "zoho": "Zoho Mail",
    "secureserver": "GoDaddy",
}

CNAME_HOSTING = {
    "herokuapp.com": "Heroku",
    "herokudns.com": "Heroku",
    "netlify.app": "Netlify",
    "vercel-dns.com": "Vercel",
    "render.com": "Render",
    "fly.dev": "Fly.io",
    "railway.app": "Railway",
    "azurewebsites.net": "Azure",
    "cloudfront.net": "AWS CloudFront",
}


def _is_valid_domain(domain: str) -> bool:
    return bool(DOMAIN_RE.match(domain.lower())) and not any(
        domain.startswith(p) for p in ("127.", "10.", "192.168.", "172.")
    )


def _dig(record_type: str, domain: str, timeout: int = 5) -> str | None:
    """Run dig and return the answer section."""
    if not _is_valid_domain(domain):
        return None
    try:
        result = subprocess.run(
            ["dig", "+short", record_type, domain],
            capture_output=True, text=True, timeout=timeout,
            shell=False,
        )
        return result.stdout.strip() if result.returncode == 0 else None
    except (subprocess.TimeoutExpired, FileNotFoundError):
        return None


def _head_request(url: str, timeout: int = 5) -> dict[str, str]:
    """Do a HEAD request and return response headers."""
    try:
        resp = requests.head(url, timeout=timeout, allow_redirects=True,
                           headers={"User-Agent": "Mozilla/5.0"})
        return {k.lower(): v.lower() for k, v in resp.headers.items()}
    except Exception:
        return {}


@register("dns_headers", tier=1)
def dns_headers(ctx: EnrichmentContext) -> dict:
    """Detect hosting, CDN, and email provider from DNS/headers."""
    domain = ctx.get("domain", "")
    url = ctx.get("url", "")

    if not domain or not _is_valid_domain(domain):
        return {"infrastructure": {"status": "skipped"}}

    result = {"status": "success"}

    # 1. MX records → email provider
    mx_output = _dig("MX", domain)
    if mx_output:
        mx_lower = mx_output.lower()
        for pattern, provider in MX_PROVIDERS.items():
            if pattern in mx_lower:
                result["emailProvider"] = provider
                break

    # 2. CNAME for app subdomain → hosting
    cname_output = _dig("CNAME", f"app.{domain}")
    if cname_output:
        cname_lower = cname_output.lower()
        for pattern, hosting in CNAME_HOSTING.items():
            if pattern in cname_lower:
                result["appHosting"] = hosting
                break

    # 3. HTTP headers → hosting provider + CDN
    if url:
        headers = _head_request(url)
        for header_key, provider in HOSTING_HEADERS.items():
            if ":" in header_key:
                # Check header: value pair
                h, v = header_key.split(": ", 1)
                if headers.get(h, "") == v:
                    result["hostingProvider"] = provider
                    result["hostingSource"] = f"{h} header"
                    break
            else:
                if header_key in headers:
                    result["hostingProvider"] = provider
                    result["hostingSource"] = f"{header_key} header"
                    break

        # CDN detection
        if "server" in headers and "cloudflare" in headers["server"]:
            result["cdn"] = "Cloudflare"
        elif "x-amz-cf-id" in headers:
            result["cdn"] = "CloudFront"
        elif "x-fastly-request-id" in headers:
            result["cdn"] = "Fastly"

    return {"infrastructure": result}
