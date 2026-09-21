import pytest
import uuid
from unittest.mock import patch, MagicMock
from httpx import ASGITransport, AsyncClient

from app.main import app
from app.api.deps import get_current_user
import os
import sys
sys.path.insert(0, os.path.dirname(__file__))
from conftest import TestAsyncSessionLocal, test_engine
from app.core.database import Base
from app.models.user import User
from app.models.garment import Garment
from app.models.tryon_job import TryOnJob
from app.services.storage_service import (
    create_signed_photo_url,
    sign_if_private,
    cdn_url_for_private_ref,
    get_thumbnail_url_for_result,
    _signed_url_cache,
)


@pytest.fixture(autouse=True)
def clear_url_cache():
    _signed_url_cache.clear()
    yield
    _signed_url_cache.clear()


def test_create_signed_photo_url_no_public_fallback_on_error():
    """Verify private assets never fall back to public URLs on error."""
    with patch("app.services.storage_service._get_supabase_client", side_effect=Exception("Storage error")):
        url = create_signed_photo_url("tryon_results/user_face.webp")
        # Must return empty string, never a public URL with /storage/v1/object/public/
        assert url == ""
        assert "storage/v1/object/public" not in url


def test_sign_if_private_handles_various_url_types():
    """Verify private paths are signed while catalog URLs and data URIs remain untouched."""
    mock_signed = "https://mock.supabase.co/storage/v1/object/sign/scans/tryon_results/abc.webp?token=xyz123"

    with patch("app.services.storage_service.create_signed_photo_url", return_value=mock_signed) as mock_signer:
        # 1. Private relative path
        res1 = sign_if_private("tryon_results/abc.webp")
        assert res1 == mock_signed
        mock_signer.assert_called_with("tryon_results/abc.webp", expires_in=7200)

        # 2. Legacy public URL pointing to tryon_results
        mock_signer.reset_mock()
        res2 = sign_if_private("https://mock.supabase.co/storage/v1/object/public/scans/tryon_results/abc.webp")
        assert res2 == mock_signed
        mock_signer.assert_called_with("tryon_results/abc.webp", expires_in=7200)

        # 3. Public catalog / merchant URL — must remain untouched and NOT signed
        mock_signer.reset_mock()
        catalog_url = "https://assets.myntassets.com/v1/images/style/properties/shirt.jpg"
        res3 = sign_if_private(catalog_url)
        assert res3 == catalog_url
        mock_signer.assert_not_called()

        # 4. Instant high-res Data URI — must remain untouched
        mock_signer.reset_mock()
        data_uri = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
        res4 = sign_if_private(data_uri)
        assert res4 == data_uri
        mock_signer.assert_not_called()


def test_cdn_url_for_private_ref_security_guard():
    """Verify cdn_url_for_private_ref delegates private references to signed URLs."""
    mock_signed = "https://mock.supabase.co/storage/v1/object/sign/scans/tryon_results/test.webp?token=sec456"

    with patch("app.services.storage_service.create_signed_photo_url", return_value=mock_signed):
        # Private ref
        signed = cdn_url_for_private_ref("tryon_results/test.webp")
        assert signed == mock_signed

        # Public / catalog ref
        public = cdn_url_for_private_ref("catalog/garments/shirt.jpg")
        assert "/storage/v1/object/public/" in public


