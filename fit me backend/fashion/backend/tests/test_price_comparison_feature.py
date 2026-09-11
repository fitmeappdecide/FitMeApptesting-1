import uuid
from datetime import UTC, datetime, timedelta
import pytest
from httpx import ASGITransport, AsyncClient

from app.core import database as core_db
from app.core.auth_bridge import AuthUser, get_v2_auth_user
from app.api.deps import get_current_user
from app.main import app
from app.models.product_intelligence import PIScan
from app.models.user import User


@pytest.mark.asyncio
async def test_history_backward_compatibility_and_filters():
    test_user_id = "a1b2c3d4-e5f6-7890-abcd-ef1234567890"

    async with core_db.AsyncSessionLocal() as session:
        s1 = PIScan(
            scan_id=f"scan_proc_{uuid.uuid4().hex[:8]}",
            user_id=test_user_id,
            status="processing",
            created_at=datetime.now(UTC) - timedelta(hours=5),
        )
        s2 = PIScan(
            scan_id=f"scan_done1_{uuid.uuid4().hex[:8]}",
            user_id=test_user_id,
            status="done",
            best_price=1499.0,
            best_retailer="myntra",
            is_saved=False,
            last_price_checked_at=datetime.now(UTC) - timedelta(hours=2),
            candidates=[{"id": "c1", "retailer": "myntra", "price": 1499.0, "url": "https://myntra.com/123"}],
            created_at=datetime.now(UTC) - timedelta(hours=2),
        )
        s3 = PIScan(
            scan_id=f"scan_done2_{uuid.uuid4().hex[:8]}",
            user_id=test_user_id,
            status="done",
            best_price=999.0,
            best_retailer="amazon",
            is_saved=True,
            last_price_checked_at=datetime.now(UTC) - timedelta(hours=20),  # Stale (>12h)
            candidates=[{"id": "c2", "retailer": "amazon", "price": 999.0, "url": "https://amazon.in/123"}],
            created_at=datetime.now(UTC) - timedelta(hours=20),
        )
        session.add_all([s1, s2, s3])
        await session.commit()

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # 1. Plain /history (returns all 3)
        res_all = await client.get("/api/v1/product-intelligence/history")
        assert res_all.status_code == 200
        data_all = res_all.json()
        assert len(data_all) >= 3

        # 2. /history?status=done
        res_done = await client.get("/api/v1/product-intelligence/history?status=done")
        assert res_done.status_code == 200
        data_done = res_done.json()
        assert all(item["status"] == "done" for item in data_done)

        # Check freshness flags
        stale_item = next(i for i in data_done if i["scan_id"] == s3.scan_id)
        assert stale_item["is_price_stale"] is True
        fresh_item = next(i for i in data_done if i["scan_id"] == s2.scan_id)
        assert fresh_item["is_price_stale"] is False

        # 3. /history?saved_only=true
        res_saved = await client.get("/api/v1/product-intelligence/history?saved_only=true")
        assert res_saved.status_code == 200
        data_saved = res_saved.json()
        assert all(item["is_saved"] is True for item in data_saved)


@pytest.mark.asyncio
async def test_toggle_save():
    test_user_id = "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
    scan_id = f"scan_save_{uuid.uuid4().hex[:8]}"

    async with core_db.AsyncSessionLocal() as session:
        s = PIScan(
            scan_id=scan_id,
            user_id=test_user_id,
            status="done",
            is_saved=False,
            created_at=datetime.now(UTC),
        )
        session.add(s)
        await session.commit()

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # Toggle 1: False -> True
        res1 = await client.post(f"/api/v1/product-intelligence/scan/{scan_id}/toggle-save")
        assert res1.status_code == 200
        assert res1.json()["is_saved"] is True

        # Toggle 2: True -> False
        res2 = await client.post(f"/api/v1/product-intelligence/scan/{scan_id}/toggle-save")
        assert res2.status_code == 200
        assert res2.json()["is_saved"] is False


