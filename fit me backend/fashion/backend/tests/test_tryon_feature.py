import uuid
from datetime import UTC, datetime, timedelta
import pytest
from httpx import ASGITransport, AsyncClient

from app.core import database as core_db
from tests.conftest import TestAsyncSessionLocal
from app.api.deps import get_current_user
from app.main import app
from app.models.tryon_job import TryOnJob
from app.models.garment import Garment
from app.models.user import User
from app.models.user_saved_photo import UserSavedPhoto


@pytest.mark.asyncio
async def test_tryon_history_status_and_saved_filters():
    user_id = uuid.uuid4()
    test_user = User(id=user_id, email=f"test_{uuid.uuid4().hex[:6]}@fitme.com")
    app.dependency_overrides[get_current_user] = lambda: test_user
    garment_id = uuid.uuid4()

    try:
        async with core_db.AsyncSessionLocal() as session:
            g = Garment(
                id=garment_id,
                product_name="Silk Summer Dress",
                images=[{"url": "https://example.com/dress.jpg"}],
                garment_type="dress",
                scraped_from_url="https://www.amazon.in/dp/B00EXAMPLE",
            )
            session.add(g)

            j1 = TryOnJob(
                id=uuid.uuid4(),
                user_id=user_id,
                garment_id=garment_id,
                status="completed",
                result_image_urls=["https://example.com/res1.png"],
                is_saved=True,
                created_at=datetime.now(UTC) - timedelta(hours=3),
            )
            j2 = TryOnJob(
                id=uuid.uuid4(),
                user_id=user_id,
                garment_id=garment_id,
                status="completed",
                result_image_urls=["https://example.com/res2.png"],
                is_saved=False,
                created_at=datetime.now(UTC) - timedelta(hours=2),
            )
            j3 = TryOnJob(
                id=uuid.uuid4(),
                user_id=user_id,
                garment_id=garment_id,
                status="processing",
                is_saved=False,
                created_at=datetime.now(UTC) - timedelta(hours=1),
            )
            j4 = TryOnJob(
                id=uuid.uuid4(),
                user_id=user_id,
                garment_id=garment_id,
                status="failed",
                is_saved=False,
                created_at=datetime.now(UTC),
            )
            session.add_all([j1, j2, j3, j4])
            await session.commit()

        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            res_comp = await client.get("/api/v1/tryon/history?status=completed")
            assert res_comp.status_code == 200
            comp_items = res_comp.json()
            comp_ids = [item["id"] for item in comp_items]
            assert str(j1.id) in comp_ids
            assert str(j2.id) in comp_ids
            assert str(j3.id) not in comp_ids
            assert str(j4.id) not in comp_ids

            item1 = next(i for i in comp_items if i["id"] == str(j1.id))
            assert item1["title"] == "Silk Summer Dress"
            assert item1["platform"] == "Amazon"
            assert item1["is_saved"] is True

            res_saved = await client.get("/api/v1/tryon/history?status=completed&saved_only=true")
            assert res_saved.status_code == 200
            saved_items = res_saved.json()
            assert len(saved_items) == 1
            assert saved_items[0]["id"] == str(j1.id)
            assert saved_items[0]["is_saved"] is True
    finally:
        app.dependency_overrides.pop(get_current_user, None)


@pytest.mark.asyncio
async def test_tryon_toggle_save():
    user_id = uuid.uuid4()
    test_user = User(id=user_id, email=f"test_{uuid.uuid4().hex[:6]}@fitme.com")
    app.dependency_overrides[get_current_user] = lambda: test_user
    job_id = uuid.uuid4()
    garment_id = uuid.uuid4()

    try:
        async with core_db.AsyncSessionLocal() as session:
            g = Garment(id=garment_id, product_name="Linen Shirt", images=[{"url": "https://example.com/shirt.jpg"}])
            j = TryOnJob(id=job_id, user_id=user_id, garment_id=garment_id, status="completed", is_saved=False)
            session.add_all([g, j])
            await session.commit()

        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            res1 = await client.post(f"/api/v1/tryon/{job_id}/toggle-save")
            assert res1.status_code == 200
            assert res1.json()["is_saved"] is True

            res2 = await client.post(f"/api/v1/tryon/{job_id}/toggle-save")
            assert res2.status_code == 200
            assert res2.json()["is_saved"] is False
    finally:
        app.dependency_overrides.pop(get_current_user, None)