@pytest.mark.asyncio
async def test_tryon_endpoints_return_signed_urls_and_prevent_cross_user_access():
    """Verify try-on API endpoints return signed URLs for results and protect against cross-user access."""
    async with test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    user1_id = uuid.uuid4()
    user2_id = uuid.uuid4()
    garment_id = uuid.uuid4()
    job_id = uuid.uuid4()

    async with TestAsyncSessionLocal() as db:
        u1 = User(id=user1_id, email="user1@example.com", password_hash="pwd", is_active=True)
        u2 = User(id=user2_id, email="user2@example.com", password_hash="pwd", is_active=True)
        g = Garment(id=garment_id, product_name="Formal Blazer", images=[{"url": "https://store.com/blazer.jpg"}])
        job = TryOnJob(
            id=job_id,
            user_id=user1_id,
            garment_id=garment_id,
            status="completed",
            result_image_urls=["tryon_results/result_123.webp"],
        )
        db.add_all([u1, u2, g, job])
        await db.commit()

    async def as_user1():
        async with TestAsyncSessionLocal() as session:
            return await session.get(User, user1_id)

    async def as_user2():
        async with TestAsyncSessionLocal() as session:
            return await session.get(User, user2_id)

    mock_signed_result = "https://mock.supabase.co/storage/v1/object/sign/scans/tryon_results/result_123.webp?token=sign999"

    with patch("app.services.storage_service.create_signed_photo_url", return_value=mock_signed_result):
        # 1. User 1 queries their own result
        app.dependency_overrides[get_current_user] = as_user1
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver") as client:
            res = await client.get(f"/api/v1/tryon/{job_id}/result")
            assert res.status_code == 200
            data = res.json()
            assert data["result_image_urls"] == [mock_signed_result]

            detail_res = await client.get(f"/api/v1/tryon/{job_id}/detail")
            assert detail_res.status_code == 200
            assert detail_res.json()["result_image_urls"] == [mock_signed_result]

            history_res = await client.get("/api/v1/tryon/history")
            assert history_res.status_code == 200
            hist = history_res.json()
            assert len(hist) >= 1
            assert hist[0]["result_image_urls"] == [mock_signed_result]

        # 2. User 2 attempts to query User 1's job -> 404 forbidden/not found
        app.dependency_overrides[get_current_user] = as_user2
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver") as client:
            unauthorized_res = await client.get(f"/api/v1/tryon/{job_id}/result")
            assert unauthorized_res.status_code == 404
            unauth_detail = await client.get(f"/api/v1/tryon/{job_id}/detail")
            assert unauth_detail.status_code == 404


@pytest.mark.asyncio
async def test_saved_photo_and_scan_cross_user_isolation():
    """Verify User B cannot see or delete User A's saved photos or body scans."""
    from app.models.user_saved_photo import UserSavedPhoto
    from app.models.body_scan import BodyScan

    userA_id = uuid.uuid4()
    userB_id = uuid.uuid4()
    photoA_id = uuid.uuid4()
    scanA_id = uuid.uuid4()

    async with TestAsyncSessionLocal() as db:
        uA = User(id=userA_id, email="userA_iso@example.com", password_hash="pwd", is_active=True)
        uB = User(id=userB_id, email="userB_iso@example.com", password_hash="pwd", is_active=True)
        photoA = UserSavedPhoto(id=photoA_id, user_id=userA_id, storage_path="user_photos/photoA.jpg", display_name="A Photo")
        scanA = BodyScan(id=scanA_id, user_id=userA_id, front_photo_url_encrypted="scans/frontA.jpg", consent_given=True)
        db.add_all([uA, uB, photoA, scanA])
        await db.commit()

    async def as_userB():
        async with TestAsyncSessionLocal() as session:
            return await session.get(User, userB_id)

    app.dependency_overrides[get_current_user] = as_userB

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver") as client:
        # 1. User B lists saved photos -> user A's photo must NOT be in the list
        photos_res = await client.get("/api/v1/photos/")
        assert photos_res.status_code == 200
        photo_ids = [p["id"] for p in photos_res.json()]
        assert str(photoA_id) not in photo_ids

        # 2. User B tries to delete User A's photo -> 404
        del_res = await client.delete(f"/api/v1/photos/{photoA_id}")
        assert del_res.status_code == 404

        # 3. User B queries scans -> User A's scan must NOT be returned (User B has no scan -> 404)
        scans_res = await client.get("/api/v1/scan")
        assert scans_res.status_code == 404



def test_signed_url_expiration_parameter_is_time_limited():
    """Verify create_signed_photo_url asks Supabase for a time-limited signed token."""
    mock_client = MagicMock()
    mock_bucket = MagicMock()
    mock_bucket.create_signed_url.return_value = "https://mock.supabase.co/storage/v1/object/sign/scans/file.jpg?token=abc"
    mock_client.storage.from_.return_value = mock_bucket

    with patch("app.services.storage_service._get_supabase_client", return_value=mock_client), \
         patch("app.core.config.settings.supabase_url", "https://mock.supabase.co"), \
         patch("app.core.config.settings.supabase_service_key", "secret-key"):
        signed_url = create_signed_photo_url("tryon_results/test.webp", expires_in=3600)
        assert signed_url == "https://mock.supabase.co/storage/v1/object/sign/scans/file.jpg?token=abc"
        # Verify expires_in parameter is passed directly to Supabase client
        mock_bucket.create_signed_url.assert_called_once_with("tryon_results/test.webp", 3600)

