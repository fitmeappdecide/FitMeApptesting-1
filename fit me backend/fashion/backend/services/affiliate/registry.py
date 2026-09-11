"""
Affiliate Service — provider registry (V2 Phase 7).

Mirrors `adapters/registry.py`'s `_ADAPTERS` list + lookup-by-id pattern.
One instance per provider, built once at import time (providers are
stateless — they read env vars fresh on each call, see
`_EnvCredentialProviderMixin`).
"""
from __future__ import annotations

from typing import Dict, Optional

from .base import BaseAffiliateProvider
from .providers.amazon import AmazonAffiliateProvider
from .providers.cuelinks import CuelinksAffiliateProvider
from .providers.flipkart import FlipkartAffiliateProvider
from .providers.myntra import MyntraAffiliateProvider
from .providers.ajio import AjioAffiliateProvider
from .providers.nykaa import NykaaFashionAffiliateProvider
from .providers.tatacliq import TataCliqAffiliateProvider
from .providers.lifestyle import LifestyleAffiliateProvider
from .providers.westside import WestsideAffiliateProvider
from .providers.generic import GenericAffiliateProvider

_cuelinks_provider = CuelinksAffiliateProvider()

_FALLBACK_PROVIDERS: Dict[str, BaseAffiliateProvider] = {
    p.retailer: p for p in [
        AmazonAffiliateProvider(),
        FlipkartAffiliateProvider(),
        MyntraAffiliateProvider(),
        AjioAffiliateProvider(),
        NykaaFashionAffiliateProvider(),
        TataCliqAffiliateProvider(),
        LifestyleAffiliateProvider(),
        WestsideAffiliateProvider(),
    ]
}

_GENERIC = GenericAffiliateProvider()

CUELINKS_TARGET_RETAILERS = {"myntra", "ajio", "nykaafashion", "nykaa", "flipkart", "tatacliq", "lifestyle", "westside"}


def get_provider(retailer_id: str) -> Optional[BaseAffiliateProvider]:
    """Returns the dedicated provider for a retailer, preferring Cuelinks API
    for target Indian fashion retailers when credentials are set."""
    rid = (retailer_id or "").strip().lower()

    if rid in CUELINKS_TARGET_RETAILERS and _cuelinks_provider.has_credentials():
        return _cuelinks_provider

    return _FALLBACK_PROVIDERS.get(rid)


def get_generic_provider() -> BaseAffiliateProvider:
    return _GENERIC


def registered_retailers() -> list[str]:
    return sorted(list(set(_FALLBACK_PROVIDERS.keys()).union(CUELINKS_TARGET_RETAILERS)))

