"""Myntra — UTM tagging (retailers.json: affiliate_type="utm_tagging")."""
from ._base_strategies import UtmTaggingProvider


class MyntraAffiliateProvider(UtmTaggingProvider):
    retailer = "myntra"
    env_var = "MYNTRA_AFFILIATE_ID"
