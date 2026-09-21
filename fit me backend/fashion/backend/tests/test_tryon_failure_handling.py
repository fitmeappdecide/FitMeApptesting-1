import pytest
import uuid
from httpx import ASGITransport, AsyncClient
from unittest.mock import patch, MagicMock

from app.main import app
from app.api.deps import get_current_user
import os
import sys
sys.path.insert(0, os.path.dirname(__file__))
from conftest import TestAsyncSessionLocal, test_engine
from app.core.database import Base
from app.models.user import User
from app.models.garment import Garment
from app.models.user_saved_photo import UserSavedPhoto
from app.models.tryon_job import TryOnJob


@pytest.mark.asyncio
async def test_tryon_failure_does_not_return_stock_garment():
    async with test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    user_id = uuid.uuid4()
    garment_id = uuid.uuid4()
    photo_id = uuid.uuid4()

    async with TestAsyncSessionLocal() as db:
        user = User(
            id=user_id,
            email=f"tryon_fail_{uuid.uuid4().hex[:6]}@example.com",
            password_hash="pwd_hash",
            full_name="Tryon User",
            is_active=True,
        )
        db.add(user)

        garment = Garment(
            id=garment_id,
            product_name="Blue Denim Jacket",
            images=["https://images.example.com/denim_stock_photo.jpg"],
        )
        db.add(garment)

        photo = UserSavedPhoto(
            id=photo_id,
            user_id=user_id,
            storage_path="user_photos/person.jpg",
            display_name="User Profile Photo",
        )
        db.add(photo)
        await db.commit()

    async def as_test_user():
        async with TestAsyncSessionLocal() as session:
            return await session.get(User, user_id)

    app.dependency_overrides[get_current_user] = as_test_user

    mock_provider = MagicMock()
    async def mock_fail(*args, **kwargs):
        raise RuntimeError("GPU out of memory or invalid pose")
    mock_provider.generate_tryon = mock_fail

    with patch("app.api.tryon.get_tryon_provider", return_value=mock_provider):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver") as client:
            # 1. Start try-on with mock failure
            start_res = await client.post(
                "/api/v1/tryon/start",
                json={"garment_id": str(garment_id), "saved_photo_id": str(photo_id)},
            )
            assert start_res.status_code == 200
            job_id = start_res.json()["job_id"]

            # 2. Check status endpoint
            status_res = await client.get(f"/api/v1/tryon/{job_id}")
            assert status_res.status_code == 200
            status_data = status_res.json()
            assert status_data["status"] == "failed"
            assert status_data["error_message"] is not None

            # 3. Check result endpoint - should return 422 TRYON_FAILED, NOT stock photo
            result_res = await client.get(f"/api/v1/tryon/{job_id}/result")
            assert result_res.status_code == 422
            err_data = result_res.json()
            assert err_data["detail"]["error"] == "TRYON_FAILED"

            # 4. Verify in DB that result_image_urls is NOT set to stock garment url
            async with TestAsyncSessionLocal() as db:
                saved_job = await db.get(TryOnJob, uuid.UUID(job_id))
                assert saved_job is not None
                assert saved_job.status == "failed"
                assert "https://images.example.com/denim_stock_photo.jpg" not in (saved_job.result_image_urls or [])
