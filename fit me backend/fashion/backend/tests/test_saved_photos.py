import io
import uuid
import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from unittest.mock import patch

from app.core import database as core_db
from app.main import app
from app.models.brand import Brand
from app.models.garment import Garment
from app.models.user import User
from app.models.user_saved_photo import UserSavedPhoto
from app.models.tryon_job import TryOnJob

DUMMY_JPEG = b"\xff\xd8\xff\xe0\x00\x10JFIF\x00\x01\x01\x01\x00H\x00H\x00\x00\xff\xdb\x00C\x00\x08\x06\x06\x07\x06\x05\x08\x07\x07\x07\t\t\x08\n\x0c\x14\r\x0c\x0b\x0b\x0c\x19\x12\x13\x0f\x14\x1d\x1a\x1f\x1e\x1d\x1a\x1c\x1c $.' \",#\x1c\x1c(7),01444\x1f'9=82<.342\xff\xc0\x00\x0b\x08\x00\x01\x00\x01\x01\x01\x11\x00\xff\xc4\x00\x1f\x00\x00\x01\x05\x01\x01\x01\x01\x01\x01\x00\x00\x00\x00\x00\x00\x00\x00\x01\x02\x03\x04\x05\x06\x07\x08\t\n\x0b\xff\xda\x00\x08\x01\x01\x00\x00?\x00\xbf\x00\xff\xd9"


@pytest.mark.asyncio
async def test_auto_naming_and_upload():
    """Test uploading photos: auto-naming generates My Photo 1, My Photo 2, and custom names."""
    with patch("app.api.saved_photos.upload_user_photo"), \
         patch("app.api.saved_photos.create_signed_photo_url", return_value="https://signed.url/photo.jpg"):

        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            # 1. Upload first photo without name -> My Photo 1
            res1 = await client.post(
                "/api/v1/photos/upload",
                files={"file": ("test1.jpg", DUMMY_JPEG + b"\x01", "image/jpeg")},
            )
            assert res1.status_code == 201
            data1 = res1.json()
            assert data1["display_name"] == "My Photo 1"
            assert data1["signed_url"] == "https://signed.url/photo.jpg"
            photo1_id = data1["id"]

            # 1b. Upload exact duplicate of photo 1 -> returns existing photo1_id with display_name My Photo 1
            res1_dup = await client.post(
                "/api/v1/photos/upload",
                files={"file": ("test1_dup.jpg", DUMMY_JPEG + b"\x01", "image/jpeg")},
            )
            assert res1_dup.status_code == 201
            assert res1_dup.json()["id"] == photo1_id
            assert res1_dup.json()["display_name"] == "My Photo 1"

            # 2. Upload second distinct photo without name -> My Photo 2
            res2 = await client.post(
                "/api/v1/photos/upload",
                files={"file": ("test2.jpg", DUMMY_JPEG + b"\x02", "image/jpeg")},
            )
            assert res2.status_code == 201
            data2 = res2.json()
            assert data2["display_name"] == "My Photo 2"
            photo2_id = data2["id"]

            # 3. Upload third distinct photo with explicit custom name
            res3 = await client.post(
                "/api/v1/photos/upload",
                files={"file": ("test3.jpg", DUMMY_JPEG + b"\x03", "image/jpeg")},
                data={"display_name": "Friend 1"},
            )
            assert res3.status_code == 201
            data3 = res3.json()
            assert data3["display_name"] == "Friend 1"
            photo3_id = data3["id"]

            # 4. List photos
            list_res = await client.get("/api/v1/photos/")
            assert list_res.status_code == 200
            photos = list_res.json()
            assert len(photos) >= 3
            names = [p["display_name"] for p in photos]
            assert "My Photo 1" in names
            assert "My Photo 2" in names
            assert "Friend 1" in names

            # 5. Delete My Photo 1 -> Remaining photo (My Photo 2) is automatically renumbered to My Photo 1 without gaps
            del_res = await client.delete(f"/api/v1/photos/{photo1_id}")
            assert del_res.status_code == 200

            list_res_after_del = await client.get("/api/v1/photos/")
            assert list_res_after_del.status_code == 200
            names_after_del = [p["display_name"] for p in list_res_after_del.json()]
            assert "My Photo 1" in names_after_del
            assert "Friend 1" in names_after_del

            # 6. Upload another new photo without name -> assigned next sequential slot: My Photo 2
            res4 = await client.post(
                "/api/v1/photos/upload",
                files={"file": ("test4.jpg", DUMMY_JPEG + b"\x04", "image/jpeg")},
            )
            assert res4.status_code == 201
            assert res4.json()["display_name"] == "My Photo 2"


