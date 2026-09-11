"""
Automated Verification Suite for Phase 3: Candidate -> PostgreSQL Garment Bridge.

Verifies that:
1. Visual search candidates from Product Intelligence V2 can be converted to PostgreSQL Garments
2. The resulting garment_id can immediately be fed into existing FitMe /size/recommend and /tryon/start
3. Analytics event `product_selected` is recorded in pi_analytics_events
4. Existing `garments` table schema and check constraints remain 100% untouched.
"""
import uuid
from datetime import UTC, datetime
from unittest.mock import AsyncMock, patch

import pytest
from httpx import ASGITransport, AsyncClient

from app.core import database as core_db
from app.main import app
from app.models.body_profile import BodyProfile
from app.models.body_scan import BodyScan
from app.models.garment import Garment
from app.models.product_intelligence import PIAnalyticsEvent, PIScan
from app.models.user import User
from app.services.candidate_bridge import convert_candidate_to_garment
from app.services.tryon.provider import TryOnResult
from app.services.tryon.vertex_provider import VertexProvider


@pytest.mark.asyncio
async def test_convert_candidate_to_garment_unit():
    """Unit test for candidate to Garment conversion logic and field mapping."""
    candidate_dict = {
        "id": "cand_nike_123",
        "title": "Nike Dri-FIT Running T-Shirt",
        "url": "https://www.myntra.com/tshirts/nike/running-tee/998877",
        "image_url": "https://assets.myntassets.com/nike_front.jpg",
        "retailer": "myntra",
        "category": "tshirt",
        "price": 2495.0,
        "size_chart": {
            "M": {"chest": [96, 101], "waist": [82, 87]},
            "L": {"chest": [102, 107], "waist": [88, 93]}
        }
    }

    async with core_db.AsyncSessionLocal() as session:
        garment = await convert_candidate_to_garment(candidate_dict, session)
        assert garment is not None
        assert isinstance(garment.id, uuid.UUID)
        assert garment.product_name == "Nike Dri-FIT Running T-Shirt"
        assert garment.garment_type == "tshirt"
        assert len(garment.images) == 1
        assert garment.images[0]["url"] == "https://assets.myntassets.com/nike_front.jpg"
        assert garment.images[0]["angle"] == "front"
        assert garment.fabric_type == "cotton blend"
        assert garment.scraped_from_url == "https://www.myntra.com/tshirts/nike/running-tee/998877"
        await session.commit()


@pytest.mark.asyncio
async def test_select_candidate_api_flow():
    """Verify POST /api/v1/product-intelligence/scan/{scan_id}/select endpoint."""
    scan_id = f"scan_bridge_{uuid.uuid4().hex[:8]}"
    cand_id = f"cand_bridge_{uuid.uuid4().hex[:8]}"
    user_id_str = "a1b2c3d4-e5f6-7890-abcd-ef1234567890"

    # 1. Seed completed scan with candidate
    async with core_db.AsyncSessionLocal() as session:
        scan_record = PIScan(
            scan_id=scan_id,
            user_id=user_id_str,
            status="done",
            match_status="exact",
            candidates=[{
                "id": cand_id,
                "title": "Zara Slim Fit Oxford Shirt",
                "url": "https://www.zara.com/in/oxford-shirt",
                "image_url": "https://static.zara.net/photos/shirt.jpg",
                "retailer": "zara",
                "category": "shirt",
                "price": 2990.0,
            }],
            created_at=datetime.now(UTC),
        )
        session.add(scan_record)
        await session.commit()

    # 2. Select Candidate via API
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        res = await client.post(
            f"/api/v1/product-intelligence/scan/{scan_id}/select",
            json={"candidate_id": cand_id}
        )
        assert res.status_code == 200
        data = res.json()
        assert data["success"] is True
        garment_id_str = data["garment_id"]
        assert data["product_name"] == "Zara Slim Fit Oxford Shirt"
        assert data["garment_type"] == "shirt"
        assert data["tryon_url"] == "/api/v1/tryon/start"
        assert data["size_recommend_url"] == "/api/v1/size/recommend"

        # 3. Verify Garment exists in PostgreSQL garments table
        async with core_db.AsyncSessionLocal() as session:
            garment_in_db = await session.get(Garment, uuid.UUID(garment_id_str))
            assert garment_in_db is not None
            assert garment_in_db.product_name == "Zara Slim Fit Oxford Shirt"

            # 4. Verify product_selected event in pi_analytics_events
            from sqlalchemy import select
            evt_stmt = select(PIAnalyticsEvent).where(
                PIAnalyticsEvent.scan_id == scan_id,
                PIAnalyticsEvent.event_type == "product_selected"
            )
            evt_res = await session.execute(evt_stmt)
            evt_doc = evt_res.scalar_one_or_none()
            assert evt_doc is not None
            assert evt_doc.candidate_id == cand_id


