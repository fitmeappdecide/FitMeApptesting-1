"""
Affiliate Service — shared strategy base classes (V2 Phase 7).

`retailers.json` (Retail Intelligence, V2 Phase 5) already documents which
of 3 tagging strategies each of the 8 real retailers uses, via
`affiliate_type`:

    query_param_tagging    -> amazon, flipkart
    utm_tagging             -> myntra, ajio, nykaafashion, lifestyle, westside
    utm_tagging_plus_cid    -> tatacliq

Rather than reimplementing tagging logic 8 times, each of the 8
`providers/<retailer>.py` files is a ~10-line subclass of ONE of the three
classes below, setting only its own env var name and (where relevant)
query param names. This keeps the requested one-file-per-retailer layout
(spec Section 4) without duplicating the actual tagging logic.

CREDENTIAL NOTE: env var names below (`AMAZON_ASSOCIATE_TAG`, etc.) are
NEW — no `_TAG_SPEC` or `.env` was available to reuse (see
ARCHITECTURE.md Section 14). Rename these to match your real affiliate
program credentials; nothing else needs to change.
"""
from __future__ import annotations

import logging
import os
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional

from ..base import BaseAffiliateProvider
from ..models import AffiliateResult
from ._url_tagging import add_query_params, is_well_formed_http_url

logger = logging.getLogger(__name__)


def _compute_expires_at(affiliate_expiry: Optional[str]) -> Optional[str]:
    """'24h' -> a real timestamp 24h out (persistent-enough to cache and
    reuse). 'session' or anything else/missing -> None, meaning "don't
    trust a cached value, regenerate on every use" (see
    AffiliateService.generate — this costs nothing since tagging is a
    pure string operation, not a network call)."""
    if not affiliate_expiry:
        return None
    affiliate_expiry = affiliate_expiry.strip().lower()
    if affiliate_expiry == "session":
        return None
    if affiliate_expiry.endswith("h"):
        try:
            hours = float(affiliate_expiry[:-1])
            return (datetime.now(timezone.utc) + timedelta(hours=hours)).isoformat()
        except ValueError:
            logger.warning("Unrecognized affiliate_expiry format %r; treating as session-based.",
                           affiliate_expiry)
            return None
    if affiliate_expiry.endswith("d"):
        try:
            days = float(affiliate_expiry[:-1])
            return (datetime.now(timezone.utc) + timedelta(days=days)).isoformat()
        except ValueError:
            return None
    logger.warning("Unrecognized affiliate_expiry format %r; treating as session-based.",
                   affiliate_expiry)
    return None


class _EnvCredentialProviderMixin:
    """Shared credential lookup: one required env var, read fresh each
    time (not cached) so a credential added/rotated without a restart
    (e.g. in a dev environment) is picked up immediately."""
    env_var: str = ""

    def has_credentials(self) -> bool:
        return bool(os.environ.get(self.env_var, "").strip())

    def _credential(self) -> Optional[str]:
        return os.environ.get(self.env_var, "").strip() or None


class QueryParamTaggingProvider(_EnvCredentialProviderMixin, BaseAffiliateProvider):
    """affiliate_type == 'query_param_tagging' (Amazon Associates-style:
    a single query param carrying the tag/associate id)."""
    param_name: str = "tag"

    def generate(self, product_url: str, context: Dict[str, Any]) -> AffiliateResult:
        if not is_well_formed_http_url(product_url):
            return AffiliateResult(self.retailer, product_url, None, False,
                                   type(self).__name__, None, None, error="malformed_url")
        tag = self._credential()
        if not tag:
            return AffiliateResult(self.retailer, product_url, None, False,
                                   type(self).__name__, None, None, error="missing_credentials")
        affiliate_url = add_query_params(product_url, {self.param_name: tag})
        expires_at = _compute_expires_at(context.get("affiliate_expiry"))
        return AffiliateResult(self.retailer, product_url, affiliate_url, True,
                               type(self).__name__, expires_at, None)


class UtmTaggingProvider(_EnvCredentialProviderMixin, BaseAffiliateProvider):
    """affiliate_type == 'utm_tagging'."""
    utm_source: str = "shoppinglens"
    utm_medium: str = "affiliate"

    def generate(self, product_url: str, context: Dict[str, Any]) -> AffiliateResult:
        if not is_well_formed_http_url(product_url):
            return AffiliateResult(self.retailer, product_url, None, False,
                                   type(self).__name__, None, None, error="malformed_url")
        affiliate_id = self._credential()
        if not affiliate_id:
            return AffiliateResult(self.retailer, product_url, None, False,
                                   type(self).__name__, None, None, error="missing_credentials")
        affiliate_url = add_query_params(product_url, {
            "utm_source": self.utm_source,
            "utm_medium": self.utm_medium,
            "utm_campaign": affiliate_id,
        })
        expires_at = _compute_expires_at(context.get("affiliate_expiry"))
        return AffiliateResult(self.retailer, product_url, affiliate_url, True,
                               type(self).__name__, expires_at, None)


class UtmTaggingPlusCidProvider(UtmTaggingProvider):
    """affiliate_type == 'utm_tagging_plus_cid' (UTM tagging plus a
    network-specific click/campaign id param — TataCliq today)."""
    cid_param_name: str = "cid"

    def generate(self, product_url: str, context: Dict[str, Any]) -> AffiliateResult:
        result = super().generate(product_url, context)
        if not result.generated:
            return result
        affiliate_id = self._credential()
        affiliate_url = add_query_params(result.affiliate_url, {self.cid_param_name: affiliate_id})
        return AffiliateResult(self.retailer, product_url, affiliate_url, True,
                               type(self).__name__, result.expires_at, None)
