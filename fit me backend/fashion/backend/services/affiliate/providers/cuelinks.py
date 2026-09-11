"""
Cuelinks Affiliate Provider (V3 API Integration).

Monetizes e-commerce product links for Indian fashion platforms (Myntra, AJIO, Nykaa, Flipkart, etc.)
via Cuelinks Monetization API v3.
"""
from __future__ import annotations

import hashlib
import logging
import os
import time
from typing import Any, Dict, Optional

import httpx

from app.core.cache import _memory_cache
from app.core.config import settings

from ..base import BaseAffiliateProvider
from ..models import AffiliateResult
from ._base_strategies import _compute_expires_at
from ._url_tagging import is_well_formed_http_url

logger = logging.getLogger(__name__)

CUELINKS_API_ENDPOINT = "https://developers.cuelinks.com/pub_api/v3/links/convert"
HTTP_TIMEOUT_SECONDS = 1.5


class CuelinksAffiliateProvider(BaseAffiliateProvider):
    retailer = "cuelinks"
    env_var = "CUELINKS_API_KEY"

    def has_credentials(self) -> bool:
        """Returns True if CUELINKS_API_KEY environment variable or settings value is configured."""
        env_key = os.environ.get(self.env_var, "").strip()
        config_key = getattr(settings, "cuelinks_api_key", "").strip()
        return bool(env_key or config_key)

    def _get_api_key(self) -> str:
        """Retrieves the API key securely without logging or exposing it."""
        env_key = os.environ.get(self.env_var, "").strip()
        if env_key:
            return env_key
        return getattr(settings, "cuelinks_api_key", "").strip()

    def generate(self, product_url: str, context: Dict[str, Any]) -> AffiliateResult:
        retailer_name = context.get("retailer", "unknown")

        if not is_well_formed_http_url(product_url):
            return AffiliateResult(
                retailer=retailer_name,
                original_url=product_url,
                affiliate_url=None,
                generated=False,
                provider=type(self).__name__,
                expires_at=None,
                tracking_id=context.get("tracking_id"),
                error="malformed_url",
            )

        api_key = self._get_api_key()
        if not api_key:
            return AffiliateResult(
                retailer=retailer_name,
                original_url=product_url,
                affiliate_url=None,
                generated=False,
                provider=type(self).__name__,
                expires_at=None,
                tracking_id=context.get("tracking_id"),
                error="missing_credentials",
            )

        # 1. Cache Lookup (In-memory / Redis cache check)
        cache_key = f"cuelinks_affiliate:{hashlib.sha256((retailer_name + ':' + product_url).encode()).hexdigest()}"
        cached_data = _memory_cache.get(cache_key)
        if isinstance(cached_data, dict) and cached_data.get("generated") and cached_data.get("affiliate_url"):
            logger.info("CuelinksAffiliateProvider cache HIT for retailer %r", retailer_name)
            return AffiliateResult(
                retailer=retailer_name,
                original_url=product_url,
                affiliate_url=cached_data["affiliate_url"],
                generated=True,
                provider=type(self).__name__,
                expires_at=cached_data.get("expires_at"),
                tracking_id=context.get("tracking_id"),
            )

        # 2. HTTP Request to Cuelinks API v3 (/pub_api/v3/links/convert with Token header)
        start_time = time.time()
        headers = {
            "Authorization": f"Token {api_key}",
            "Content-Type": "application/json",
            "Accept": "application/json",
        }
        payload = {"url": product_url}

        try:
            with httpx.Client(timeout=HTTP_TIMEOUT_SECONDS) as client:
                response = client.post(CUELINKS_API_ENDPOINT, json=payload, headers=headers)
                elapsed_ms = int((time.time() - start_time) * 1000)

                if response.status_code != 200 and response.status_code != 201:
                    logger.warning(
                        "Cuelinks API non-200 status %d for retailer %r in %dms",
                        response.status_code,
                        retailer_name,
                        elapsed_ms,
                    )
                    return AffiliateResult(
                        retailer=retailer_name,
                        original_url=product_url,
                        affiliate_url=None,
                        generated=False,
                        provider=type(self).__name__,
                        expires_at=None,
                        tracking_id=context.get("tracking_id"),
                        error=f"cuelinks_http_{response.status_code}",
                    )

                res_json = response.json()
        except httpx.TimeoutException:
            elapsed_ms = int((time.time() - start_time) * 1000)
            logger.warning("Cuelinks API TIMEOUT after %dms for retailer %r", elapsed_ms, retailer_name)
            return AffiliateResult(
                retailer=retailer_name,
                original_url=product_url,
                affiliate_url=None,
                generated=False,
                provider=type(self).__name__,
                expires_at=None,
                tracking_id=context.get("tracking_id"),
                error="cuelinks_timeout",
            )
        except Exception as err:
            logger.warning("Cuelinks API request failure for retailer %r: %s", retailer_name, err)
            return AffiliateResult(
                retailer=retailer_name,
                original_url=product_url,
                affiliate_url=None,
                generated=False,
                provider=type(self).__name__,
                expires_at=None,
                tracking_id=context.get("tracking_id"),
                error="cuelinks_network_failure",
            )

        # 3. Response Envelope & Attribution Verification
        if not isinstance(res_json, dict):
            return AffiliateResult(
                retailer=retailer_name,
                original_url=product_url,
                affiliate_url=None,
                generated=False,
                provider=type(self).__name__,
                expires_at=None,
                tracking_id=context.get("tracking_id"),
                error="cuelinks_network_failure",
            )

        data_obj = res_json.get("data")
        if not isinstance(data_obj, dict):
            logger.warning("Cuelinks API response missing 'data' dictionary envelope for retailer %r", retailer_name)
            return AffiliateResult(
                retailer=retailer_name,
                original_url=product_url,
                affiliate_url=None,
                generated=False,
                provider=type(self).__name__,
                expires_at=None,
                tracking_id=context.get("tracking_id"),
                error="missing_tracking_url",
            )

        tracking_url = data_obj.get("tracking_url")
        is_affiliated = data_obj.get("affiliated")

        # Must have valid HTTP/HTTPS tracking URL string
        if not isinstance(tracking_url, str) or not is_well_formed_http_url(tracking_url):
            logger.warning("Cuelinks API returned missing/invalid tracking URL for retailer %r", retailer_name)
            return AffiliateResult(
                retailer=retailer_name,
                original_url=product_url,
                affiliate_url=None,
                generated=False,
                provider=type(self).__name__,
                expires_at=None,
                tracking_id=context.get("tracking_id"),
                error="missing_tracking_url",
            )

        # Check affiliated flag strictly
        if is_affiliated is False:
            logger.warning("Cuelinks API indicates merchant/campaign unaffiliated for retailer %r", retailer_name)
            return AffiliateResult(
                retailer=retailer_name,
                original_url=product_url,
                affiliate_url=None,
                generated=False,
                provider=type(self).__name__,
                expires_at=None,
                tracking_id=context.get("tracking_id"),
                error="unaffiliated_merchant",
            )

        if not is_affiliated and is_affiliated is not True:
            logger.warning("Cuelinks API returned invalid affiliated state for retailer %r", retailer_name)
            return AffiliateResult(
                retailer=retailer_name,
                original_url=product_url,
                affiliate_url=None,
                generated=False,
                provider=type(self).__name__,
                expires_at=None,
                tracking_id=context.get("tracking_id"),
                error="unaffiliated_merchant",
            )

        expires_at = _compute_expires_at(context.get("affiliate_expiry"))
        result = AffiliateResult(
            retailer=retailer_name,
            original_url=product_url,
            affiliate_url=tracking_url,
            generated=True,
            provider=type(self).__name__,
            expires_at=expires_at,
            tracking_id=context.get("tracking_id"),
        )

        # Cache valid conversion
        _memory_cache[cache_key] = result.to_dict()
        logger.info("CuelinksAffiliateProvider SUCCESS for retailer %r in %dms", retailer_name, elapsed_ms)
        return result
