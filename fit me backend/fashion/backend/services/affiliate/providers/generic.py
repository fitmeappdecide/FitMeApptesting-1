"""
Generic fallback provider (V2 Phase 7, spec Section 16).

Used ONLY when a retailer resolves via Retail Intelligence but has no
dedicated provider registered — NOT a catch-all that guesses tagging
schemes for unknown retailers. Per spec: never scrapes arbitrary
affiliate links, never guesses tracking parameters, never fabricates a
tag, never accepts an unrecognized domain (domain legitimacy is already
enforced upstream in service.py before this is ever reached). It exists
so an unsupported-but-resolvable retailer gets a clean, typed
`generated=False` result instead of a KeyError.
"""
from typing import Any, Dict

from ..base import BaseAffiliateProvider
from ..models import AffiliateResult


class GenericAffiliateProvider(BaseAffiliateProvider):
    retailer = "generic"

    def has_credentials(self) -> bool:
        return False

    def generate(self, product_url: str, context: Dict[str, Any]) -> AffiliateResult:
        return AffiliateResult(
            retailer=context.get("retailer", "unknown"),
            original_url=product_url,
            affiliate_url=None,
            generated=False,
            provider=type(self).__name__,
            expires_at=None,
            tracking_id=None,
            error="no_affiliate_mechanism",
        )
