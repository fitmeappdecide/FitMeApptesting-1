import pytest
import uuid
from httpx import ASGITransport, AsyncClient
from app.main import app
from app.api.deps import get_current_user
import app.core.database as core_db
import os
import sys
sys.path.insert(0, os.path.dirname(__file__))
from conftest import TestAsyncSessionLocal, test_engine
from app.core.database import Base
from app.models.user import User
from app.models.ava import AVAConversation, AVAMessage


@pytest.mark.asyncio
async def test_ava_auth_and_ownership():
    async with test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    user1_id = uuid.uuid4()
    user2_id = uuid.uuid4()

    async with TestAsyncSessionLocal() as db:
        u1 = User(id=user1_id, email=f"u1_{uuid.uuid4().hex[:6]}@example.com", password_hash="h1", full_name="User One")
        u2 = User(id=user2_id, email=f"u2_{uuid.uuid4().hex[:6]}@example.com", password_hash="h2", full_name="User Two")
        db.add_all([u1, u2])

        conv1 = AVAConversation(id=uuid.uuid4(), user_id=user1_id, title="User1 Conversation")
        conv2 = AVAConversation(id=uuid.uuid4(), user_id=user2_id, title="User2 Conversation")
        db.add_all([conv1, conv2])

        msg1 = AVAMessage(id=uuid.uuid4(), conversation_id=conv1.id, sender="user", text_content="Hello from User 1")
        msg2 = AVAMessage(id=uuid.uuid4(), conversation_id=conv2.id, sender="user", text_content="Hello from User 2")
        db.add_all([msg1, msg2])
        await db.commit()

        conv1_id = str(conv1.id)
        conv2_id = str(conv2.id)

    async def mock_get_db():
        async with TestAsyncSessionLocal() as session:
            yield session

    app.dependency_overrides[core_db.get_db] = mock_get_db

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver") as client:
        # 1. Unauthenticated request:
        # Override get_current_user to simulate unauthenticated (remove override to use real deps which raises 401 without Bearer)
        app.dependency_overrides.pop(get_current_user, None)
        
        res_no_auth_list = await client.get("/api/v1/ava/conversations")
        assert res_no_auth_list.status_code == 401

        res_no_auth_msg = await client.get(f"/api/v1/ava/conversations/{conv1_id}/messages")
        assert res_no_auth_msg.status_code == 401

        res_no_auth_del = await client.delete(f"/api/v1/ava/conversations/{conv1_id}")
        assert res_no_auth_del.status_code in (401, 403)

        # 2. Simulate User 1:
        async def as_user1():
            async with TestAsyncSessionLocal() as session:
                return await session.get(User, user1_id)
        app.dependency_overrides[get_current_user] = as_user1

        res_u1_list = await client.get("/api/v1/ava/conversations")
        assert res_u1_list.status_code == 200
        ids = [c["id"] for c in res_u1_list.json()]
        assert conv1_id in ids
        assert conv2_id not in ids

        res_u1_msg = await client.get(f"/api/v1/ava/conversations/{conv1_id}/messages")
        assert res_u1_msg.status_code == 200
        assert res_u1_msg.json()["conversation_id"] == conv1_id

        # 3. Simulate User 2 (accessing User 1's conversation):
        async def as_user2():
            async with TestAsyncSessionLocal() as session:
                return await session.get(User, user2_id)
        app.dependency_overrides[get_current_user] = as_user2

        res_u2_on_u1 = await client.get(f"/api/v1/ava/conversations/{conv1_id}/messages")
        assert res_u2_on_u1.status_code == 403

        res_u2_del_u1 = await client.delete(f"/api/v1/ava/conversations/{conv1_id}")
        assert res_u2_del_u1.status_code == 403

        # 4. User 1 deleting own conversation:
        app.dependency_overrides[get_current_user] = as_user1
        res_u1_del = await client.delete(f"/api/v1/ava/conversations/{conv1_id}")
        assert res_u1_del.status_code == 200
        assert res_u1_del.json()["success"] is True

        # 5. Accessing deleted conversation returns 404:
        res_u1_re_get = await client.get(f"/api/v1/ava/conversations/{conv1_id}/messages")
        assert res_u1_re_get.status_code == 404

        # 6. Preferences Authentication & Account Isolation Test:
        # Unauthenticated request to /preferences returns 401:
        app.dependency_overrides.pop(get_current_user, None)
        res_unauth_pref = await client.get("/api/v1/ava/preferences")
        assert res_unauth_pref.status_code == 401

        # User 1 starts with empty preferences:
        app.dependency_overrides[get_current_user] = as_user1
        res_u1_pref = await client.get("/api/v1/ava/preferences")
        assert res_u1_pref.status_code == 200
        assert res_u1_pref.json()["preferred_fits"] == []
        assert res_u1_pref.json()["preferred_colors"] == []

        # User 1 saves their preferences:
        res_u1_put = await client.put("/api/v1/ava/preferences", json={
            "preferred_fits": ["oversized"],
            "preferred_colors": ["olive"],
        })
        assert res_u1_put.status_code == 200
        assert res_u1_put.json()["preferences"]["preferred_fits"] == ["oversized"]

        # User 2 logs in: must NOT see User 1's preferences!
        app.dependency_overrides[get_current_user] = as_user2
        res_u2_pref = await client.get("/api/v1/ava/preferences")
        assert res_u2_pref.status_code == 200
        assert res_u2_pref.json()["preferred_fits"] == []
        assert res_u2_pref.json()["preferred_colors"] == []
        assert "oversized" not in res_u2_pref.json()["preferred_fits"]
        assert "olive" not in res_u2_pref.json()["preferred_colors"]

        # User 2 saves completely different preferences:
        res_u2_put = await client.put("/api/v1/ava/preferences", json={
            "preferred_fits": ["tailored"],
            "preferred_colors": ["burgundy"],
        })
        assert res_u2_put.status_code == 200
        assert res_u2_put.json()["preferences"]["preferred_fits"] == ["tailored"]

        # Switch back to User 1: User 1 still has their own preferences intact:
        app.dependency_overrides[get_current_user] = as_user1
        res_u1_check = await client.get("/api/v1/ava/preferences")
        assert res_u1_check.status_code == 200
        assert res_u1_check.json()["preferred_fits"] == ["oversized"]
        assert res_u1_check.json()["preferred_colors"] == ["olive"]
        assert "tailored" not in res_u1_check.json()["preferred_fits"]
