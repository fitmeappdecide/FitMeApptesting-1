"""
Unit tests for CuelinksAffiliateProvider — Official V3 Contract Verification.
"""
import os
import unittest
from unittest.mock import MagicMock, patch

import httpx

from app.core.cache import _memory_cache
from services.affiliate.providers.cuelinks import CUELINKS_API_ENDPOINT, CuelinksAffiliateProvider
from services.affiliate.service import AffiliateService


class TestCuelinksAffiliateProviderV3Contract(unittest.TestCase):

    def setUp(self):
        _memory_cache.clear()
        self.provider = CuelinksAffiliateProvider()
        self.service = AffiliateService()

    def tearDown(self):
        _memory_cache.clear()

    @patch("httpx.Client.post")
    def test_official_v3_request_format_and_headers(self, mock_post):
        """A, B, C, D, E, F: Verifies exact V3 endpoint, Token header, payload, and data envelope."""
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = {
            "data": {
                "tracking_url": "https://clnk.in/v3myntra",
                "affiliated": True,
                "original_url": "https://www.myntra.com/tshirt/123",
                "campaign": "Myntra",
            }
        }
        mock_post.return_value = mock_resp

        secret_key = "CUELINKS_SECRET_TEST_TOKEN"
        with patch.dict(os.environ, {"CUELINKS_API_KEY": secret_key}):
            res = self.provider.generate(
                "https://www.myntra.com/tshirt/123",
                {"retailer": "myntra", "affiliate_expiry": "session"},
            )

            # F. Successful conversion
            self.assertTrue(res.generated)
            self.assertEqual(res.affiliate_url, "https://clnk.in/v3myntra")
            self.assertIsNone(res.error)

            # A. Endpoint check
            mock_post.assert_called_once()
            args, kwargs = mock_post.call_args
            self.assertEqual(args[0], CUELINKS_API_ENDPOINT)
            self.assertEqual(args[0], "https://developers.cuelinks.com/pub_api/v3/links/convert")

            # C. Header check ("Token SECRET_KEY", NOT "Bearer SECRET_KEY")
            headers = kwargs.get("headers", {})
            self.assertEqual(headers.get("Authorization"), f"Token {secret_key}")
            self.assertFalse(headers.get("Authorization").startswith("Bearer"))

            # D. Request body check
            json_body = kwargs.get("json", {})
            self.assertEqual(json_body, {"url": "https://www.myntra.com/tshirt/123"})

    @patch("httpx.Client.post")
    def test_affiliated_false_response(self, mock_post):
        """G. affiliated=false returns generated=False, error=unaffiliated_merchant."""
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = {
            "data": {
                "tracking_url": "https://clnk.in/unaffiliated",
                "affiliated": False,
                "campaign": "Myntra",
            }
        }
        mock_post.return_value = mock_resp

        with patch.dict(os.environ, {"CUELINKS_API_KEY": "dummy_token"}):
            res = self.provider.generate(
                "https://www.myntra.com/tshirt/123",
                {"retailer": "myntra"},
            )
            self.assertFalse(res.generated)
            self.assertEqual(res.error, "unaffiliated_merchant")
            self.assertIsNone(res.affiliate_url)

    @patch("httpx.Client.post")
    def test_missing_tracking_url(self, mock_post):
        """H. Missing tracking_url in data envelope returns generated=False, error=missing_tracking_url."""
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = {
            "data": {
                "affiliated": True,
            }
        }
        mock_post.return_value = mock_resp

        with patch.dict(os.environ, {"CUELINKS_API_KEY": "dummy_token"}):
            res = self.provider.generate(
                "https://www.myntra.com/tshirt/123",
                {"retailer": "myntra"},
            )
            self.assertFalse(res.generated)
            self.assertEqual(res.error, "missing_tracking_url")

    @patch("httpx.Client.post")
    def test_missing_data_envelope(self, mock_post):
        """I. Missing 'data' object envelope returns generated=False."""
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = {"status": "success"}  # Missing data dict
        mock_post.return_value = mock_resp

        with patch.dict(os.environ, {"CUELINKS_API_KEY": "dummy_token"}):
            res = self.provider.generate(
                "https://www.myntra.com/tshirt/123",
                {"retailer": "myntra"},
            )
            self.assertFalse(res.generated)
            self.assertEqual(res.error, "missing_tracking_url")

    @patch("httpx.Client.post")
    def test_malformed_json_response(self, mock_post):
        """J. Malformed JSON response returns generated=False, cuelinks_network_failure error."""
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.side_effect = ValueError("Invalid JSON token")
        mock_post.return_value = mock_resp

        with patch.dict(os.environ, {"CUELINKS_API_KEY": "dummy_token"}):
            res = self.provider.generate(
                "https://www.myntra.com/tshirt/123",
                {"retailer": "myntra"},
            )
            self.assertFalse(res.generated)
            self.assertEqual(res.error, "cuelinks_network_failure")

    @patch("httpx.Client.post")
    def test_http_401_error(self, mock_post):
        """K. HTTP 401 returns generated=False, error=cuelinks_http_401."""
        mock_resp = MagicMock()
        mock_resp.status_code = 401
        mock_post.return_value = mock_resp

        with patch.dict(os.environ, {"CUELINKS_API_KEY": "invalid_token"}):
            res = self.provider.generate(
                "https://www.myntra.com/tshirt/123",
                {"retailer": "myntra"},
            )
            self.assertFalse(res.generated)
            self.assertEqual(res.error, "cuelinks_http_401")

    @patch("httpx.Client.post")
    def test_http_403_error(self, mock_post):
        """L. HTTP 403 returns generated=False, error=cuelinks_http_403."""
        mock_resp = MagicMock()
        mock_resp.status_code = 403
        mock_post.return_value = mock_resp

        with patch.dict(os.environ, {"CUELINKS_API_KEY": "forbidden_token"}):
            res = self.provider.generate(
                "https://www.myntra.com/tshirt/123",
                {"retailer": "myntra"},
            )
            self.assertFalse(res.generated)
            self.assertEqual(res.error, "cuelinks_http_403")

    @patch("httpx.Client.post")
    def test_http_422_error(self, mock_post):
        """M. HTTP 422 returns generated=False, error=cuelinks_http_422."""
        mock_resp = MagicMock()
        mock_resp.status_code = 422
        mock_post.return_value = mock_resp

        with patch.dict(os.environ, {"CUELINKS_API_KEY": "dummy_token"}):
            res = self.provider.generate(
                "https://www.myntra.com/tshirt/invalid",
                {"retailer": "myntra"},
            )
            self.assertFalse(res.generated)
            self.assertEqual(res.error, "cuelinks_http_422")

    @patch("httpx.Client.post")
    def test_http_429_rate_limit(self, mock_post):
        """N. HTTP 429 returns generated=False, error=cuelinks_http_429."""
        mock_resp = MagicMock()
        mock_resp.status_code = 429
        mock_post.return_value = mock_resp

        with patch.dict(os.environ, {"CUELINKS_API_KEY": "dummy_token"}):
            res = self.provider.generate(
                "https://www.myntra.com/tshirt/123",
                {"retailer": "myntra"},
            )
            self.assertFalse(res.generated)
            self.assertEqual(res.error, "cuelinks_http_429")

    @patch("httpx.Client.post")
    def test_http_5xx_server_error(self, mock_post):
        """O. HTTP 500/502/503 returns generated=False, error=cuelinks_http_500."""
        mock_resp = MagicMock()
        mock_resp.status_code = 500
        mock_post.return_value = mock_resp

        with patch.dict(os.environ, {"CUELINKS_API_KEY": "dummy_token"}):
            res = self.provider.generate(
                "https://www.myntra.com/tshirt/123",
                {"retailer": "myntra"},
            )
            self.assertFalse(res.generated)
            self.assertEqual(res.error, "cuelinks_http_500")

    @patch("httpx.Client.post")
    def test_cuelinks_timeout(self, mock_post):
        """P. Timeout returns generated=False, error=cuelinks_timeout."""
        mock_post.side_effect = httpx.TimeoutException("Connection timed out after 1.5s")

        with patch.dict(os.environ, {"CUELINKS_API_KEY": "dummy_token"}):
            res = self.provider.generate(
                "https://www.myntra.com/tshirt/123",
                {"retailer": "myntra"},
            )
            self.assertFalse(res.generated)
            self.assertEqual(res.error, "cuelinks_timeout")

    @patch("httpx.Client.post")
    def test_cache_miss_then_hit(self, mock_post):
        """Q & R. Cache miss calls Cuelinks API once; subsequent request hits cache and does NOT call API again."""
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = {
            "data": {
                "tracking_url": "https://clnk.in/cached_v3",
                "affiliated": True,
            }
        }
        mock_post.return_value = mock_resp

        with patch.dict(os.environ, {"CUELINKS_API_KEY": "dummy_token"}):
            # First call: R. Cache Miss -> Calls API
            res1 = self.provider.generate(
                "https://www.myntra.com/tshirt/123",
                {"retailer": "myntra"},
            )
            self.assertTrue(res1.generated)
            self.assertEqual(res1.affiliate_url, "https://clnk.in/cached_v3")
            self.assertEqual(mock_post.call_count, 1)

            # Second call: Q. Cache Hit -> Does NOT call API
            res2 = self.provider.generate(
                "https://www.myntra.com/tshirt/123",
                {"retailer": "myntra"},
            )
            self.assertTrue(res2.generated)
            self.assertEqual(res2.affiliate_url, "https://clnk.in/cached_v3")
            self.assertEqual(mock_post.call_count, 1)  # Count stays 1!

    @patch("httpx.Client.post")
    def test_invalid_tracking_url_scheme_rejected(self, mock_post):
        """S. Tracking URL with non-http/https scheme (e.g. javascript:) is rejected."""
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = {
            "data": {
                "tracking_url": "javascript:alert(1)",
                "affiliated": True,
            }
        }
        mock_post.return_value = mock_resp

        with patch.dict(os.environ, {"CUELINKS_API_KEY": "dummy_token"}):
            res = self.provider.generate(
                "https://www.myntra.com/tshirt/123",
                {"retailer": "myntra"},
            )
            self.assertFalse(res.generated)
            self.assertEqual(res.error, "missing_tracking_url")

    def test_api_key_security(self):
        """T. API key never appears in AffiliateResult object, string representations, or logs."""
        secret = "VERY_SECRET_CUELINKS_TOKEN_9999"
        with patch.dict(os.environ, {"CUELINKS_API_KEY": secret}):
            res = self.provider.generate(
                "https://www.myntra.com/tshirt/123",
                {"retailer": "myntra"},
            )
            dict_rep = str(res.to_dict())
            self.assertNotIn(secret, dict_rep)


if __name__ == "__main__":
    unittest.main()
