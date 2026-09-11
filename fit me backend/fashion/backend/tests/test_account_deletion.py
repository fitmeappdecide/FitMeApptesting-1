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

    from unittest.mock import patch
    with patch("app.core.firebase.delete_firebase_user", return_value=True):
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


@pytest.mark.asyncio
async def test_firebase_account_deletion_invoked():
    from unittest.mock import patch, MagicMock
    from app.core.firebase import delete_firebase_user

    user_id = uuid.uuid4()
    test_email = f"fb_{uuid.uuid4().hex[:6]}@example.com"
    expected_uid = f"fb_uid_{uuid.uuid4().hex[:8]}"

    async with TestAsyncSessionLocal() as db:
        user = User(
            id=user_id,
            email=test_email,
            password_hash="pwd_hash",
            full_name="Firebase Deletion Test",
            is_active=True,
        )
        db.add(user)
        await db.commit()

    async def as_test_user():
        async with TestAsyncSessionLocal() as session:
            return await session.get(User, user_id)

    app.dependency_overrides[get_current_user] = as_test_user

    mock_record = MagicMock()
    mock_record.uid = expected_uid

    with patch("firebase_admin.auth.get_user_by_email", return_value=mock_record) as mock_get_user, \
         patch("firebase_admin.auth.delete_user") as mock_del_user, \
         patch("firebase_admin._apps", [MagicMock()]):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver") as client:
            res = await client.delete("/api/v1/user/account")
            assert res.status_code == 200
            assert res.json()["status"] == "deleted"

        # Verify that get_user_by_email was called with the user's email
        mock_get_user.assert_called_once_with(test_email)
        # Verify that delete_user was called specifically with expected_uid
        mock_del_user.assert_called_once_with(expected_uid)


@pytest.mark.asyncio
async def test_firebase_account_deletion_uninitialized_and_not_found_safe():
    from unittest.mock import patch
    from firebase_admin import auth as fb_auth
    from app.core.firebase import delete_firebase_user

    # 1. When Firebase Admin is not initialized
    with patch("firebase_admin._apps", []):
        with patch("app.core.firebase.init_firebase"):
            # Should safely return True without raising in dev/test
            success = delete_firebase_user(email="nonexistent@example.com")
            assert success is True

    # 2. When user is not found in Firebase (UserNotFoundError)
    with patch("firebase_admin._apps", ["app"]):
        with patch("firebase_admin.auth.get_user_by_email", side_effect=fb_auth.UserNotFoundError("Not found")):
            success = delete_firebase_user(email="unknown@example.com")
            assert success is True


@pytest.mark.asyncio
async def test_firebase_deletion_failure_preserves_user_and_returns_502():
    """Verify that if Firebase Admin deletion fails, 502 is returned and user record is preserved for retry."""
    from unittest.mock import patch, MagicMock

    user_id = uuid.uuid4()
    test_email = f"fb_fail_{uuid.uuid4().hex[:6]}@example.com"

    async with TestAsyncSessionLocal() as db:
        user = User(
            id=user_id,
            email=test_email,
            password_hash="pwd_hash",
            full_name="Firebase Fail Test",
            is_active=True,
        )
        db.add(user)
        await db.commit()

    async def as_test_user():
        async with TestAsyncSessionLocal() as session:
            return await session.get(User, user_id)

    app.dependency_overrides[get_current_user] = as_test_user

    with patch("app.core.firebase.delete_firebase_user", side_effect=Exception("Firebase server unreachable")):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver") as client:
            res = await client.delete("/api/v1/user/account")
            # Must return 502, not claim success
            assert res.status_code == 502
            assert "FIREBASE_DELETION_FAILED" in res.text

    # User record must still be in DB so user can retry
    async with TestAsyncSessionLocal() as db:
        persisted = await db.get(User, user_id)
        assert persisted is not None


@pytest.mark.asyncio
async def test_deletion_with_multiple_jobs_and_no_assets():
    """Verify deletion works cleanly when user has multiple jobs or zero assets."""
    user_id = uuid.uuid4()
    garment_id = uuid.uuid4()

    async with TestAsyncSessionLocal() as db:
        user = User(id=user_id, email=f"multi_{uuid.uuid4().hex[:6]}@example.com", password_hash="pwd", is_active=True)
        db.add(user)
        garment = Garment(id=garment_id, product_name="Garment", images=[{"url": "https://example.com/g.jpg"}])
        db.add(garment)

        # 3 try-on jobs
        for _ in range(3):
            db.add(TryOnJob(id=uuid.uuid4(), user_id=user_id, garment_id=garment_id, status="completed", result_image_urls=["tryon_results/test.webp"]))
        await db.commit()

    async def as_test_user():
        async with TestAsyncSessionLocal() as session:
            return await session.get(User, user_id)

    app.dependency_overrides[get_current_user] = as_test_user

    from unittest.mock import patch
    with patch("app.core.firebase.delete_firebase_user", return_value=True):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver") as client:
            res = await client.delete("/api/v1/user/account")
            assert res.status_code == 200

    async with TestAsyncSessionLocal() as db:
        jobs = (await db.execute(TryOnJob.__table__.select().where(TryOnJob.user_id == user_id))).fetchall()
        assert len(jobs) == 0


@pytest.mark.asyncio
async def test_another_user_firebase_account_not_deleted():
    """Verify that deleting user A only passes user A's email/uid to Firebase Admin, never user B."""
    from unittest.mock import patch, MagicMock

    userA_id = uuid.uuid4()
    userB_id = uuid.uuid4()
    emailA = f"userA_{uuid.uuid4().hex[:6]}@example.com"
    emailB = f"userB_{uuid.uuid4().hex[:6]}@example.com"
    uidA = "firebase_uid_A"
    uidB = "firebase_uid_B"

    async with TestAsyncSessionLocal() as db:
        uA = User(id=userA_id, email=emailA, password_hash="pwd", is_active=True)
        uB = User(id=userB_id, email=emailB, password_hash="pwd", is_active=True)
        db.add_all([uA, uB])
        await db.commit()

    async def as_userA():
        async with TestAsyncSessionLocal() as session:
            return await session.get(User, userA_id)

    app.dependency_overrides[get_current_user] = as_userA

    mock_recA = MagicMock()
    mock_recA.uid = uidA

    with patch("firebase_admin.auth.get_user_by_email", return_value=mock_recA) as mock_get, \
         patch("firebase_admin.auth.delete_user") as mock_del, \
         patch("firebase_admin._apps", [MagicMock()]):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver") as client:
            res = await client.delete("/api/v1/user/account")
            assert res.status_code == 200

        # Verified user A's email is queried
        mock_get.assert_called_once_with(emailA)
        # Verified user A's UID is deleted
        mock_del.assert_called_once_with(uidA)
        # Confirmed user B's email and UID were NEVER passed to Firebase
        assert emailB not in [call.args[0] for call in mock_get.call_args_list]
        assert uidB not in [call.args[0] for call in mock_del.call_args_list]

    # Verify user B remains intact in DB
    async with TestAsyncSessionLocal() as db:
        userB_record = await db.get(User, userB_id)
        assert userB_record is not None