@pytest.mark.asyncio
async def test_tryon_individual_delete_and_user_isolation(monkeypatch):
    user_a_id = uuid.uuid4()
    user_b_id = uuid.uuid4()
    test_user_a = User(id=user_a_id, email=f"user_a_{uuid.uuid4().hex[:6]}@fitme.com")
    app.dependency_overrides[get_current_user] = lambda: test_user_a

    job_a1_id = uuid.uuid4()
    job_a2_id = uuid.uuid4()
    job_b1_id = uuid.uuid4()
    garment_id = uuid.uuid4()

    deleted_storage_paths = []
    from app.services import storage_service
    def mock_delete_storage(paths):
        deleted_storage_paths.extend(paths)
    monkeypatch.setattr(storage_service, "delete_images_from_storage", mock_delete_storage)

    try:
        async with core_db.AsyncSessionLocal() as session:
            g = Garment(id=garment_id, product_name="Denim Jacket", images=[{"url": "https://example.com/j.jpg"}])
            ja1 = TryOnJob(
                id=job_a1_id,
                user_id=user_a_id,
                garment_id=garment_id,
                status="completed",
                result_image_urls=["https://test.supabase.co/storage/v1/object/public/scans/tryon_results/ja1.png"],
                is_saved=True,
            )
            ja2 = TryOnJob(id=job_a2_id, user_id=user_a_id, garment_id=garment_id, status="completed", is_saved=False)
            jb1 = TryOnJob(id=job_b1_id, user_id=user_b_id, garment_id=garment_id, status="completed", is_saved=True)
            session.add_all([g, ja1, ja2, jb1])
            await session.commit()

        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            # 1. User A tries to delete User B job -> 404
            res_del_b = await client.delete(f"/api/v1/tryon/{job_b1_id}")
            assert res_del_b.status_code == 404

            # Verify User B job is still intact in DB
            async with core_db.AsyncSessionLocal() as session:
                check_b = await session.get(TryOnJob, job_b1_id)
                assert check_b is not None

            # 2. User A deletes job_a1
            res_del_a = await client.delete(f"/api/v1/tryon/{job_a1_id}")
            assert res_del_a.status_code == 200
            assert res_del_a.json()["deleted"] == 1
            assert "https://test.supabase.co/storage/v1/object/public/scans/tryon_results/ja1.png" in deleted_storage_paths

            # 3. Verify job_a1 is gone from both history and saved views
            res_hist = await client.get("/api/v1/tryon/history?status=completed")
            hist_ids = [item["id"] for item in res_hist.json()]
            assert str(job_a1_id) not in hist_ids
            assert str(job_a2_id) in hist_ids

            res_saved = await client.get("/api/v1/tryon/history?status=completed&saved_only=true")
            assert len(res_saved.json()) == 0
    finally:
        app.dependency_overrides.pop(get_current_user, None)


