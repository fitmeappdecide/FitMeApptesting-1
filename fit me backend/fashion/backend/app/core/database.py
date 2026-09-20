from collections.abc import AsyncGenerator
import os
import uuid
from datetime import UTC, datetime

from sqlalchemy import MetaData
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.ext.compiler import compiles
from sqlalchemy.orm import DeclarativeBase
from sqlalchemy.pool import AsyncAdaptedQueuePool, NullPool, StaticPool

from app.core.config import settings

# Teach SQLite how to compile PostgreSQL JSONB columns for local dev and testing
@compiles(JSONB, "sqlite")
def compile_jsonb_sqlite(type_, compiler, **kw):
    return "JSON"

convention = {
    "ix": "ix_%(column_0_label)s",
    "uq": "uq_%(table_name)s_%(column_0_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
    "pk": "pk_%(table_name)s",
}


class Base(DeclarativeBase):
    metadata = MetaData(naming_convention=convention)


def _normalize_db_url(url: str) -> str:
    """Ensure database URL uses the asyncpg driver when targeting PostgreSQL."""
    if url.startswith("postgres://"):
        return url.replace("postgres://", "postgresql+asyncpg://", 1)
    if url.startswith("postgresql://") and not url.startswith("postgresql+"):
        return url.replace("postgresql://", "postgresql+asyncpg://", 1)
    return url


def _build_engine():
    raw_url = settings.database_url
    db_url = _normalize_db_url(raw_url)
    if "postgresql" in db_url:
        return create_async_engine(
            db_url,
            poolclass=AsyncAdaptedQueuePool,
            pool_pre_ping=True,
            pool_recycle=300,
            pool_size=10,
            max_overflow=20,
            future=True,
            connect_args={
                "statement_cache_size": 0,
                "prepared_statement_cache_size": 0,
            },
        )
    # SQLite configuration for standalone local development
    connect_args = {"check_same_thread": False}
    if "mode=memory" in db_url:
        return create_async_engine(db_url, poolclass=StaticPool, connect_args=connect_args, future=True)
    return create_async_engine(db_url, connect_args=connect_args, future=True)


engine = _build_engine()
AsyncSessionLocal = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    async with AsyncSessionLocal() as session:
        try:
            yield session
        except Exception:
            await session.rollback()
            raise


async def init_models() -> None:
    import app.models  # noqa: F401
    from app.models.user import User

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    # Ensure anonymous website user exists in database for seamless guest try-ons
    anon_email = settings.anonymous_website_user_email.lower()
    async with AsyncSessionLocal() as session:
        try:
            from sqlalchemy import select
            res = await session.execute(select(User).where(User.email == anon_email))
            existing_anon = res.scalar_one_or_none()
            if not existing_anon:
                anon_user = User(
                    id=uuid.UUID("8191ee1c-5894-4937-a6d9-02e4ad0f7abd"),
                    email=anon_email,
                    password_hash="anon_seeded_hash",
                    full_name="Anonymous Website User",
                    is_active=True,
                    created_at=datetime.now(UTC),
                )
                session.add(anon_user)
                await session.commit()
        except Exception as seed_err:
            print(f"Notice: Anonymous user seeding notice ({seed_err})")