@pytest.mark.asyncio
async def test_rename_saved_photo():
    """Test renaming a photo modifies display_name while preserving id."""
    with patch("app.api.saved_photos.upload_user_photo"), \
         patch("app.api.saved_photos.create_signed_photo_url", return_value="https://signed.url/photo.jpg"):

        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            res = await client.post(
                "/api/v1/photos/upload",
                files={"file": ("test.jpg", DUMMY_JPEG, "image/jpeg")},
                data={"display_name": "Temp Name"},
            )
            assert res.status_code == 201
            photo_id = res.json()["id"]

            # Rename to "Sarah"
            rename_res = await client.patch(
                f"/api/v1/photos/{photo_id}",
                json={"display_name": "Sarah"},
            )
            assert rename_res.status_code == 200
            renamed = rename_res.json()
            assert renamed["id"] == photo_id
            assert renamed["display_name"] == "Sarah"


@pytest.mark.asyncio
async def test_tryon_saved_photo_snapshot_and_deletion():
    """Test TryOnJob captures saved_photo_id and saved_photo_name snapshot,
    and when source photo is deleted, saved_photo_id becomes NULL while saved_photo_name remains intact.
    """
    with patch("app.api.saved_photos.upload_user_photo"), \
         patch("app.api.saved_photos.delete_user_photo"), \
         patch("app.api.saved_photos.create_signed_photo_url", return_value="https://signed.url/photo.jpg"):

        test_user_id = uuid.UUID("a1b2c3d4-e5f6-7890-abcd-ef1234567890")
        garment_id = uuid.uuid4()
        job_id = uuid.uuid4()

        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            # 1. Create saved photo "Friend 1"
            photo_res = await client.post(
                "/api/v1/photos/upload",
                files={"file": ("friend.jpg", DUMMY_JPEG, "image/jpeg")},
                data={"display_name": "Friend 1"},
            )
            assert photo_res.status_code == 201
            photo_id = uuid.UUID(photo_res.json()["id"])

            # 2. Seed Garment and TryOnJob with saved_photo_id & saved_photo_name snapshot
            async with core_db.AsyncSessionLocal() as session:
                garment = Garment(
                    id=garment_id,
                    product_name="Blue Denim Jacket",
                    images=[{"url": "https://img.jpg"}],
                    garment_type="jacket",
                )
                job = TryOnJob(
                    id=job_id,
                    user_id=test_user_id,
                    garment_id=garment_id,
                    status="completed",
                    result_image_urls=["https://res.jpg"],
                    saved_photo_id=photo_id,
                    saved_photo_name="Friend 1",
                )
                session.add(garment)
                session.add(job)
                await session.commit()

            # 3. Check detail payload has saved_photo_id and saved_photo_name
            detail_res = await client.get(f"/api/v1/tryon/{job_id}/detail")
            assert detail_res.status_code == 200
            detail = detail_res.json()
            assert detail["saved_photo_id"] == str(photo_id)
            assert detail["saved_photo_name"] == "Friend 1"

            # 4. Filter history by saved_photo_id
            filtered_history = await client.get(f"/api/v1/tryon/history?saved_photo_id={photo_id}")
            assert filtered_history.status_code == 200
            filtered_items = filtered_history.json()
            assert len(filtered_items) >= 1
            assert any(item["id"] == str(job_id) for item in filtered_items)

            # 5. Delete source photo "Friend 1"
            del_photo_res = await client.delete(f"/api/v1/photos/{photo_id}")
            assert del_photo_res.status_code == 200

            # 6. Verify detail preserves historical saved_photo_name snapshot even though saved_photo_id is NULL
            detail_after_del = await client.get(f"/api/v1/tryon/{job_id}/detail")
            assert detail_after_del.status_code == 200
            detail2 = detail_after_del.json()
            assert detail2["saved_photo_id"] is None
            assert detail2["saved_photo_name"] == "Friend 1"  # Snapshot preserved!

            # 7. Verify All history still contains the tryon job
            all_history = await client.get("/api/v1/tryon/history")
            assert all_history.status_code == 200
            assert any(item["id"] == str(job_id) for item in all_history.json())
