"""
Affiliate Service — orchestrator (V2 Phase 7).

    retailer_id, product_url
        -> RetailResolver().resolve_by_id(retailer_id)      [Retail Intelligence, V2 Phase 5 — reused, not duplicated]
        -> validate product_url's domain against profile.known_domains  [security: Section 8]
        -> affiliate_supported? no -> controlled non-affiliate result
        -> registry.get_provider(retailer_id) -> has_credentials()?
        -> provider.generate() -> AffiliateResult

This is the only module `server.py` should import from for affiliate
generation — `AffiliateService.generate()` and `.regenerate_if_expired()`.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any, Dict, Optional
from urllib.parse import urlparse

from services.retail_intelligence.resolver import RetailResolver

from . import registry
from .models import AffiliateResult

logger = logging.getLogger(__name__)


def _host(url: str) -> str:
    try:
        h = urlparse(url).netloc.lower()
        return h[4:] if h.startswith("www.") else h
    except Exception:  # noqa: BLE001
        return ""


class AffiliateService:
    def __init__(self) -> None:
        self._resolver = RetailResolver()

    def generate(self, retailer_id: str, product_url: str,
                 tracking_id: Optional[str] = None) -> AffiliateResult:
        """Never raises. Every rejection path returns a typed
        `AffiliateResult(generated=False, error=...)` — callers (the
        `/affiliate/click` endpoint) turn that into a controlled failure
        response, never a silent raw-URL fallback (spec Section 12)."""
        if not retailer_id or not product_url:
            return AffiliateResult(retailer_id or "", product_url or "", None, False,
                                   "AffiliateService", None, tracking_id, error="missing_input")

        profile = self._resolver.resolve_by_id(retailer_id)
        if not profile.resolved:
            logger.warning("Affiliate: retailer %r not resolvable via Retail Intelligence; refusing to guess.",
                          retailer_id)
            return AffiliateResult(retailer_id, product_url, None, False,
                                   "AffiliateService", None, tracking_id, error="unknown_retailer")

        # Security (Section 8): the caller says "amazon" — confirm the URL
        # they actually supplied belongs to a domain Retail Intelligence
        # knows for amazon, using ITS domain list (adapters.registry's
        # base_url + retailers.json), not a second hardcoded one.
        product_host = _host(product_url)
        if not product_host or product_host not in profile.known_domains:
            logger.warning("Affiliate: URL host %r for retailer %r not in known_domains %s; rejecting.",
                          product_host, retailer_id, profile.known_domains)
            return AffiliateResult(retailer_id, product_url, None, False,
                                   "AffiliateService", None, tracking_id, error="url_domain_mismatch")

        if not profile.affiliate_supported:
            return AffiliateResult(retailer_id, product_url, None, False,
                                   "AffiliateService", None, tracking_id, error="affiliate_not_supported")

        provider = registry.get_provider(retailer_id)
        if provider is None:
            # Resolved + affiliate_supported=true per Retail Intelligence,
            # but no dedicated provider code exists yet — controlled
            # failure via the generic provider, never a guess.
            provider = registry.get_generic_provider()

        if not provider.supports(product_url):
            return AffiliateResult(retailer_id, product_url, None, False,
                                   type(provider).__name__, None, tracking_id, error="malformed_url")

        if not provider.has_credentials():
            return AffiliateResult(retailer_id, product_url, None, False,
                                   type(provider).__name__, None, tracking_id, error="missing_credentials")

        context = {"retailer": retailer_id, "affiliate_expiry": profile.affiliate_expiry}
        result = provider.generate(product_url, context)
        result.tracking_id = tracking_id
        return result

    def regenerate_if_expired(self, stored: Dict[str, Any]) -> AffiliateResult:
        """`stored` is a previously-saved click doc (retailer, original_url,
        expires_at, ...). Reuses the existing affiliate_url if it's still
        valid; regenerates otherwise. A `None` expires_at (session-based,
        or unknown format) is ALWAYS treated as needing regeneration —
        tagging is a cheap string operation, not a network call, so
        regenerating on every use for session-based retailers costs
        nothing and avoids ever serving a link whose validity we can't
        actually vouch for (Section 10)."""
        expires_at = stored.get("expires_at")
        still_valid = False
        if expires_at:
            try:
                still_valid = datetime.fromisoformat(expires_at) > datetime.now(timezone.utc)
            except ValueError:
                still_valid = False

        if still_valid and stored.get("generated") and stored.get("affiliate_url"):
            return AffiliateResult(
                retailer=stored["retailer"], original_url=stored["original_url"],
                affiliate_url=stored["affiliate_url"], generated=True,
                provider=stored.get("provider", "cached"), expires_at=expires_at,
                tracking_id=stored.get("tracking_id"),
            )

        return self.generate(stored["retailer"], stored["original_url"],
                             tracking_id=stored.get("tracking_id"))


_service: Optional[AffiliateService] = None


def get_affiliate_service() -> AffiliateService:
    global _service
    if _service is None:
        _service = AffiliateService()
    return _service
