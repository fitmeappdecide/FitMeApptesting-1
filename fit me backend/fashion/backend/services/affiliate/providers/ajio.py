"""AJIO — UTM tagging (retailers.json: affiliate_type="utm_tagging")."""
from ._base_strategies import UtmTaggingProvider


class AjioAffiliateProvider(UtmTaggingProvider):
    retailer = "ajio"
    env_var = "AJIO_AFFILIATE_ID"
