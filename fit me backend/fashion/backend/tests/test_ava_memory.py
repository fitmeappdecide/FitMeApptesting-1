"""
Unit tests for AVA Persistent Style Memory & Style DNA Profile.
"""
import pytest
import pytest_asyncio
import uuid
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.compiler import compiles
from sqlalchemy.pool import StaticPool

@compiles(JSONB, "sqlite")
def compile_jsonb_sqlite(type_, compiler, **kw):
    return "JSON"

from app.core.database import Base
import app.models
from app.models.ava import AVAPreference
from app.services.ava.memory import AVAMemoryManager

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


def test_format_style_dna_for_prompt():
    pref = AVAPreference(
        preferred_fits=["oversized", "baggy"],
        preferred_colors=["olive", "black"],
        disliked_colors=["yellow"],
        disliked_items=["polyester", "crop tops"],
        favorite_brands=["Zara", "Uniqlo"],
        favorite_retailers=["Myntra"],
        budget_range_max=5000.0,
        style_dna={"streetwear": 0.9, "minimal": 0.8},
    )
    body_prof = {
        "silhouette_profile": {"body_shape": "athletic"},
        "color_season": {"season": "Autumn"},
    }

    prompt_summary = AVAMemoryManager.format_style_dna_for_prompt(pref, body_prof)
    assert "USER STYLE DNA & PERSISTENT MEMORY" in prompt_summary
    assert "oversized" in prompt_summary
    assert "olive" in prompt_summary
    assert "yellow" in prompt_summary
    assert "polyester" in prompt_summary
    assert "Zara" in prompt_summary
    assert "₹5,000" in prompt_summary
    assert "Streetwear" in prompt_summary
    assert "Autumn" in prompt_summary
    # Ensure it is ultra-compact (~25-60 words / ~35-50 tokens)
    assert len(prompt_summary.split()) < 85


@pytest.mark.asyncio
async def test_extract_and_update_preferences(async_db: AsyncSession):
    user_id = uuid.uuid4()

    # Turn 1: user expresses fit and color preference
    await AVAMemoryManager.extract_and_update_preferences(
        async_db, user_id, "I love oversized shirts and olive colors, my budget is under 4000"
    )
    pref = await AVAMemoryManager.get_preferences(async_db, user_id)
    assert pref is not None
    assert "oversized" in pref.preferred_fits
    assert "olive" in pref.preferred_colors
    assert pref.budget_range_max == 4000.0

    # Turn 2: user expresses brand preference and a dislike
    await AVAMemoryManager.extract_and_update_preferences(
        async_db, user_id, "I hate yellow and never show me polyester. I usually buy from Zara on Myntra."
    )
    pref2 = await AVAMemoryManager.get_preferences(async_db, user_id)
    assert "yellow" in pref2.disliked_colors
    assert any("polyester" in item for item in pref2.disliked_items)
    assert "Zara" in pref2.favorite_brands
    assert "Myntra" in pref2.favorite_retailers

    # Turn 3: style DNA keyword extraction
    await AVAMemoryManager.extract_and_update_preferences(
        async_db, user_id, "I want some minimalist aesthetic fits"
    )
    pref3 = await AVAMemoryManager.get_preferences(async_db, user_id)
    assert "minimal" in pref3.style_dna


@pytest.mark.asyncio
async def test_save_explicit_preference(async_db: AsyncSession):
    user_id = uuid.uuid4()

    pref = await AVAMemoryManager.save_explicit_preference(
        async_db,
        user_id,
        preferred_fits=["slim", "relaxed"],
        preferred_colors=["navy", "charcoal"],
        disliked_colors=["pink"],
        favorite_brands=["H&M"],
        budget_range_max=7500.0,
    )
    assert pref.preferred_fits == ["slim", "relaxed"]
    assert pref.preferred_colors == ["navy", "charcoal"]
    assert pref.disliked_colors == ["pink"]
    assert pref.favorite_brands == ["H&M"]
    assert pref.budget_range_max == 7500.0
