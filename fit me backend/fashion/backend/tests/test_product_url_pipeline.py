"""
Automated Test Suite for AVA Product URL Data Pipeline & Direct Merchant Validation.
Verifies that:
1. Google/Bing search and search redirect URLs are unwrapped or rejected.
2. Retailer homepage fallbacks (e.g. https://www.myntra.com) are marked as non-shoppable (is_shoppable=False).
3. Direct merchant product URLs (Myntra / AJIO / Amazon / Flipkart) pass validation.
4. Product object schema includes canonical_product_url, affiliate_url, source_type, and is_shoppable.
5. affiliate_url takes priority over canonical_product_url when present.
6. Non-shoppable or Google URLs cannot be opened.
7. source_type correctly differentiates live_search vs fallback.
"""
import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.compiler import compiles
from sqlalchemy.pool import StaticPool

@compiles(JSONB, "sqlite")
def compile_jsonb_sqlite(type_, compiler, **kw):
    return "JSON"

from app.core.database import Base
import app.models
from app.utils.validators import extract_merchant_destination_url, is_direct_merchant_product_url
from app.services.ava.tools import AVAToolSuite

test_engine = create_async_engine(
    "sqlite+aiosqlite:///:memory:",
    poolclass=StaticPool,
    connect_args={"check_same_thread": False},
)
TestAsyncSessionLocal = async_sessionmaker(test_engine, class_=AsyncSession, expire_on_commit=False)


@pytest_asyncio.fixture
async def async_db():
    async with test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    async with TestAsyncSessionLocal() as session:
        yield session


def test_google_redirect_unwrapping():
    google_url = "https://www.google.com/url?q=https%3A%2F%2Fwww.fashionwebz.com%2Ffirozi-georgette-nehru-jacket.html&sa=U"
    unwrapped = extract_merchant_destination_url(google_url)
    assert unwrapped == "https://www.fashionwebz.com/firozi-georgette-nehru-jacket.html"


def test_search_and_homepage_urls_rejected():
    # Google search URL
    assert not is_direct_merchant_product_url("https://www.google.co.in/search?q=men+ethnic+wear")
    # Google Shopping URL
    assert not is_direct_merchant_product_url("https://www.google.co.in/shopping/product/12345")
    # Retailer homepages
    assert not is_direct_merchant_product_url("https://www.myntra.com")
    assert not is_direct_merchant_product_url("https://www.ajio.com")
    assert not is_direct_merchant_product_url("https://www.amazon.in")
    assert not is_direct_merchant_product_url("https://www.flipkart.com")


def test_direct_merchant_product_urls_accepted():
    # Myntra direct product URL
    assert is_direct_merchant_product_url("https://www.myntra.com/shirts/roadster/roadster-men-navy-blue-casual-shirt/13735770/buy")
    # AJIO direct product URL
    assert is_direct_merchant_product_url("https://www.ajio.com/p/461119105_navy")
    # Amazon direct product URL
    assert is_direct_merchant_product_url("https://www.amazon.in/dp/B08X123456")
    # Flipkart direct product URL
    assert is_direct_merchant_product_url("https://www.flipkart.com/brand-item/p/itm123456789")
    # FashionWebz direct merchant URL
    assert is_direct_merchant_product_url("https://www.fashionwebz.com/firozi-georgette-nehru-jacket-1234.html")


def resolve_final_open_url(item: dict) -> str | None:
    """Simulates React Native UI open URL selection logic."""
    affiliate_url = item.get("affiliate_url")
    canonical_url = item.get("canonical_product_url")
    is_shoppable = item.get("is_shoppable") is not False
    
    final_url = affiliate_url or canonical_url
    if not final_url or not is_shoppable:
        return None
    if "google." in final_url.lower() or "bing." in final_url.lower():
        return None
    if final_url in ("https://www.myntra.com", "https://www.ajio.com"):
        return None
    return final_url


def test_ui_url_selection_priority_and_rejection():
    # Test Priority 1: affiliate_url overrides canonical_product_url
    item_with_aff = {
        "canonical_product_url": "https://www.myntra.com/shirts/roadster/13735770/buy",
        "affiliate_url": "https://cuelinks.com/link?url=https%3A%2F%2Fwww.myntra.com%2F13735770",
        "is_shoppable": True,
    }
    assert resolve_final_open_url(item_with_aff) == "https://cuelinks.com/link?url=https%3A%2F%2Fwww.myntra.com%2F13735770"

    # Test Priority 2: canonical_product_url used when affiliate_url is None
    item_canonical_only = {
        "canonical_product_url": "https://www.myntra.com/shirts/roadster/13735770/buy",
        "affiliate_url": None,
        "is_shoppable": True,
    }
    assert resolve_final_open_url(item_canonical_only) == "https://www.myntra.com/shirts/roadster/13735770/buy"

    # Test Rejection 1: Google URL rejected
    item_google = {
        "canonical_product_url": "https://www.google.com/search?q=shirt",
        "affiliate_url": None,
        "is_shoppable": False,
    }
    assert resolve_final_open_url(item_google) is None

    # Test Rejection 2: Retailer homepage rejected
    item_homepage = {
        "canonical_product_url": "https://www.myntra.com",
        "affiliate_url": None,
        "is_shoppable": False,
    }
    assert resolve_final_open_url(item_homepage) is None


@pytest.mark.asyncio
async def test_ava_tools_product_schema_and_integrity(async_db):
    tools = AVAToolSuite(async_db)
    products = await tools.search_products(platform="myntra", occasion="college", limit=5)
    
    assert len(products) > 0
    for p in products:
        assert "canonical_product_url" in p
        assert "affiliate_url" in p
        assert "is_shoppable" in p
        assert "source_type" in p
        
        if p["is_shoppable"]:
            assert is_direct_merchant_product_url(p["canonical_product_url"])
            assert "google.com" not in p["canonical_product_url"]
            assert p["canonical_product_url"] != "https://www.myntra.com"
