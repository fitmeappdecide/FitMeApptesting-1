"""TataCliq — UTM tagging + cid (retailers.json: affiliate_type="utm_tagging_plus_cid")."""
from ._base_strategies import UtmTaggingPlusCidProvider


class TataCliqAffiliateProvider(UtmTaggingPlusCidProvider):
    retailer = "tatacliq"
    env_var = "TATACLIQ_AFFILIATE_ID"
    cid_param_name = "cid"
