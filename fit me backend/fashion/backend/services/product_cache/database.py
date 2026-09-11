"""
Product Cache — Storage (Supabase / PostgreSQL Implementation).

Uses isolated `pi_product_cache` table via SQLAlchemy Async sessions.
Zero MongoDB dependencies. Fully ACID-compliant and fail-soft.
"""
from __future__ import annotations

import logging
import os
from datetime import UTC, datetime, timedelta
from typing import Any, Dict, Optional

from sqlalchemy import delete, func, select, update

from app.core import database as core_db
from app.models.product_intelligence import PIProductCache

logger = logging.getLogger(__name__)

DEFAULT_TTL_DAYS = 7


def _ttl_seconds() -> int:
    raw = os.environ.get("PRODUCT_CACHE_TTL_DAYS", str(DEFAULT_TTL_DAYS))
    try:
        days = float(raw)
    except ValueError:
        logger.warning(
            "PRODUCT_CACHE_TTL_DAYS=%r is not a number; using default %d days",
            raw,
            DEFAULT_TTL_DAYS,
        )
        days = DEFAULT_TTL_DAYS
    return max(int(days * 86400), 60)


async def get_entry(fingerprint_hash: str) -> Optional[Dict[str, Any]]:
    """Retrieves a valid, non-expired cache entry by its fingerprint hash."""
    try:
        async with core_db.AsyncSessionLocal() as session:
            now = datetime.now(UTC)
            stmt = select(PIProductCache).where(
                PIProductCache.fingerprint_hash == fingerprint_hash,
                PIProductCache.expires_at > now,
            )
            result = await session.execute(stmt)
            entry = result.scalar_one_or_none()
            if entry is None:
                return None

            return {
                "fingerprint_hash": entry.fingerprint_hash,
                "fingerprint_tier": entry.fingerprint_tier,
                "fingerprint_fields": entry.fingerprint_fields,
                "cache_version": entry.cache_version,
                "match_status": entry.match_status,
                "top_confidence": entry.top_confidence,
                "profile": entry.profile,
                "candidates": entry.candidates,
                "source_retailers": entry.source_retailers,
                "hit_count": entry.hit_count,
                "created_at": entry.created_at.isoformat() if entry.created_at else None,
                "expires_at": entry.expires_at.isoformat() if entry.expires_at else None,
                "last_hit_at": entry.last_hit_at.isoformat() if entry.last_hit_at else None,
            }
    except Exception as exc:
        logger.warning("Product Cache: lookup failed for %s (%s); treating as miss.", fingerprint_hash, exc)
        return None


async def put_entry(entry_dict: Dict[str, Any]) -> bool:
    """Stores or updates a verified result in the isolated pi_product_cache table."""
    try:
        async with core_db.AsyncSessionLocal() as session:
            now = datetime.now(UTC)
            expires_at = now + timedelta(seconds=_ttl_seconds())

            cache_obj = PIProductCache(
                fingerprint_hash=entry_dict["fingerprint_hash"],
                fingerprint_tier=entry_dict.get("fingerprint_tier", "descriptive"),
                fingerprint_fields=entry_dict.get("fingerprint_fields", {}),
                cache_version=entry_dict.get("cache_version", "v2"),
                match_status=entry_dict["match_status"],
                top_confidence=entry_dict["top_confidence"],
                profile=entry_dict.get("profile", {}),
                candidates=entry_dict.get("candidates", []),
                source_retailers=entry_dict.get("source_retailers", []),
                hit_count=entry_dict.get("hit_count", 0),
                created_at=now,
                expires_at=expires_at,
            )
            await session.merge(cache_obj)
            await session.commit()
            return True
    except Exception as exc:
        logger.warning("Product Cache: write failed for %s (%s); continuing without caching.", entry_dict.get("fingerprint_hash"), exc)
        return False


async def record_hit(fingerprint_hash: str) -> None:
    """Increments the hit counter and updates last_hit_at timestamp."""
    try:
        async with core_db.AsyncSessionLocal() as session:
            now = datetime.now(UTC)
            stmt = (
                update(PIProductCache)
                .where(PIProductCache.fingerprint_hash == fingerprint_hash)
                .values(
                    hit_count=PIProductCache.hit_count + 1,
                    last_hit_at=now,
                )
            )
            await session.execute(stmt)
            await session.commit()
    except Exception as exc:
        logger.warning("Product Cache: hit-count update failed for %s (%s); non-fatal.", fingerprint_hash, exc)


async def delete_entry(fingerprint_hash: str) -> bool:
    """Deletes a single cache entry."""
    try:
        async with core_db.AsyncSessionLocal() as session:
            stmt = delete(PIProductCache).where(PIProductCache.fingerprint_hash == fingerprint_hash)
            result = await session.execute(stmt)
            await session.commit()
            return (result.rowcount or 0) > 0
    except Exception as exc:
        logger.warning("Product Cache: delete failed for %s (%s).", fingerprint_hash, exc)
        return False


async def clear_all() -> int:
    """Clears all entries from pi_product_cache."""
    try:
        async with core_db.AsyncSessionLocal() as session:
            stmt = delete(PIProductCache)
            result = await session.execute(stmt)
            await session.commit()
            return result.rowcount or 0
    except Exception as exc:
        logger.warning("Product Cache: clear_all failed (%s).", exc)
        return 0


async def clear_by_version(cache_version: str) -> int:
    """Clears all entries not matching the specified cache_version."""
    try:
        async with core_db.AsyncSessionLocal() as session:
            stmt = delete(PIProductCache).where(PIProductCache.cache_version != cache_version)
            result = await session.execute(stmt)
            await session.commit()
            return result.rowcount or 0
    except Exception as exc:
        logger.warning("Product Cache: clear_by_version failed (%s).", exc)
        return 0


async def count_entries() -> int:
    """Returns the total number of cached entries in pi_product_cache."""
    try:
        async with core_db.AsyncSessionLocal() as session:
            stmt = select(func.count(PIProductCache.fingerprint_hash))
            result = await session.execute(stmt)
            return result.scalar_one() or 0
    except Exception as exc:
        logger.warning("Product Cache: count failed (%s).", exc)
        return 0


def reset_for_tests() -> None:
    pass
