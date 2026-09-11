"""Nykaa Fashion — UTM tagging (retailers.json: affiliate_type="utm_tagging").
Retailer id is "nykaafashion" (matches adapters.registry / retailers.json), not "nykaa"."""
from ._base_strategies import UtmTaggingProvider


class NykaaFashionAffiliateProvider(UtmTaggingProvider):
    retailer = "nykaafashion"
    env_var = "NYKAA_AFFILIATE_ID"
