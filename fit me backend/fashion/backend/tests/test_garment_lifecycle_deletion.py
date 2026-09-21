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
from app.models.user_saved_photo import UserSavedPhoto
from app.models.body_scan import BodyScan
from app.models.tryon_job import TryOnJob
from app.models.garment import Garment
from app.models.ava import AVAConversation
from app.services import storage_service
from app.services.storage_service import (
    is_user_uploaded_garment,
    get_garment_storage_paths,
    delete_images_from_storage,
    delete_garment_images_from_storage,
)


@pytest.mark.asyncio
async def test_delete_tryon_preserves_user_photo_and_body_scan():
    """Regression Test: Verify that deleting an individual Try-On does NOT delete

    or modify the user's saved/model photos or body scans.
    """
    async with test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    user_id = uuid.uuid4()
    job_id = uuid.uuid4()
    garment_id = uuid.uuid4()
    photo_id = uuid.uuid4()
    scan_id = uuid.uuid4()

    async with TestAsyncSessionLocal() as db:
        user = User(
            id=user_id,
            email=f"user_{uuid.uuid4().hex[:6]}@example.com",
            password_hash="pwd_hash",
            full_name="Photo Scan Test User",
            is_active=True,
        )
        db.add(user)

        photo = UserSavedPhoto(
            id=photo_id,
            user_id=user_id,
            storage_path="user_photos/my_model_photo.webp",
            display_name="Primary Face",
        )
        db.add(photo)

        scan = BodyScan(
            id=scan_id,
            user_id=user_id,
            front_photo_url_encrypted="scans/front_scan.webp",
            consent_given=True,
        )
        db.add(scan)

        garment = Garment(
            id=garment_id,
            product_name="Catalog Floral Top",
            product_url="https://www.myntra.com/tops/floral/12345",
            images=[{"url": "https://assets.myntassets.com/top.jpg"}],
        )
        db.add(garment)

        job = TryOnJob(
            id=job_id,
            user_id=user_id,
            garment_id=garment_id,
            saved_photo_id=photo_id,
            status="completed",
            result_image_urls=["https://smzhdmutffzapshfajyj.supabase.co/storage/v1/object/public/scans/tryon_results/res_123.webp"],
        )
        db.add(job)
        await db.commit()

    async def as_test_user():
        async with TestAsyncSessionLocal() as session:
            return await session.get(User, user_id)

    app.dependency_overrides[get_current_user] = as_test_user

    with patch("app.services.storage_service.delete_images_from_storage") as mock_del_tryon_storage, \
         patch("app.services.storage_service.delete_user_photo") as mock_del_photo:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver") as client:
            res = await client.delete(f"/api/v1/tryon/{job_id}")
            assert res.status_code == 200
            assert res.json()["success"] is True

        # Verify storage calls: Try-On storage deleted, user photo storage NEVER touched
        mock_del_tryon_storage.assert_called_once()
        mock_del_photo.assert_not_called()

    # Verify DB rows: TryOnJob deleted, UserSavedPhoto & BodyScan PRESERVED
    async with TestAsyncSessionLocal() as db:
        assert await db.get(TryOnJob, job_id) is None
        preserved_photo = await db.get(UserSavedPhoto, photo_id)
        assert preserved_photo is not None
        assert preserved_photo.display_name == "Primary Face"

        preserved_scan = await db.get(BodyScan, scan_id)
        assert preserved_scan is not None
        assert preserved_scan.front_photo_url_encrypted == "scans/front_scan.webp"


