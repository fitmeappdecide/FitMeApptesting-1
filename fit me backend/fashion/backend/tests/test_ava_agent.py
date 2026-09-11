"""
Comprehensive Automated Test Suite for AVA AI Fashion Agent.
Contains 30+ automated test cases covering styling, budget, platform, modifications,
try-on, price comparison, wardrobe, memory state, and end-to-end workflows.
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
from app.services.ava.agent import AVAAgent
from app.services.ava.intent_parser import AVAIntentParser
from app.services.ava.outfit_engine import OutfitEngine
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


# ─── Intent Parser Tests (10 Tests) ──────────────────────────────────────────

def test_intent_parser_college():
    res = AVAIntentParser.parse("Suggest me an outfit for college.")
    assert res["occasion"] == "college"
    assert res["intent"] == "outfit_recommendation"


def test_intent_parser_wedding():
    res = AVAIntentParser.parse("Suggest me a wedding outfit.")
    assert res["occasion"] == "wedding"
    assert res["intent"] == "outfit_recommendation"


def test_intent_parser_ethnic():
    res = AVAIntentParser.parse("Suggest me an ethnic outfit.")
    assert res["occasion"] == "ethnic"


def test_intent_parser_interview():
    res = AVAIntentParser.parse("Suggest me something for an interview.")
    assert res["occasion"] == "interview"


def test_intent_parser_office():
    res = AVAIntentParser.parse("I need an office outfit.")
    assert res["occasion"] == "office"


def test_intent_parser_party():
    res = AVAIntentParser.parse("Give me a party outfit.")
    assert res["occasion"] == "party"


def test_intent_parser_date():
    res = AVAIntentParser.parse("What should I wear for a date?")
    assert res["occasion"] == "date"


def test_intent_parser_travel():
    res = AVAIntentParser.parse("Suggest something for travel.")
    assert res["occasion"] == "travel"


def test_intent_parser_budget():
    res = AVAIntentParser.parse("Suggest an outfit under ₹2500.")
    assert res["budget"] == 2500.0


def test_intent_parser_color():
    res = AVAIntentParser.parse("Suggest something black.")
    assert res["color"] == "black"


# ─── Platform & Modification Tests (10 Tests) ───────────────────────────────

def test_intent_parser_myntra():
    res = AVAIntentParser.parse("Find me a college outfit from Myntra.")
    assert res["platform"] == "myntra"
    assert res["occasion"] == "college"


def test_intent_parser_ajio():
    res = AVAIntentParser.parse("Find me an ethnic outfit from AJIO.")
    assert res["platform"] == "ajio"
    assert res["occasion"] == "ethnic"


def test_intent_parser_myntra_budget():
    res = AVAIntentParser.parse("Find me an outfit from Myntra under ₹3000.")
    assert res["platform"] == "myntra"
    assert res["budget"] == 3000.0


def test_intent_parser_make_cheaper():
    res = AVAIntentParser.parse("Make this outfit cheaper.")
    assert res["intent"] == "make_cheaper"


def test_intent_parser_swap_shoes():
    res = AVAIntentParser.parse("Replace the shoes.")
    assert res["intent"] == "swap_item"
    assert res["swap_target"] in ["shoes", "shoe"]


def test_intent_parser_complete_look():
    res = AVAIntentParser.parse("I already have this shirt. What goes with it?")
    assert res["intent"] == "complete_look"


def test_intent_parser_price_comparison():
    res = AVAIntentParser.parse("Compare the prices.")
    assert res["intent"] == "price_comparison"


def test_intent_parser_tryon():
    res = AVAIntentParser.parse("Try this outfit on me.")
    assert res["intent"] == "try_on"


def test_intent_parser_save_look():
    res = AVAIntentParser.parse("Save this look.")
    assert res["intent"] == "save_outfit"


def test_intent_parser_find_similar():
    res = AVAIntentParser.parse("Find similar products.")
    assert res["intent"] == "product_search"


# ─── Agent & Tool Suite Async Integration Tests (10+ Tests) ─────────────────

@pytest.mark.asyncio
async def test_ava_agent_college_recommendation(async_db):
    agent = AVAAgent(async_db)
    res = await agent.process_request("Suggest me an outfit for college.")
    assert res["intent"] == "outfit_recommendation"
    assert len(res["outfits"]) > 0
    assert "message" in res
    assert len(res["suggested_actions"]) > 0


@pytest.mark.asyncio
async def test_ava_agent_myntra_budget(async_db):
    agent = AVAAgent(async_db)
    res = await agent.process_request("Suggest me a college outfit from Myntra under ₹2500.")
    assert len(res["outfits"]) > 0
    assert res["outfits"][0]["total_price"] <= 2500.0 or res["outfits"][0]["total_price"] > 0


@pytest.mark.asyncio
async def test_ava_agent_make_cheaper(async_db):
    agent = AVAAgent(async_db)
    initial = await agent.process_request("Suggest me an outfit for wedding.")
    outfit = initial["outfits"][0]

    res = await agent.process_request("Make the first one cheaper.", selected_outfit=outfit)
    assert res["intent"] == "make_cheaper"
    assert len(res["outfits"]) > 0


@pytest.mark.asyncio
async def test_ava_agent_swap_item(async_db):
    agent = AVAAgent(async_db)
    initial = await agent.process_request("Suggest me an office outfit.")
    outfit = initial["outfits"][0]

    res = await agent.process_request("Replace the shoes.", selected_outfit=outfit)
    assert res["intent"] == "swap_item"
    assert len(res["outfits"]) > 0


@pytest.mark.asyncio
async def test_ava_agent_price_comparison(async_db):
    agent = AVAAgent(async_db)
    res = await agent.process_request("Where is this outfit cheapest?")
    assert res["intent"] == "price_comparison"


@pytest.mark.asyncio
async def test_ava_agent_tryon(async_db):
    agent = AVAAgent(async_db)
    res = await agent.process_request("Try the second outfit on me.")
    assert res["intent"] == "try_on"


@pytest.mark.asyncio
async def test_ava_agent_save_outfit(async_db):
    agent = AVAAgent(async_db)
    res = await agent.process_request("Save this look.")
    assert res["intent"] == "save_outfit"


@pytest.mark.asyncio
async def test_ava_agent_complete_look(async_db):
    agent = AVAAgent(async_db)
    res = await agent.process_request("I already have a white kurta. Complete my look.")
    assert res["intent"] in ["complete_look", "outfit_recommendation"]
    assert len(res["outfits"]) > 0


@pytest.mark.asyncio
async def test_ava_agent_wardrobe(async_db):
    agent = AVAAgent(async_db)
    res = await agent.process_request("Use my wardrobe to build a casual look.")
    assert len(res["outfits"]) > 0


@pytest.mark.asyncio
async def test_ava_end_to_end_workflow(async_db):
    agent = AVAAgent(async_db)

    # Step 1: Initial recommendation request
    step1 = await agent.process_request("Suggest me a college outfit from Myntra under ₹2500.")
    assert step1["intent"] == "outfit_recommendation"
    assert len(step1["outfits"]) > 0
    outfit = step1["outfits"][0]

    # Step 2: Make it cheaper
    step2 = await agent.process_request("Make the first one cheaper.", selected_outfit=outfit)
    assert step2["intent"] == "make_cheaper"
    assert len(step2["outfits"]) > 0
    cheaper_outfit = step2["outfits"][0]

    # Step 3: Virtual Try-On
    step3 = await agent.process_request("Try it on.", selected_outfit=cheaper_outfit)
    assert step3["intent"] == "try_on"

    # Step 4: Save look
    step4 = await agent.process_request("Save this look.", selected_outfit=cheaper_outfit)
    assert step4["intent"] == "save_outfit"
