"""
Affiliate Service — provider contract (V2 Phase 7).

Mirrors the shape of `adapters/base.py::BaseAdapter` (retailer id +
capability check + one action method) — same architectural philosophy the
spec asks for, applied to affiliate generation instead of search.

IMPORTANT: `supports(url)` here is deliberately NOT a domain check.
Domain/URL legitimacy against the expected retailer is validated ONCE,
centrally, in `service.py`, using `RetailResolver`'s existing
`known_domains` (itself derived live from `adapters.registry` +
`retailers.json` — see Retail Intelligence, V2 Phase 5). Re-implementing
domain matching inside every provider would be exactly the "another
hardcoded domain list" the spec explicitly says not to build. A
provider's `supports(url)` only needs to confirm the URL is well-formed
enough for ITS tagging scheme (e.g. has a path to append a query param
to) — retailer identity has already been established by the time a
provider is even selected.
"""
from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any, Dict

from .models import AffiliateResult


class BaseAffiliateProvider(ABC):
    retailer: str = ""

    def supports(self, url: str) -> bool:
        """Well-formedness check only (see module docstring) — override
        if a retailer's tagging scheme needs something more specific.
        Default: any non-empty http(s) URL."""
        return isinstance(url, str) and url.startswith(("http://", "https://"))

    @abstractmethod
    def has_credentials(self) -> bool:
        """Whether this provider's required env var(s) are actually set.
        Checked before generate() so a missing-credential failure is
        reported precisely (`error="missing_credentials"`) rather than
        surfacing as a confusing malformed-URL result."""
        raise NotImplementedError

    @abstractmethod
    def generate(self, product_url: str, context: Dict[str, Any]) -> AffiliateResult:
        """`context` carries the resolved RetailProfile-derived fields the
        provider may need (currently just `affiliate_expiry`); providers
        must never fabricate a tag/id that isn't actually configured —
        return `AffiliateResult(generated=False, error="missing_credentials")`
        instead."""
        raise NotImplementedError
