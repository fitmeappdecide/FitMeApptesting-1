import time
import uuid
import random
from datetime import datetime, timezone
import pytest
from unittest.mock import AsyncMock, patch
from sqlalchemy import select

from app.core import database as core_db
from app.api.product import (
    from_url,
    lookup_known_product,
    from_extension,
    get_canonical_product_identity,
    _lookup_existing_garment,
)
from app.models.garment import Garment
from app.models.user import User
from app.models.user_saved_photo import UserSavedPhoto
from app.models.tryon_job import TryOnJob
from app.schemas.product import (
    ProductFromUrlRequest,
    LookupKnownProductRequest,
    ProductFromExtensionRequest,
)
from app.schemas.tryon import TryOnStartRequest
from app.api.tryon import start_tryon


@pytest.mark.asyncio
async def test_known_product_with_verified_metadata_hits_fast_path():
    """Test 1: Known product with verified metadata returns found=True, matching Garment ID, verified brand and price."""
    known_url = "https://www.myntra.com/kurta-sets/moda+rapido/moda-rapido-printed-regular-thread-work-chanderi-cotton-kurta-with-trousers--dupatta/39572528/buy"
    
    async with core_db.AsyncSessionLocal() as session:
        garment_id = uuid.UUID("bc7e183a-cefc-41ee-bf27-7e18e8045cf5")
        garment = await session.get(Garment, garment_id)
        if not garment:
            garment = Garment(
                id=garment_id,
                product_name="Moda Rapido Printed Regular Thread Work Chanderi Cotton Kurta",
                product_url=known_url,
                scraped_from_url=known_url,
                images=[{"url": "https://assets.myntassets.com/test1.jpg", "angle": "front"}],
                garment_type="kurta",
                segmentation_masks={
                    "extracted_metadata": {
                        "brand": "Moda Rapido",
                        "price": "1499",
                        "platform": "myntra",
                        "source": "native_extraction",
                    }
                },
            )
            session.add(garment)
            await session.commit()
        else:
            current_masks = dict(garment.segmentation_masks or {})
            current_masks["extracted_metadata"] = {
                "brand": "Moda Rapido",
                "price": "1499",
                "platform": "myntra",
                "source": "native_extraction",
            }
            garment.segmentation_masks = current_masks
            await session.commit()

        req = LookupKnownProductRequest(url=known_url)
        resp = await lookup_known_product(req, db=session)

        assert resp.found is True
        assert resp.product_id == garment_id
        assert resp.product["title"] == garment.product_name
        assert resp.product["brand"] == "Moda Rapido"
        assert resp.product["price"] == "1499"
        assert resp.product["platform"] == "myntra"
        assert len(resp.product["images"]) > 0


@pytest.mark.asyncio
async def test_known_product_with_tracking_params_resolves_canonical_identity():
    """Test 2: Same product with altered tracking parameters hits fast path."""
    url_with_tracking = "https://www.myntra.com/kurta-sets/moda+rapido/moda-rapido-printed-regular-thread-work-chanderi-cotton-kurta-with-trousers--dupatta/39572528/buy?utm_source=facebook&utm_medium=cpc&gclid=123456"
    
    async with core_db.AsyncSessionLocal() as session:
        garment_id = uuid.UUID("bc7e183a-cefc-41ee-bf27-7e18e8045cf5")
        req = LookupKnownProductRequest(url=url_with_tracking)
        resp = await lookup_known_product(req, db=session)

        assert resp.found is True
        assert resp.product_id == garment_id
        assert resp.product["brand"] == "Moda Rapido"


@pytest.mark.asyncio
async def test_unknown_product_returns_found_false_instantly():
    """Test 3: Genuinely new unknown product returns found=False without calling scraper."""
    rand_style = str(random.randint(50000000, 99999999))
    unknown_url = f"https://www.myntra.com/shirts/newbrand/unknown-casual-shirt/{rand_style}/buy"
    
    async with core_db.AsyncSessionLocal() as session:
        req = LookupKnownProductRequest(url=unknown_url)
        resp = await lookup_known_product(req, db=session)

        assert resp.found is False
        assert resp.product_id is None


