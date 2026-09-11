"""Lifestyle — UTM tagging (retailers.json: affiliate_type="utm_tagging").
Not explicitly named in the Phase 7 spec's example file list, but it's one
of the 8 real retailers in retailers.json with affiliate_supported=true,
so it gets a real provider rather than silently falling through to generic."""
from ._base_strategies import UtmTaggingProvider


class LifestyleAffiliateProvider(UtmTaggingProvider):
    retailer = "lifestyle"
    env_var = "LIFESTYLE_AFFILIATE_ID"