@pytest.mark.asyncio
async def test_delete_tryon_with_retailer_garment_keeps_garment():
    """Verify that deleting a Try-On with a retailer/catalog garment keeps the Garment DB row and Storage."""
    async with test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    user_id = uuid.uuid4()
    job_id = uuid.uuid4()
    garment_id = uuid.uuid4()

    async with TestAsyncSessionLocal() as db:
        user = User(
            id=user_id,
            email=f"user_{uuid.uuid4().hex[:6]}@example.com",
            password_hash="pwd_hash",
            is_active=True,
        )
        db.add(user)

        garment = Garment(
            id=garment_id,
            product_name="Amazon Formal Shirt",
            product_url="https://www.amazon.in/dp/B09XYZ1234",
            scraped_from_url="https://www.amazon.in/dp/B09XYZ1234",
            images=[{"url": "https://m.media-amazon.com/images/I/71xyz.jpg"}],
        )
        db.add(garment)

        job = TryOnJob(
            id=job_id,
            user_id=user_id,
            garment_id=garment_id,
            status="completed",
            result_image_urls=["tryon_results/test_res.webp"],
        )
        db.add(job)
        await db.commit()

    async def as_test_user():
        async with TestAsyncSessionLocal() as session:
            return await session.get(User, user_id)

    app.dependency_overrides[get_current_user] = as_test_user

    with patch("app.services.storage_service.delete_images_from_storage") as mock_del_tryon, \
         patch("app.services.storage_service.delete_garment_images_from_storage") as mock_del_garment:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver") as client:
            res = await client.delete(f"/api/v1/tryon/{job_id}")
            assert res.status_code == 200

        mock_del_tryon.assert_called_once()
        mock_del_garment.assert_not_called()

    async with TestAsyncSessionLocal() as db:
        assert await db.get(TryOnJob, job_id) is None
        persisted_garment = await db.get(Garment, garment_id)
        assert persisted_garment is not None
        assert persisted_garment.product_name == "Amazon Formal Shirt"


@pytest.mark.asyncio
async def test_delete_tryon_with_unique_user_uploaded_garment_deletes():
    """Verify that deleting a Try-On with a unique user-uploaded garment deletes the Garment DB row and Storage."""
    async with test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    user_id = uuid.uuid4()
    job_id = uuid.uuid4()
    garment_id = uuid.uuid4()
    garment_storage_url = "https://smzhdmutffzapshfajyj.supabase.co/storage/v1/object/public/scans/garments/user_uploaded_shirt.webp"

    async with TestAsyncSessionLocal() as db:
        user = User(
            id=user_id,
            email=f"user_{uuid.uuid4().hex[:6]}@example.com",
            password_hash="pwd_hash",
            is_active=True,
        )
        db.add(user)

        garment = Garment(
            id=garment_id,
            product_name="Uploaded Garment",
            product_url=None,
            scraped_from_url=None,
            brand_id=None,
            images=[{"url": garment_storage_url, "angle": "front"}],
        )
        db.add(garment)

        job = TryOnJob(
            id=job_id,
            user_id=user_id,
            garment_id=garment_id,
            status="completed",
            result_image_urls=["tryon_results/test_res.webp"],
        )
        db.add(job)
        await db.commit()

    async def as_test_user():
        async with TestAsyncSessionLocal() as session:
            return await session.get(User, user_id)

    app.dependency_overrides[get_current_user] = as_test_user

    with patch("app.services.storage_service.delete_images_from_storage") as mock_del_tryon, \
         patch("app.services.storage_service.delete_garment_images_from_storage") as mock_del_garment:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver") as client:
            res = await client.delete(f"/api/v1/tryon/{job_id}")
            assert res.status_code == 200

        mock_del_tryon.assert_called_once()
        mock_del_garment.assert_called_once_with([garment_storage_url])

    async with TestAsyncSessionLocal() as db:
        assert await db.get(TryOnJob, job_id) is None
        assert await db.get(Garment, garment_id) is None


