import pytest
import uuid
from httpx import ASGITransport, AsyncClient
from app.main import app
from app.api.deps import get_current_user
import app.core.database as core_db
from tests.conftest import TestAsyncSessionLocal, test_engine
from app.core.database import Base
from app.models.user import User
from app.models.user_saved_photo import UserSavedPhoto
from app.models.body_scan import BodyScan
from app.models.tryon_job import TryOnJob
from app.models.garment import Garment
from app.models.ava import AVAConversation, AVAMessage


@pytest.mark.asyncio
async def test_real_account_deletion():
    async with test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    user_id = uuid.uuid4()
    garment_id = uuid.uuid4()

    async with TestAsyncSessionLocal() as db:
        user = User(
            id=user_id,
            email=f"del_{uuid.uuid4().hex[:6]}@example.com",
            password_hash="pwd_hash",
            full_name="Delete Me",
            is_active=True,
        )
        db.add(user)

        garment = Garment(
            id=garment_id,
            product_name="Test Shirt",
            images=["https://example.com/shirt.jpg"],
        )
        db.add(garment)

        photo = UserSavedPhoto(
            id=uuid.uuid4(),
            user_id=user_id,
            storage_path="user_photos/test_photo.jpg",
            display_name="My Photo",
        )
        db.add(photo)

        scan = BodyScan(
            id=uuid.uuid4(),
            user_id=user_id,
            front_photo_url_encrypted="scans/front.webp",
            consent_given=True,
        )
        db.add(scan)

        job = TryOnJob(
            id=uuid.uuid4(),
            user_id=user_id,
            garment_id=garment_id,
            status="completed",
            result_image_urls=["https://example.com/result.jpg"],
        )
        db.add(job)

        conv = AVAConversation(
            id=uuid.uuid4(),
            user_id=user_id,
            title="Session to Delete",
        )
        db.add(conv)

        await db.commit()

    async def as_test_user():
        async with TestAsyncSessionLocal() as session:
            return await session.get(User, user_id)

    app.dependency_overrides[get_current_user] = as_test_user

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver") as client:
        # 1. Trigger account deletion
        res = await client.delete("/api/v1/user/account")
        assert res.status_code == 200
        assert res.json()["status"] == "deleted"

    # 2. Verify in database: User and cascading records are gone
    async with TestAsyncSessionLocal() as db:
        deleted_user = await db.get(User, user_id)
        assert deleted_user is None

        user_photos = (await db.execute(
            UserSavedPhoto.__table__.select().where(UserSavedPhoto.user_id == user_id)
        )).fetchall()
        assert len(user_photos) == 0

        user_scans = (await db.execute(
            BodyScan.__table__.select().where(BodyScan.user_id == user_id)
        )).fetchall()
        assert len(user_scans) == 0

        user_convs = (await db.execute(
            AVAConversation.__table__.select().where(AVAConversation.user_id == user_id)
        )).fetchall()
        assert len(user_convs) == 0

        # Verify shared catalog garment was NOT deleted
        persisted_garment = await db.get(Garment, garment_id)
        assert persisted_garment is not None