@pytest.mark.asyncio
async def test_refresh_prices_failure_preserves_price(monkeypatch):
    test_user_id = "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
    scan_id = f"scan_refr_{uuid.uuid4().hex[:8]}"

    initial_check_time = datetime.now(UTC) - timedelta(days=2)
    async with core_db.AsyncSessionLocal() as session:
        s = PIScan(
            scan_id=scan_id,
            user_id=test_user_id,
            status="done",
            best_price=2499.0,
            best_retailer="myntra",
            last_price_checked_at=initial_check_time,
            candidates=[
                {"id": "cand_1", "retailer": "myntra", "price": 2499.0, "original_price": 3499.0, "url": "https://myntra.com/123"},
                {"id": "cand_2", "retailer": "amazon", "price": 2799.0, "original_price": 3499.0, "url": "https://amazon.in/123"},
            ],
            created_at=initial_check_time,
        )
        session.add(s)
        await session.commit()

    # Simulate complete scraping failure
    from services.visual_search import searchapi_service
    async def mock_extract_fail(client, url, retailer):
        return (None, None, None)

    monkeypatch.setattr(searchapi_service, "extract_live_price", mock_extract_fail)

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        res = await client.post(f"/api/v1/product-intelligence/scan/{scan_id}/refresh-prices")
        assert res.status_code == 200
        body = res.json()

        # Check that prices were PRESERVED and NOT set to None
        assert body["candidates"][0]["price"] == 2499.0
        assert body["candidates"][1]["price"] == 2799.0
        assert body["candidates"][0]["price_status"] == "unverified"
        assert body["candidates"][1]["price_status"] == "unverified"
        assert body["best_price"] == 2499.0

        # Check partial/full failure metrics
        assert body["successful_refreshes"] == 0
        assert body["failed_refreshes"] == 2
        assert body["has_unverified_prices"] is True
        assert body["is_price_stale"] is True
        assert body["last_price_check_attempted_at"] is not None


@pytest.mark.asyncio
async def test_refresh_prices_success_updates_price(monkeypatch):
    test_user_id = "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
    scan_id = f"scan_succ_{uuid.uuid4().hex[:8]}"

    async with core_db.AsyncSessionLocal() as session:
        s = PIScan(
            scan_id=scan_id,
            user_id=test_user_id,
            status="done",
            best_price=2499.0,
            best_retailer="myntra",
            last_price_checked_at=datetime.now(UTC) - timedelta(days=2),
            candidates=[
                {"id": "cand_1", "retailer": "myntra", "price": 2499.0, "original_price": 3499.0, "url": "https://myntra.com/123"},
                {"id": "cand_2", "retailer": "amazon", "price": 2799.0, "original_price": 3499.0, "url": "https://amazon.in/123"},
            ],
            created_at=datetime.now(UTC) - timedelta(days=2),
        )
        session.add(s)
        await session.commit()

    # Simulate price drop on Amazon to 1999.0
    from services.visual_search import searchapi_service
    async def mock_extract_success(client, url, retailer):
        if retailer == "amazon":
            return (1999.0, 3499.0, 43)
        return (2499.0, 3499.0, 28)

    monkeypatch.setattr(searchapi_service, "extract_live_price", mock_extract_success)

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        res = await client.post(f"/api/v1/product-intelligence/scan/{scan_id}/refresh-prices")
        assert res.status_code == 200
        body = res.json()

        assert body["success"] is True
        assert body["successful_refreshes"] == 2
        assert body["failed_refreshes"] == 0
        assert body["has_unverified_prices"] is False
        assert body["is_price_stale"] is False

        # Amazon is now the new best price!
        assert body["best_price"] == 1999.0
        assert body["best_retailer"] == "amazon"
        assert body["last_price_checked_at"] is not None


@pytest.mark.asyncio
async def test_user_isolation_for_other_user():
    other_user_id = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"
    scan_id = f"scan_iso_{uuid.uuid4().hex[:8]}"

    async with core_db.AsyncSessionLocal() as session:
        s = PIScan(
            scan_id=scan_id,
            user_id=other_user_id,
            status="done",
            created_at=datetime.now(UTC),
        )
        session.add(s)
        await session.commit()

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # Current user (test_user_id) cannot see or modify other_user_id scan -> 404
        res_get = await client.get(f"/api/v1/product-intelligence/scan/{scan_id}")
        assert res_get.status_code == 404

        res_save = await client.post(f"/api/v1/product-intelligence/scan/{scan_id}/toggle-save")
        assert res_save.status_code == 404

        res_refr = await client.post(f"/api/v1/product-intelligence/scan/{scan_id}/refresh-prices")
        assert res_refr.status_code == 404