@pytest.mark.asyncio
async def test_delete_tryon_with_shared_user_uploaded_garment_keeps():
    """Verify that deleting a Try-On with a user-uploaded garment that is ALSO used by another active Try-On preserves the garment."""
    async with test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    user_id = uuid.uuid4()
    job_1 = uuid.uuid4()
    job_2 = uuid.uuid4()
    garment_id = uuid.uuid4()
    garment_storage_url = "garments/shared_user_shirt.webp"

    async with TestAsyncSessionLocal() as db:
        user = User(
            id=user_id,
            email=f"user_{uuid.uuid4().hex[:6]}@example.com",
            password_hash="pwd_hash",
            is_active=True,
        )
        db.add(user)

        garment = Garment(
            id=garment_id,
            product_name="Uploaded Garment Shared",
            product_url=None,
            scraped_from_url=None,
            brand_id=None,
            images=[{"url": garment_storage_url}],
        )
        db.add(garment)

        j1 = TryOnJob(
            id=job_1,
            user_id=user_id,
            garment_id=garment_id,
            status="completed",
            result_image_urls=["tryon_results/res1.webp"],
        )
        j2 = TryOnJob(
            id=job_2,
            user_id=user_id,
            garment_id=garment_id,
            status="completed",
            result_image_urls=["tryon_results/res2.webp"],
        )
        db.add_all([j1, j2])
        await db.commit()

    async def as_test_user():
        async with TestAsyncSessionLocal() as session:
            return await session.get(User, user_id)

    app.dependency_overrides[get_current_user] = as_test_user

    with patch("app.services.storage_service.delete_images_from_storage") as mock_del_tryon, \
         patch("app.services.storage_service.delete_garment_images_from_storage") as mock_del_garment:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver") as client:
            # Delete only job_1
            res = await client.delete(f"/api/v1/tryon/{job_1}")
            assert res.status_code == 200

        mock_del_tryon.assert_called_once()
        mock_del_garment.assert_not_called()

    # Verify garment is PRESERVED because job_2 still references it
    async with TestAsyncSessionLocal() as db:
        assert await db.get(TryOnJob, job_1) is None
        assert await db.get(TryOnJob, job_2) is not None
        preserved = await db.get(Garment, garment_id)
        assert preserved is not None


@pytest.mark.asyncio
async def test_tryon_deletion_deletes_both_canonical_and_thumbnail_webp():
    """Verify that delete_images_from_storage includes companion thumb_*.webp in remove() list."""
    mock_client = MagicMock()
    mock_bucket = MagicMock()
    mock_client.storage.from_.return_value = mock_bucket

    with patch("app.services.storage_service._get_supabase_client", return_value=mock_client), \
         patch("app.services.storage_service.settings") as mock_settings:
        mock_settings.supabase_url = "https://test.supabase.co"
        mock_settings.supabase_service_key = "test_key"
        mock_settings.supabase_storage_bucket = "scans"

        canonical_url = "https://test.supabase.co/storage/v1/object/public/scans/tryon_results/abc-123.webp"
        delete_images_from_storage([canonical_url])

        # Expect both canonical and companion thumb to be passed to bucket.remove()
        mock_bucket.remove.assert_called_once_with([
            "tryon_results/abc-123.webp",
            "tryon_results/thumb_abc-123.webp",
        ])


@pytest.mark.asyncio
async def test_clear_all_history_reference_aware_cleanup():
    """Verify that clear_all_history cleans up orphaned user-uploaded garments and retains retailer garments."""
    async with test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    user_id = uuid.uuid4()
    retail_gid = uuid.uuid4()
    user_gid = uuid.uuid4()

    async with TestAsyncSessionLocal() as db:
        user = User(
            id=user_id,
            email=f"user_{uuid.uuid4().hex[:6]}@example.com",
            password_hash="pwd_hash",
            is_active=True,
        )
        db.add(user)

        retail_garment = Garment(
            id=retail_gid,
            product_name="Retailer Kurta",
            product_url="https://www.myntra.com/kurtas/123",
            images=[{"url": "https://assets.myntassets.com/kurta.jpg"}],
        )
        user_garment = Garment(
            id=user_gid,
            product_name="User Uploaded Kurta",
            product_url=None,
            images=[{"url": "garments/user_k.webp"}],
        )
        db.add_all([retail_garment, user_garment])

        j1 = TryOnJob(
            id=uuid.uuid4(),
            user_id=user_id,
            garment_id=retail_gid,
            status="completed",
            result_image_urls=["tryon_results/j1.webp"],
        )
        j2 = TryOnJob(
            id=uuid.uuid4(),
            user_id=user_id,
            garment_id=user_gid,
            status="completed",
            result_image_urls=["tryon_results/j2.webp"],
        )
        db.add_all([j1, j2])
        await db.commit()

    async def as_test_user():
        async with TestAsyncSessionLocal() as session:
            return await session.get(User, user_id)

    app.dependency_overrides[get_current_user] = as_test_user

    with patch("app.services.storage_service.delete_images_from_storage"), \
         patch("app.services.storage_service.delete_garment_images_from_storage") as mock_del_garment:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver") as client:
            res = await client.delete("/api/v1/tryon/history")
            assert res.status_code == 200
            assert res.json()["deleted"] == 2

        # User-uploaded garment was cleaned up from storage
        mock_del_garment.assert_called_once_with(["garments/user_k.webp"])

    # Verify DB: retail garment KEPT, user garment DELETED
    async with TestAsyncSessionLocal() as db:
        assert await db.get(Garment, retail_gid) is not None
        assert await db.get(Garment, user_gid) is None


