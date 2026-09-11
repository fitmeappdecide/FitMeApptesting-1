from __future__ import annotations
from typing import Dict, Optional
from urllib.parse import urlparse
from .models import RetailProfile

_RETAILER_DB: Dict[str, RetailProfile] = {
    "amazon": RetailProfile(
        id="amazon",
        name="Amazon",
        resolved=True,
        affiliate_supported=True,
        affiliate_type="query_param_tagging",
        affiliate_expiry="24h",
        known_domains={"amazon.in", "amazon.com", "amzn.to", "amzn.in"},
    ),
    "flipkart": RetailProfile(
        id="flipkart",
        name="Flipkart",
        resolved=True,
        affiliate_supported=True,
        affiliate_type="query_param_tagging",
        affiliate_expiry="24h",
        known_domains={"flipkart.com", "dl.flipkart.com", "fkrt.it"},
    ),
    "myntra": RetailProfile(
        id="myntra",
        name="Myntra",
        resolved=True,
        affiliate_supported=True,
        affiliate_type="utm_tagging",
        affiliate_expiry="session",
        known_domains={"myntra.com"},
    ),
    "ajio": RetailProfile(
        id="ajio",
        name="Ajio",
        resolved=True,
        affiliate_supported=True,
        affiliate_type="utm_tagging",
        affiliate_expiry="30d",
        known_domains={"ajio.com"},
    ),
    "nykaa": RetailProfile(
        id="nykaa",
        name="Nykaa Fashion",
        resolved=True,
        affiliate_supported=True,
        affiliate_type="utm_tagging",
        affiliate_expiry="30d",
        known_domains={"nykaafashion.com", "nykaa.com"},
    ),
    "tatacliq": RetailProfile(
        id="tatacliq",
        name="Tata CLiQ",
        resolved=True,
        affiliate_supported=True,
        affiliate_type="utm_tagging_plus_cid",
        affiliate_expiry="30d",
        known_domains={"tatacliq.com", "luxury.tatacliq.com"},
    ),
    "lifestyle": RetailProfile(
        id="lifestyle",
        name="Lifestyle",
        resolved=True,
        affiliate_supported=True,
        affiliate_type="utm_tagging",
        affiliate_expiry="30d",
        known_domains={"lifestylestores.com"},
    ),
    "westside": RetailProfile(
        id="westside",
        name="Westside",
        resolved=True,
        affiliate_supported=True,
        affiliate_type="utm_tagging",
        affiliate_expiry="30d",
        known_domains={"westside.com"},
    ),
}

class RetailResolver:
    def resolve_by_id(self, retailer_id: str) -> RetailProfile:
        if not retailer_id:
            return RetailProfile(id="", name="", resolved=False, affiliate_supported=False)
        rid = retailer_id.strip().lower()
        if rid in _RETAILER_DB:
            return _RETAILER_DB[rid]
        return RetailProfile(id=retailer_id, name=retailer_id.title(), resolved=False, affiliate_supported=False)

    def resolve(self, id_or_domain: str) -> RetailProfile:
        if not id_or_domain:
            return RetailProfile(id="", name="", resolved=False, affiliate_supported=False)
        cleaned = id_or_domain.strip().lower()
        if cleaned in _RETAILER_DB:
            return _RETAILER_DB[cleaned]
        # Domain lookup
        for profile in _RETAILER_DB.values():
            if cleaned in profile.known_domains:
                return profile
        return RetailProfile(id=id_or_domain, name=id_or_domain, resolved=False, affiliate_supported=False)