@pytest.mark.asyncio
async def test_incomplete_metadata_returns_found_false():
    """Test 4: Garment with missing brand or price returns found=False (must not fabricate)."""
    rand_style = str(random.randint(50000000, 99999999))
    incomplete_url = f"https://www.myntra.com/test/incomplete-item/{rand_style}/buy"
    
    async with core_db.AsyncSessionLocal() as session:
        incomplete_garment = Garment(
            id=uuid.uuid4(),
            product_name="Incomplete Fashion Item",
            product_url=incomplete_url,
            scraped_from_url=incomplete_url,
            images=[{"url": "https://assets.myntassets.com/test.jpg", "angle": "front"}],
            garment_type="shirt",
            segmentation_masks={},  # No extracted_metadata
        )
        session.add(incomplete_garment)
        await session.commit()

        req = LookupKnownProductRequest(url=incomplete_url)
        resp = await lookup_known_product(req, db=session)

        # Must be treated as cache miss
        assert resp.found is False


@pytest.mark.asyncio
async def test_from_extension_safely_attaches_extracted_metadata():
    """Test 5: Registering product from native extraction attaches verified metadata non-destructively."""
    rand_style = str(random.randint(50000000, 99999999))
    test_url = f"https://www.myntra.com/dresses/brand/dress/{rand_style}/buy"
    
    async with core_db.AsyncSessionLocal() as session:
        ext_req = ProductFromExtensionRequest(
            title="Elegant Summer Floral Dress",
            brand="Zara",
            price="2990",
            images=["https://assets.myntassets.com/dress1.jpg"],
            source_url=test_url,
            platform="myntra",
        )
        resp_ext = await from_extension(ext_req, db=session)
        assert resp_ext.product_id is not None

        # Now lookup_known should immediately find it with verified metadata
        lookup_req = LookupKnownProductRequest(url=test_url)
        lookup_resp = await lookup_known_product(lookup_req, db=session)

        assert lookup_resp.found is True
        assert lookup_resp.product["brand"] == "Zara"
        assert lookup_resp.product["price"] == "2990"
        assert lookup_resp.product["title"] == "Elegant Summer Floral Dress"


@pytest.mark.asyncio
async def test_exact_duplicate_tryon_cache_after_fast_path():
    """Test 6: Known product + same saved user photo hits exact Try-On cache."""
    known_url = "https://www.myntra.com/kurta-sets/moda+rapido/moda-rapido-printed-regular-thread-work-chanderi-cotton-kurta-with-trousers--dupatta/39572528/buy"
    user_id = uuid.UUID("f1f16e02-d3bf-4580-8b73-63467340c223")
    garment_id = uuid.UUID("bc7e183a-cefc-41ee-bf27-7e18e8045cf5")
    photo_id = uuid.UUID("67219ed1-a91a-4a58-ba11-f7bb5f2356ab")

    async with core_db.AsyncSessionLocal() as session:
        user = await session.get(User, user_id)
        if not user:
            from datetime import timezone
            user = User(
                id=user_id,
                email="test_cache_user@fitme.ai",
                password_hash="mock",
                full_name="Cache User",
                is_active=True,
                created_at=datetime.now(timezone.utc),
            )
            session.add(user)
            await session.commit()

        photo = await session.get(UserSavedPhoto, photo_id)
        if not photo:
            from datetime import timezone
            photo = UserSavedPhoto(
                id=photo_id,
                user_id=user_id,
                storage_path="user_photos/photo123.jpg",
                display_name="My Test Photo",
                mime_type="image/jpeg",
                created_at=datetime.now(timezone.utc),
            )
            session.add(photo)
            await session.commit()

        # Ensure completed job exists in test db for exact match
        existing_job = await session.get(TryOnJob, uuid.UUID("21ad1471-6b30-4d79-ade3-94f246eedc7d"))
        if not existing_job:
            from datetime import timezone
            existing_job = TryOnJob(
                id=uuid.UUID("21ad1471-6b30-4d79-ade3-94f246eedc7d"),
                user_id=user_id,
                garment_id=garment_id,
                saved_photo_id=photo_id,
                status="completed",
                result_image_urls=["https://assets.fitme.ai/results/123.jpg"],
                created_at=datetime.now(timezone.utc),
            )
            session.add(existing_job)
            await session.commit()

        # 1. Lookup known product
        req_lookup = LookupKnownProductRequest(url=known_url)
        resp_lookup = await lookup_known_product(req_lookup, db=session)
        assert resp_lookup.found is True
        assert resp_lookup.product_id == garment_id

        # 2. Start Try-On with exact matching photo
        req_tryon = TryOnStartRequest(
            garment_id=resp_lookup.product_id,
            saved_photo_id=photo_id,
        )
        resp_tryon = await start_tryon(req_tryon, user=user, db=session)

        assert resp_tryon.cache_tier == "exact"
        assert resp_tryon.estimated_seconds == 1
        assert resp_tryon.job_id == uuid.UUID("21ad1471-6b30-4d79-ade3-94f246eedc7d")


