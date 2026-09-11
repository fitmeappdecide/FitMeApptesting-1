"""Flipkart Affiliate — query-param tagging (retailers.json: affiliate_type="query_param_tagging")."""
from ._base_strategies import QueryParamTaggingProvider


class FlipkartAffiliateProvider(QueryParamTaggingProvider):
    retailer = "flipkart"
    env_var = "FLIPKART_AFFILIATE_ID"
    param_name = "affid"