@pytest.mark.asyncio
async def test_tryon_clear_all_history_user_isolation(monkeypatch):
    user_a_id = uuid.uuid4()
    user_b_id = uuid.uuid4()
    test_user_a = User(id=user_a_id, email=f"user_a_{uuid.uuid4().hex[:6]}@fitme.com")
    app.dependency_overrides[get_current_user] = lambda: test_user_a

    job_a1_id = uuid.uuid4()
    job_a2_id = uuid.uuid4()
    job_b1_id = uuid.uuid4()
    garment_id = uuid.uuid4()

    deleted_storage_paths = []
    from app.services import storage_service
    def mock_delete_storage(paths):
        deleted_storage_paths.extend(paths)
    monkeypatch.setattr(storage_service, "delete_images_from_storage", mock_delete_storage)

    try:
        async with core_db.AsyncSessionLocal() as session:
            g = Garment(id=garment_id, product_name="Formal Blazer", images=[{"url": "https://example.com/b.jpg"}])
            ja1 = TryOnJob(
                id=job_a1_id,
                user_id=user_a_id,
                garment_id=garment_id,
                status="completed",
                result_image_urls=["https://test.supabase.co/storage/v1/object/public/scans/tryon_results/a1.png"],
            )
            ja2 = TryOnJob(
                id=job_a2_id,
                user_id=user_a_id,
                garment_id=garment_id,
                status="completed",
                result_image_urls=["https://test.supabase.co/storage/v1/object/public/scans/tryon_results/a2.png"],
            )
            jb1 = TryOnJob(
                id=job_b1_id,
                user_id=user_b_id,
                garment_id=garment_id,
                status="completed",
                result_image_urls=["https://test.supabase.co/storage/v1/object/public/scans/tryon_results/b1.png"],
            )
            session.add_all([g, ja1, ja2, jb1])
            await session.commit()

        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            res_del = await client.delete("/api/v1/tryon/history")
            assert res_del.status_code == 200
            assert res_del.json()["success"] is True
            assert res_del.json()["deleted"] >= 2

            assert "https://test.supabase.co/storage/v1/object/public/scans/tryon_results/a1.png" in deleted_storage_paths
            assert "https://test.supabase.co/storage/v1/object/public/scans/tryon_results/a2.png" in deleted_storage_paths
            assert "https://test.supabase.co/storage/v1/object/public/scans/tryon_results/b1.png" not in deleted_storage_paths

            res_hist = await client.get("/api/v1/tryon/history")
            assert len(res_hist.json()) == 0

        async with core_db.AsyncSessionLocal() as session:
            check_b = await session.get(TryOnJob, job_b1_id)
            assert check_b is not None
            assert check_b.user_id == user_b_id
    finally:
        app.dependency_overrides.pop(get_current_user, None)


@pytest.mark.asyncio
async def test_tryon_get_detail_success_and_isolation():
    user_a_id = uuid.uuid4()
    user_b_id = uuid.uuid4()
    test_user_a = User(id=user_a_id, email=f"user_a_{uuid.uuid4().hex[:6]}@fitme.com")
    app.dependency_overrides[get_current_user] = lambda: test_user_a

    job_a_id = uuid.uuid4()
    job_b_id = uuid.uuid4()
    garment_a_id = uuid.uuid4()
    garment_b_id = uuid.uuid4()

    try:
        async with core_db.AsyncSessionLocal() as session:
            ga = Garment(
                id=garment_a_id,
                product_name="Embroidered Chanderi Kurta",
                images=[{"url": "https://example.com/kurta_garment.jpg", "angle": "front"}],
                garment_type="kurta",
                scraped_from_url="https://www.myntra.com/kurtas/silakaari/12345/buy",
            )
            gb = Garment(
                id=garment_b_id,
                product_name="Leather Jacket",
                images=[{"url": "https://example.com/jacket.jpg", "angle": "front"}],
                garment_type="jacket",
                scraped_from_url="https://www.amazon.in/dp/B00JACKET",
            )
            ja = TryOnJob(
                id=job_a_id,
                user_id=user_a_id,
                garment_id=garment_a_id,
                status="completed",
                result_image_urls=["https://example.com/kurta_vton_result.png"],
                is_saved=True,
            )
            jb = TryOnJob(
                id=job_b_id,
                user_id=user_b_id,
                garment_id=garment_b_id,
                status="completed",
                result_image_urls=["https://example.com/jacket_vton_result.png"],
                is_saved=False,
            )
            session.add_all([ga, gb, ja, jb])
            await session.commit()

        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            # 1. User A fetches own job detail
            res_a = await client.get(f"/api/v1/tryon/{job_a_id}/detail")
            assert res_a.status_code == 200
            data_a = res_a.json()
            assert data_a["id"] == str(job_a_id)
            assert data_a["title"] == "Embroidered Chanderi Kurta"
            assert data_a["platform"] == "Myntra"
            assert data_a["garment_image_url"] == "https://example.com/kurta_garment.jpg"
            assert data_a["result_image_urls"] == ["https://example.com/kurta_vton_result.png"]
            assert data_a["is_saved"] is True
            assert data_a["product_url"] == "https://www.myntra.com/kurtas/silakaari/12345/buy"

            # 2. User A attempts to fetch User B's job detail -> 404 (Isolation)
            res_b = await client.get(f"/api/v1/tryon/{job_b_id}/detail")
            assert res_b.status_code == 404

            # 3. Invalid UUID or non-existent job -> 404
            res_invalid = await client.get(f"/api/v1/tryon/{uuid.uuid4()}/detail")
            assert res_invalid.status_code == 404
    finally:
        app.dependency_overrides.pop(get_current_user, None)