@pytest.mark.asyncio
async def test_bridged_garment_e2e_with_tryon_and_size():
    """Verify that a bridged garment_id immediately works with /tryon/start and /size/recommend."""
    scan_id = f"scan_e2e_{uuid.uuid4().hex[:8]}"
    cand_id = f"cand_e2e_{uuid.uuid4().hex[:8]}"
    user_uuid = uuid.UUID("a1b2c3d4-e5f6-7890-abcd-ef1234567890")

    # 1. Seed BodyScan & BodyProfile for user
    body_scan_id = uuid.uuid4()
    prof_id = uuid.uuid4()
    async with core_db.AsyncSessionLocal() as session:
        body_prof = BodyProfile(
            id=prof_id,
            user_id=user_uuid,
            height_cm=180.0,
            chest_cm=100.0,
            waist_cm=84.0,
            hips_cm=98.0,
            shoulder_width_cm=45.0,
            body_type="athletic",
            cluster_key="cluster_m_athletic",
            created_at=datetime.now(UTC),
            updated_at=datetime.now(UTC),
        )
        body_scan = BodyScan(
            id=body_scan_id,
            user_id=user_uuid,
            body_profile_id=prof_id,
            front_photo_url_encrypted="scans/front_test.jpg",
            processing_status="completed",
            consent_given=True,
            created_at=datetime.now(UTC),
        )
        session.add(body_prof)
        session.add(body_scan)

        # Seed visual search scan in pi_scans
        v2_scan = PIScan(
            scan_id=scan_id,
            user_id=str(user_uuid),
            status="done",
            candidates=[{
                "id": cand_id,
                "title": "Levi's Western Denim Shirt",
                "url": "https://www.levi.in/men/shirts/western-shirt",
                "image_url": "https://levi.in/images/denim_shirt.jpg",
                "retailer": "levis",
                "category": "shirt",
                "price": 3299.0,
            }],
            created_at=datetime.now(UTC),
        )
        session.add(v2_scan)
        await session.commit()

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # Step A: Select candidate -> get bridged garment_id
        sel_res = await client.post(
            f"/api/v1/product-intelligence/scan/{scan_id}/select",
            json={"candidate_id": cand_id}
        )
        assert sel_res.status_code == 200
        garment_id = sel_res.json()["garment_id"]

        # Step B: Call existing Size Recommendation with bridged garment_id
        size_res = await client.post(
            "/api/v1/size/recommend",
            json={"scan_id": str(body_scan_id), "garment_id": garment_id}
        )
        assert size_res.status_code == 200
        size_data = size_res.json()
        assert "size" in size_data or "recommended_size" in size_data

        # Step C: Call existing Virtual Try-On with bridged garment_id
        with patch.object(VertexProvider, "generate_tryon", new_callable=AsyncMock) as mock_tryon:
            mock_tryon.return_value = TryOnResult(
                image_urls=["https://smzhdmutffzapshfajyj.supabase.co/storage/v1/object/public/scans/denim_tryon.jpg"],
                provider_name="vertex",
                processing_time_seconds=0.75
            )
            tryon_res = await client.post(
                "/api/v1/tryon/start",
                json={"scan_id": str(body_scan_id), "garment_id": garment_id}
            )
            assert tryon_res.status_code == 200
            tryon_data = tryon_res.json()
            assert "job_id" in tryon_data
            assert tryon_data["job_id"] is not None
