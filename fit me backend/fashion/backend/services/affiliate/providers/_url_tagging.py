"""
Affiliate Service — URL tagging helpers (V2 Phase 7).

Pure functions only: given a product URL and tag values, return a new URL
with query params added/replaced. No credential lookup, no I/O — that
stays in the provider classes so it's testable without env vars.
"""
from __future__ import annotations

from urllib.parse import urlencode, urlparse, urlunparse, parse_qsl


def add_query_params(url: str, params: dict) -> str:
    """Adds/overwrites the given query params on `url`, preserving
    existing ones not being overwritten, path, and fragment."""
    parsed = urlparse(url)
    existing = dict(parse_qsl(parsed.query, keep_blank_values=True))
    existing.update({k: v for k, v in params.items() if v is not None})
    new_query = urlencode(existing)
    return urlunparse(parsed._replace(query=new_query))


def is_well_formed_http_url(url: str) -> bool:
    if not isinstance(url, str) or not url.startswith(("http://", "https://")):
        return False
    parsed = urlparse(url)
    return bool(parsed.netloc) and bool(parsed.path or parsed.query)