@pytest.mark.asyncio
async def test_tryon_start_rejects_file_uri_garment():
    """Verify that garments with local file:// URIs are rejected before reaching Try-On provider."""
    user_id = uuid.uuid4()
    test_user = User(id=user_id, email=f"test_{uuid.uuid4().hex[:6]}@fitme.com", password_hash="test_pw_hash")
    app.dependency_overrides[get_current_user] = lambda: test_user
    garment_id = uuid.uuid4()
    photo_id = uuid.uuid4()

    try:
        async with core_db.AsyncSessionLocal() as session:
            session.add(test_user)
            photo = UserSavedPhoto(
                id=photo_id,
                user_id=user_id,
                storage_path="scans/test.webp",
                display_name="My Photo 1",
                original_filename="photo.jpg",
                mime_type="image/webp",
            )
            g = Garment(
                id=garment_id,
                product_name="Local Garment",
                images=[{"url": "file:///Users/simulator/ImagePicker/test.png"}],
                garment_type="shirt",
            )
            session.add_all([photo, g])
            await session.commit()

        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            res = await client.post(
                "/api/v1/tryon/start",
                json={
                    "garment_id": str(garment_id),
                    "saved_photo_id": str(photo_id),
                },
            )
            assert res.status_code == 422
            data = res.json()
            assert data["detail"]["error"] == "GARMENT_IMAGE_URL_INVALID"
    finally:
        app.dependency_overrides.pop(get_current_user, None)


@pytest.mark.asyncio
async def test_upload_garment_endpoint_creates_valid_https_garment():
    """Verify POST /api/v1/product/upload-garment uploads bytes to Supabase Storage and creates HTTPS garment."""
    user_id = uuid.uuid4()
    test_user = User(id=user_id, email=f"test_{uuid.uuid4().hex[:6]}@fitme.com")
    app.dependency_overrides[get_current_user] = lambda: test_user

    try:
        # Create a simulated high-res 2000x2666 JPEG image
        from PIL import Image as PILImage
        import io
        img = PILImage.new("RGB", (2000, 2666), (120, 80, 160))
        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=90)
        jpeg_bytes = buf.getvalue()

        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            res = await client.post(
                "/api/v1/product/upload-garment",
                files={"image": ("test_shirt.jpg", jpeg_bytes, "image/jpeg")},
                data={"title": "Custom Linen Shirt", "brand": "Studio Fit", "price": "1999"},
            )
            assert res.status_code == 200
            data = res.json()
            assert data["status"] == "fetched"
            assert data["product"]["title"] == "Custom Linen Shirt"
            assert data["product"]["images"][0].startswith("http")
            assert "garments/" in data["product"]["images"][0]
            assert data["product"]["images"][0].split("?")[0].endswith(".webp")

            # Verify in DB
            garment_id = uuid.UUID(data["product_id"])
            async with TestAsyncSessionLocal() as session:
                g = await session.get(Garment, garment_id)
                assert g is not None
                assert g.product_name == "Custom Linen Shirt"
                assert g.images[0]["url"].startswith("http")
                assert g.images[0]["url"].split("?")[0].endswith(".webp")
    finally:
        app.dependency_overrides.pop(get_current_user, None)