@pytest.mark.asyncio
async def test_account_deletion_preserves_retailer_catalog_and_deletes_user_uploaded_garments():
    """Verify that deleting an account purges user-uploaded garments while preserving shared retailer catalog items."""
    async with test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    user_id = uuid.uuid4()
    retail_gid = uuid.uuid4()
    user_gid = uuid.uuid4()

    async with TestAsyncSessionLocal() as db:
        user = User(
            id=user_id,
            email=f"del_{uuid.uuid4().hex[:6]}@example.com",
            password_hash="pwd_hash",
            is_active=True,
        )
        db.add(user)

        retail_garment = Garment(
            id=retail_gid,
            product_name="Catalog Saree",
            product_url="https://www.ajio.com/p/123",
            images=[{"url": "https://assets.ajio.com/saree.jpg"}],
        )
        user_garment = Garment(
            id=user_gid,
            product_name="Personal Saree Upload",
            product_url=None,
            images=[{"url": "garments/saree_user.webp"}],
        )
        db.add_all([retail_garment, user_garment])

        job1 = TryOnJob(
            id=uuid.uuid4(),
            user_id=user_id,
            garment_id=retail_gid,
            status="completed",
            result_image_urls=["tryon_results/saree_r1.webp"],
        )
        job2 = TryOnJob(
            id=uuid.uuid4(),
            user_id=user_id,
            garment_id=user_gid,
            status="completed",
            result_image_urls=["tryon_results/saree_r2.webp"],
        )
        db.add_all([job1, job2])
        await db.commit()

    async def as_test_user():
        async with TestAsyncSessionLocal() as session:
            return await session.get(User, user_id)

    app.dependency_overrides[get_current_user] = as_test_user

    with patch("app.core.firebase.delete_firebase_user", return_value=True), \
         patch("app.services.storage_service.delete_images_from_storage"), \
         patch("app.services.storage_service.delete_garment_images_from_storage") as mock_del_garment:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver") as client:
            res = await client.delete("/api/v1/user/account")
            assert res.status_code == 200

        mock_del_garment.assert_called_once_with(["garments/saree_user.webp"])

    async with TestAsyncSessionLocal() as db:
        assert await db.get(User, user_id) is None
        # Retailer catalog garment remains
        assert await db.get(Garment, retail_gid) is not None
        # User-uploaded garment is deleted
        assert await db.get(Garment, user_gid) is None


def test_delete_garment_images_from_storage_safety_guards():
    """Verify URL normalization, multi-image arrays, and safety guards against non-garment assets."""
    mock_client = MagicMock()
    mock_bucket = MagicMock()
    mock_client.storage.from_.return_value = mock_bucket

    with patch("app.services.storage_service._get_supabase_client", return_value=mock_client), \
         patch("app.services.storage_service.settings") as mock_settings:
        mock_settings.supabase_url = "https://test.supabase.co"
        mock_settings.supabase_service_key = "test_key"
        mock_settings.supabase_storage_bucket = "scans"

        mixed_paths = [
            "https://test.supabase.co/storage/v1/object/public/scans/garments/shirt_front.webp",
            "https://test.supabase.co/storage/v1/object/sign/scans/garments/shirt_back.webp?token=xyz",
            "scans/garments/shirt_side.webp",
            "garments/shirt_detail.jpg",
            # Items that MUST be safely skipped:
            "https://assets.myntassets.com/retailer_dress.jpg",
            "tryon_results/tryon_look.webp",
            "user_photos/face.webp",
            "scans/body_scan.webp",
            "data:image/png;base64,123",
        ]

        delete_garment_images_from_storage(mixed_paths)

        mock_bucket.remove.assert_called_once_with([
            "garments/shirt_front.webp",
            "garments/shirt_back.webp",
            "garments/shirt_side.webp",
            "garments/shirt_detail.jpg",
        ])
