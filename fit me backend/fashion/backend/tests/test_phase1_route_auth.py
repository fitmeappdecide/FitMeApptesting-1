"""
Comprehensive Automated Verification Suite for Phase 1: Route Isolation + Auth Bridge.
Verifies that:
1. Product Intelligence V2 routes are cleanly isolated under /api/v1/product-intelligence/*
2. FitMe auth is seamlessly bridged to V2 AuthUser and require_v2_admin
3. All existing FitMe core routes (/api/v1/auth, /api/v1/scan, /api/v1/tryon, /api/v1/product, /api/v1/user, /health) remain 100% operational and untouched.
"""
import base64
import os
from datetime import UTC, datetime
import pytest
from httpx import ASGITransport, AsyncClient
from app.main import app
from app.core import database as core_db
from app.core.auth_bridge import AuthUser, get_v2_auth_user, require_v2_admin
from app.models.product_intelligence import PIScan
from app.models.user import User
import uuid


# ---------------- Existing Core FitMe Routes Tests ----------------

@pytest.mark.asyncio
async def test_existing_fitme_health_endpoint():
    """Verify that existing FitMe health check is untouched."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/health")
        assert response.status_code == 200
        data = response.json()
        assert data.get("status") == "healthy" or "status" in data


@pytest.mark.asyncio
async def test_existing_fitme_auth_routes():
    """Verify existing auth routes remain registered and validate schemas."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # Registration with invalid body returns 422
        res_reg = await client.post("/api/v1/auth/register", json={})
        assert res_reg.status_code == 422

        # Login with invalid body returns 422
        res_login = await client.post("/api/v1/auth/login", json={})
        assert res_login.status_code == 422


@pytest.mark.asyncio
async def test_existing_fitme_scan_and_tryon_routes():
    """Verify existing body scanning and try-on routes remain registered and distinct."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # Existing Body Scan upload route (/api/v1/scan/upload)
        res_body_scan = await client.post("/api/v1/scan/upload")
        assert res_body_scan.status_code == 422  # Expects multipart form (front photo)

        # Existing Try-On start route (/api/v1/tryon/start)
        res_tryon = await client.post("/api/v1/tryon/start", json={})
        assert res_tryon.status_code == 422  # Expects { scan_id, garment_id }


@pytest.mark.asyncio
async def test_existing_fitme_product_and_user_routes():
    """Verify existing product persistence and user profile routes remain registered."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # Existing Product from-extension
        res_prod = await client.post("/api/v1/product/from-extension", json={})
        assert res_prod.status_code == 422

        # Existing User profile
        res_user = await client.get("/api/v1/user/profile")
        assert res_user.status_code == 200  # Returns mock user profile from conftest auth


# ---------------- Product Intelligence Isolated Routes Tests ----------------

@pytest.mark.asyncio
async def test_product_intelligence_root_and_retailers():
    """Verify that isolated V2 Product Intelligence routes respond."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # Test Root
        res_root = await client.get("/api/v1/product-intelligence/")
        assert res_root.status_code == 200
        assert res_root.json()["message"] == "FitMe Product Intelligence V2 API"

        # Test Retailers
        res_retailers = await client.get("/api/v1/product-intelligence/retailers")
        assert res_retailers.status_code == 200
        retailers = res_retailers.json()
        assert isinstance(retailers, list)
        assert len(retailers) >= 8
        retailer_ids = [r["id"] for r in retailers]
        assert "amazon" in retailer_ids
        assert "myntra" in retailer_ids
        assert "flipkart" in retailer_ids


@pytest.mark.asyncio
async def test_product_intelligence_providers_health():
    """Verify provider health reporting is non-blocking and safe."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        res = await client.get("/api/v1/product-intelligence/health/providers")
        assert res.status_code == 200
        data = res.json()
        assert "ocr" in data
        assert "logo" in data
        assert "similarity" in data


@pytest.mark.asyncio
async def test_product_intelligence_scan_and_status():
    """Verify V2 scan endpoint accepts valid payload and scan status works."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # Empty payload rejected
        res_empty = await client.post("/api/v1/product-intelligence/scan", json={"image_base64": ""})
        assert res_empty.status_code == 400

        # Valid payload
        dummy_b64 = base64.b64encode(b"A" * 128).decode("ascii")
        res_valid = await client.post(
            "/api/v1/product-intelligence/scan",
            json={"image_base64": dummy_b64, "source": "upload"}
        )
        assert res_valid.status_code == 200
        scan_id = res_valid.json()["scan_id"]

        # Status check
        res_status = await client.get(f"/api/v1/product-intelligence/scan/{scan_id}")
        assert res_status.status_code == 200
        assert res_status.json()["scan_id"] == scan_id


@pytest.mark.asyncio
async def test_product_intelligence_affiliate_click(monkeypatch):
    """Verify affiliate click endpoint accepts request and returns structured response."""
    monkeypatch.setenv("AMAZON_ASSOCIATE_TAG", "fitme-tag-21")
    scan_id = f"scan_p1_{uuid.uuid4().hex[:8]}"
    cand_id = f"cand_p1_{uuid.uuid4().hex[:8]}"
    async with core_db.AsyncSessionLocal() as session:
        seed = PIScan(
            scan_id=scan_id,
            user_id="a1b2c3d4-e5f6-7890-abcd-ef1234567890",
            status="done",
            candidates=[{"id": cand_id, "retailer": "amazon", "url": "https://www.amazon.in/dp/B08N5WRWNW"}],
            created_at=datetime.now(UTC),
        )
        session.add(seed)
        await session.commit()

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        res = await client.post(
            "/api/v1/product-intelligence/affiliate/click",
            json={"scan_id": scan_id, "candidate_id": cand_id}
        )
        assert res.status_code == 200
        data = res.json()
        assert data["success"] is True
        assert "click_id" in data


# ---------------- Auth Bridge & Admin Security Tests ----------------

@pytest.mark.asyncio
async def test_auth_bridge_unit():
    """Unit test for AuthUser bridge transformation."""
    fake_id = uuid.uuid4()
    mock_user = User(id=fake_id, email="tester@fitme.ai", full_name="Tester", is_active=True)
    
    v2_auth = await get_v2_auth_user(user=mock_user)
    assert isinstance(v2_auth, AuthUser)
    assert v2_auth.user_id == str(fake_id)
    assert v2_auth.email == "tester@fitme.ai"
    assert v2_auth.provider == "fitme_jwt"


@pytest.mark.asyncio
async def test_auth_bridge_admin_whoami():
    """Verify /admin/whoami returns user_id and is_admin boolean."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        res = await client.get("/api/v1/product-intelligence/admin/whoami")
        assert res.status_code == 200
        data = res.json()
        assert "user_id" in data
        assert "is_admin" in data
        assert data["provider"] == "fitme_jwt"


@pytest.mark.asyncio
async def test_admin_endpoints_enforce_admin_check():
    """Verify admin endpoints reject non-admin users with 403 Forbidden."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # Default mock user is not in ADMIN_USER_IDS -> 403 Forbidden
        res_cache = await client.get("/api/v1/product-intelligence/admin/cache-stats")
        assert res_cache.status_code == 403

        res_learning = await client.get("/api/v1/product-intelligence/admin/learning/insights")
        assert res_learning.status_code == 403
