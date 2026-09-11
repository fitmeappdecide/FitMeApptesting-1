"""Amazon Associates — query-param tagging (retailers.json: affiliate_type="query_param_tagging")."""
from ._base_strategies import QueryParamTaggingProvider


class AmazonAffiliateProvider(QueryParamTaggingProvider):
    retailer = "amazon"
    env_var = "AMAZON_ASSOCIATE_TAG"
    param_name = "tag"
