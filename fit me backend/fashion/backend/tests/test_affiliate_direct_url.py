"""
Unit tests for direct product URL mode in /api/v1/product-intelligence/affiliate/click endpoint.
"""
import unittest
from unittest.mock import AsyncMock, MagicMock, patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.product_intelligence import router as pi_router
from app.core.auth_bridge import AuthUser, get_v2_auth_user
from app.core.database import get_db


def override_get_v2_auth_user():
    return AuthUser(user_id="test_user_123", email="test@example.com", roles=["user"])


async def override_get_db():
    mock_session = AsyncMock()
    mock_session.add = MagicMock()
    mock_session.commit = AsyncMock()
    yield mock_session


class TestAffiliateDirectUrlEndpoint(unittest.TestCase):

    def setUp(self):
        self.app = FastAPI()
        self.app.include_router(pi_router)
        self.app.dependency_overrides[get_v2_auth_user] = override_get_v2_auth_user
        self.app.dependency_overrides[get_db] = override_get_db
        self.client = TestClient(self.app)

    def tearDown(self):
        self.app.dependency_overrides.clear()

    def test_missing_input_rejected_400(self):
        """3. Missing required input (neither scan_id nor url) returns 400 Bad Request."""
        res = self.client.post("/api/v1/product-intelligence/affiliate/click", json={})
        self.assertEqual(res.status_code, 400)
        self.assertIn("detail", res.json())

    @patch("app.api.product_intelligence.get_affiliate_service")
    def test_direct_url_flow_success(self, mock_get_service):
        """2 & 6. Direct product URL flow returns affiliate click record and converted affiliate_url."""
        mock_service = MagicMock()
        mock_aff_res = MagicMock()
        mock_aff_res.generated = True
        mock_aff_res.affiliate_url = "https://clnk.in/direct_test_link"
        mock_aff_res.provider = "CuelinksAffiliateProvider"
        mock_aff_res.error = None
        mock_aff_res.expires_at = None

        mock_service.generate.return_value = mock_aff_res
        mock_get_service.return_value = mock_service

        res = self.client.post(
            "/api/v1/product-intelligence/affiliate/click",
            json={"url": "https://www.myntra.com/tshirt/123", "retailer": "myntra"},
        )
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertTrue(data.get("success"))
        self.assertEqual(data.get("affiliate_url"), "https://clnk.in/direct_test_link")
        self.assertEqual(data.get("retailer"), "myntra")

    @patch("app.api.product_intelligence.get_affiliate_service")
    def test_direct_url_auto_resolve_retailer(self, mock_get_service):
        """5. Direct URL flow auto-resolves retailer when retailer parameter is omitted."""
        mock_service = MagicMock()
        mock_aff_res = MagicMock()
        mock_aff_res.generated = False
        mock_aff_res.affiliate_url = None
        mock_aff_res.provider = "CuelinksAffiliateProvider"
        mock_aff_res.error = "missing_credentials"
        mock_aff_res.expires_at = None

        mock_service.generate.return_value = mock_aff_res
        mock_get_service.return_value = mock_service

        res = self.client.post(
            "/api/v1/product-intelligence/affiliate/click",
            json={"url": "https://www.ajio.com/p/12345"},
        )
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertFalse(data.get("success"))
        self.assertEqual(data.get("retailer"), "ajio")
        self.assertEqual(data.get("error"), "missing_credentials")

    def test_unauthenticated_request_rejected(self):
        """4. Unauthenticated request without valid auth token returns 401 Unauthorized."""
        unauth_app = FastAPI()
        unauth_app.include_router(pi_router)
        unauth_client = TestClient(unauth_app)

        res = unauth_client.post(
            "/api/v1/product-intelligence/affiliate/click",
            json={"url": "https://www.myntra.com/tshirt/123"},
        )
        self.assertEqual(res.status_code, 401)


if __name__ == "__main__":
    unittest.main()