@pytest.mark.asyncio
async def test_clear_all_history_user_isolation():
    user_a_id = "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
    user_b_id = "user_b_other_9999-8888-7777-666655554444"

    scan_a1_id = f"scan_a1_{uuid.uuid4().hex[:8]}"
    scan_a2_id = f"scan_a2_{uuid.uuid4().hex[:8]}"
    scan_b1_id = f"scan_b1_{uuid.uuid4().hex[:8]}"

    async with core_db.AsyncSessionLocal() as session:
        # Create User A comparisons
        sa1 = PIScan(scan_id=scan_a1_id, user_id=user_a_id, status="done", created_at=datetime.now(UTC))
        sa2 = PIScan(scan_id=scan_a2_id, user_id=user_a_id, status="done", created_at=datetime.now(UTC))
        # Create User B comparison
        sb1 = PIScan(scan_id=scan_b1_id, user_id=user_b_id, status="done", created_at=datetime.now(UTC))
        session.add_all([sa1, sa2, sb1])
        await session.commit()

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # User A calls DELETE /history
        res_del = await client.delete("/api/v1/product-intelligence/history")
        assert res_del.status_code == 200
        del_data = res_del.json()
        assert del_data["success"] is True
        assert del_data["deleted"] >= 2

        # User A queries /history -> should be empty
        res_a_hist = await client.get("/api/v1/product-intelligence/history")
        assert res_a_hist.status_code == 200
        assert len(res_a_hist.json()) == 0

    # Verify User B scan was NOT deleted from database
    async with core_db.AsyncSessionLocal() as session:
        check_b = await session.get(PIScan, scan_b1_id)
        assert check_b is not None
        assert check_b.user_id == user_b_id
        assert check_b.status == "done"


@pytest.mark.asyncio
async def test_delete_individual_comparison_and_liked_isolation():
    user_a_id = "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
    user_b_id = "user_b_other_individual_test_4444"

    scan_liked_1 = f"scan_l1_{uuid.uuid4().hex[:8]}"
    scan_normal_2 = f"scan_n2_{uuid.uuid4().hex[:8]}"
    scan_other_3 = f"scan_o3_{uuid.uuid4().hex[:8]}"

    async with core_db.AsyncSessionLocal() as session:
        # User A has 1 liked scan and 1 unliked scan
        s1 = PIScan(scan_id=scan_liked_1, user_id=user_a_id, status="done", is_saved=True, created_at=datetime.now(UTC) - timedelta(hours=2))
        s2 = PIScan(scan_id=scan_normal_2, user_id=user_a_id, status="done", is_saved=False, created_at=datetime.now(UTC) - timedelta(hours=1))
        # User B has 1 scan
        s3 = PIScan(scan_id=scan_other_3, user_id=user_b_id, status="done", is_saved=True, created_at=datetime.now(UTC))
        session.add_all([s1, s2, s3])
        await session.commit()

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # 1. User A tries to delete User B scan -> returns deleted: 0
        res_del_b = await client.delete(f"/api/v1/product-intelligence/history/{scan_other_3}")
        assert res_del_b.status_code == 200
        assert res_del_b.json()["deleted"] == 0

        # Verify User B scan is still intact in DB
        async with core_db.AsyncSessionLocal() as session:
            check_b = await session.get(PIScan, scan_other_3)
            assert check_b is not None

        # 2. User A deletes scan_liked_1
        res_del_a = await client.delete(f"/api/v1/product-intelligence/history/{scan_liked_1}")
        assert res_del_a.status_code == 200
        assert res_del_a.json()["deleted"] == 1

        # 3. Verify scan_liked_1 is gone from both Compared (/history) and Liked (/history?saved_only=true)
        res_all = await client.get("/api/v1/product-intelligence/history")
        all_ids = [item["scan_id"] for item in res_all.json()]
        assert scan_liked_1 not in all_ids
        assert scan_normal_2 in all_ids

        res_liked = await client.get("/api/v1/product-intelligence/history?saved_only=true")
        liked_ids = [item["scan_id"] for item in res_liked.json()]
        assert scan_liked_1 not in liked_ids
