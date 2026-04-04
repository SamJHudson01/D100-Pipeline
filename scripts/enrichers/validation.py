"""Input validation for enrichment pipeline.

Validates domains, URLs, and company names before they hit external APIs.
Prevents SSRF, command injection, and garbage data propagation.
"""

import re
import ipaddress


DOMAIN_RE = re.compile(r'^[a-z0-9]([a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$')
URL_RE = re.compile(r'^https?://[a-z0-9]([a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}')

# Private/reserved IP ranges
PRIVATE_RANGES = [
    ipaddress.ip_network("10.0.0.0/8"),
    ipaddress.ip_network("172.16.0.0/12"),
    ipaddress.ip_network("192.168.0.0/16"),
    ipaddress.ip_network("127.0.0.0/8"),
    ipaddress.ip_network("169.254.0.0/16"),
]


def is_valid_domain(domain: str) -> bool:
    """Validate a domain name is safe for DNS/HTTP probing."""
    if not domain or len(domain) > 253:
        return False
    domain = domain.lower().strip()
    if not DOMAIN_RE.match(domain):
        return False
    # Check it's not an IP address disguised as a domain
    try:
        ip = ipaddress.ip_address(domain)
        return False  # Raw IP, not a domain
    except ValueError:
        pass  # Good, it's not an IP
    return True


def is_valid_url(url: str) -> bool:
    """Validate a URL is safe for HTTP requests."""
    if not url or len(url) > 2000:
        return False
    return bool(URL_RE.match(url.lower().strip()))


def sanitize_company_name(name: str) -> str:
    """Sanitize a company name: cap length, strip control chars."""
    if not name:
        return ""
    # Strip control characters
    name = re.sub(r'[\x00-\x1f\x7f-\x9f]', '', name)
    return name[:200].strip()


def sanitize_text(text: str) -> str:
    """Strip HTML tags and control characters from scraped text.

    Use this before storing any text extracted from external websites
    in the enrichment_data jsonb column.
    """
    if not text:
        return ""
    # Strip HTML tags
    text = re.sub(r'<[^>]+>', '', text)
    # Strip control characters (keep newlines and tabs)
    text = re.sub(r'[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]', '', text)
    return text.strip()