@pytest.mark.asyncio
async def test_failed_first_extraction_with_empty_images_is_not_treated_as_cached_product():
    """Test 7: A failed first extraction with empty images [] is NOT treated as a cached product."""
    rand_style = str(random.randint(50000000, 99999999))
    failed_url = f"https://www.myntra.com/kurtas/brand/failed-kurta/{rand_style}/buy"

    async with core_db.AsyncSessionLocal() as session:
        # Create a failed record simulating a failed first scrape
        failed_garment = Garment(
            id=uuid.uuid4(),
            product_name="Scraped fashion product",
            product_url=failed_url,
            scraped_from_url=failed_url,
            images=[],  # Failed extraction with zero images
            garment_type="kurta",
            segmentation_masks={},
        )
        session.add(failed_garment)
        await session.commit()

        # 1. Lookup must NOT find the failed product
        lookup_req = LookupKnownProductRequest(url=failed_url)
        lookup_resp = await lookup_known_product(lookup_req, db=session)
        assert lookup_resp.found is False
        assert lookup_resp.product_id is None

        # 2. _lookup_existing_garment with default require_valid=True must return None
        existing = await _lookup_existing_garment(session, failed_url, failed_url, "myntra", rand_style)
        assert existing is None


@pytest.mark.asyncio
async def test_failed_first_extraction_heals_when_second_user_extracts_actual_data():
    """Test 8: When second user extracts actual product data, the failed record is healed with real details."""
    rand_style = str(random.randint(50000000, 99999999))
    product_url = f"https://www.myntra.com/ethnic-wear/anouk/anouk-kurta/{rand_style}/buy"

    async with core_db.AsyncSessionLocal() as session:
        # 1. User 1 had a failed extraction
        failed_garment = Garment(
            id=uuid.uuid4(),
            product_name="Scraped fashion product",
            product_url=product_url,
            scraped_from_url=product_url,
            images=[],  # Empty images
            garment_type="kurta",
            segmentation_masks={},
        )
        session.add(failed_garment)
        await session.commit()

        # 2. User 2 extracts the same URL with actual product data
        ext_req = ProductFromExtensionRequest(
            title="Anouk Women Embroidered Straight Kurta",
            brand="Anouk",
            price="899",
            images=["https://assets.myntassets.com/anouk_kurta_hd.jpg"],
            source_url=product_url,
            platform="myntra",
        )
        resp_ext = await from_extension(ext_req, db=session)
        assert resp_ext.product_id is not None
        assert resp_ext.product["title"] == "Anouk Women Embroidered Straight Kurta"
        assert resp_ext.product["brand"] == "Anouk"
        assert resp_ext.product["price"] == "899"

        # 3. User 3 (or any subsequent user) now instantly gets the healed, complete product
        lookup_req = LookupKnownProductRequest(url=product_url)
        lookup_resp = await lookup_known_product(lookup_req, db=session)

        assert lookup_resp.found is True
        assert lookup_resp.product_id == failed_garment.id
        assert lookup_resp.product["title"] == "Anouk Women Embroidered Straight Kurta"
        assert lookup_resp.product["brand"] == "Anouk"
        assert lookup_resp.product["price"] == "899"
        assert lookup_resp.product["image_url"] == "https://assets.myntassets.com/anouk_kurta_hd.jpg"


@pytest.mark.asyncio
async def test_blocked_anti_bot_title_is_not_treated_as_cached_product():
    """Test 9: A garment with blocked anti-bot title ('Access Denied') is rejected from cache."""
    rand_style = str(random.randint(50000000, 99999999))
    blocked_url = f"https://www.myntra.com/tops/brand/blocked-top/{rand_style}/buy"

    async with core_db.AsyncSessionLocal() as session:
        blocked_garment = Garment(
            id=uuid.uuid4(),
            product_name="Access Denied - 403 Forbidden",
            product_url=blocked_url,
            scraped_from_url=blocked_url,
            images=[{"url": "https://example.com/logo.jpg", "angle": "front"}],
            garment_type="shirt",
            segmentation_masks={"extracted_metadata": {"brand": "Test", "price": "999"}},
        )
        session.add(blocked_garment)
        await session.commit()

        lookup_req = LookupKnownProductRequest(url=blocked_url)
        lookup_resp = await lookup_known_product(lookup_req, db=session)
        assert lookup_resp.found is False

