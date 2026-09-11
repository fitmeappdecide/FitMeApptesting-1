import pytest
import pytest_asyncio
import os
import sys
from datetime import datetime, timezone
import uuid

# Ensure backend root is in python path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.compiler import compiles

# Teach SQLite how to compile PostgreSQL JSONB columns for fast in-memory unit testing
@compiles(JSONB, "sqlite")
def compile_jsonb_sqlite(type_, compiler, **kw):
    return "JSON"

from app.core.database import Base
import app.core.database as core_db
import app.models  # load all models including pi_*
from app.models.user import User
from app.api.deps import get_current_user, get_current_user_or_anonymous
from app.main import app

from sqlalchemy.pool import StaticPool

# Create in-memory SQLite async engine with shared cache and StaticPool so all async connections share the same memory DB
test_engine = create_async_engine(
    "sqlite+aiosqlite:///file:test_mem_db?mode=memory&cache=shared&uri=true",
    poolclass=StaticPool,
    connect_args={"check_same_thread": False, "uri": True},
)
TestAsyncSessionLocal = async_sessionmaker(test_engine, class_=AsyncSession, expire_on_commit=False)

@pytest_asyncio.fixture(autouse=True)
async def init_test_db():
    """Initializes in-memory database schema for all models (including pi_*)."""
    async with test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield

@pytest_asyncio.fixture(autouse=True)
async def override_deps_for_tests():
    """Points core database sessions and auth to test fixtures."""
    # Seed default test user and anonymous try-on user
    test_user_id = uuid.UUID("a1b2c3d4-e5f6-7890-abcd-ef1234567890")
    anon_user_id = uuid.UUID("8191ee1c-5894-4937-a6d9-02e4ad0f7abd")
    async with TestAsyncSessionLocal() as session:
        existing = await session.get(User, test_user_id)
        if not existing:
            user = User(
                id=test_user_id,
                email="test@fitme.ai",
                password_hash="mock_hash_for_test",
                full_name="Test User",
                is_active=True,
                created_at=datetime.now(timezone.utc),
            )
            session.add(user)
        existing_anon = await session.get(User, anon_user_id)
        if not existing_anon:
            anon = User(
                id=anon_user_id,
                email="testtryon_user@example.com",
                password_hash="mock_hash_for_test",
                full_name="Anonymous TryOn User",
                is_active=True,
                created_at=datetime.now(timezone.utc),
            )
            session.add(anon)
        await session.commit()

    # Monkeypatch AsyncSessionLocal in core_db to use test engine
    original_sessionmaker = core_db.AsyncSessionLocal
    core_db.AsyncSessionLocal = TestAsyncSessionLocal

    async def mock_get_current_user():
        async with TestAsyncSessionLocal() as session:
            return await session.get(User, test_user_id)

    async def mock_get_db():
        async with TestAsyncSessionLocal() as session:
            yield session

    app.dependency_overrides[get_current_user] = mock_get_current_user
    app.dependency_overrides[core_db.get_db] = mock_get_db
    yield
    app.dependency_overrides.pop(get_current_user, None)
    app.dependency_overrides.pop(core_db.get_db, None)
    core_db.AsyncSessionLocal = original_sessionmaker
