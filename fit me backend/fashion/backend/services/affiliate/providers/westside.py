"""Westside — UTM tagging (retailers.json: affiliate_type="utm_tagging").
Same note as lifestyle.py: added because it's a real retailer in
retailers.json, not because the spec's example list named it explicitly."""
from ._base_strategies import UtmTaggingProvider


class WestsideAffiliateProvider(UtmTaggingProvider):
    retailer = "westside"
    env_var = "WESTSIDE_AFFILIATE_ID"
