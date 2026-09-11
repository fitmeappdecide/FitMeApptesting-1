"""
Analytics — Storage (Supabase / PostgreSQL Implementation).

Uses isolated `pi_analytics_events` table via SQLAlchemy Async sessions.
Zero MongoDB dependencies. Fully ACID-compliant, idempotent, and fail-soft.
"""
from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError

from app.core import database as core_db
from app.models.product_intelligence import PIAnalyticsEvent

logger = logging.getLogger(__name__)


async def insert_event(event_dict: Dict[str, Any]) -> Optional[str]:
    """Inserts an event into pi_analytics_events.
    Returns:
      'inserted'  -> Newly recorded
      'duplicate' -> Idempotent duplicate event_id, ignored safely
      None        -> Storage failure (fail-soft)
    """
    try:
        async with core_db.AsyncSessionLocal() as session:
            event_obj = PIAnalyticsEvent(
                event_id=event_dict["event_id"],
                event_type=event_dict["event_type"],
                timestamp=event_dict.get("timestamp", ""),
                user_id=event_dict.get("user_id"),
                scan_id=event_dict.get("scan_id"),
                candidate_id=event_dict.get("candidate_id"),
                retailer=event_dict.get("retailer"),
                metadata_json=event_dict.get("metadata", {}),
            )
            session.add(event_obj)
            await session.commit()
            return "inserted"
    except IntegrityError:
        return "duplicate"
    except Exception as exc:
        logger.warning("Analytics: insert failed (%s); event was not recorded.", exc)
        return None


async def query_events(
    event_type: Optional[str] = None,
    scan_id: Optional[str] = None,
    retailer: Optional[str] = None,
    since_iso: Optional[str] = None,
    limit: int = 50,
) -> List[Dict[str, Any]]:
    """Queries pi_analytics_events with optional filtering."""
    try:
        async with core_db.AsyncSessionLocal() as session:
            stmt = select(PIAnalyticsEvent)
            if event_type:
                stmt = stmt.where(PIAnalyticsEvent.event_type == event_type)
            if scan_id:
                stmt = stmt.where(PIAnalyticsEvent.scan_id == scan_id)
            if retailer:
                stmt = stmt.where(PIAnalyticsEvent.retailer == retailer)
            if since_iso:
                stmt = stmt.where(PIAnalyticsEvent.timestamp >= since_iso)

            stmt = stmt.order_by(PIAnalyticsEvent.timestamp.desc()).limit(limit)
            result = await session.execute(stmt)
            events = result.scalars().all()

            return [
                {
                    "event_id": e.event_id,
                    "event_type": e.event_type,
                    "timestamp": e.timestamp,
                    "user_id": e.user_id,
                    "scan_id": e.scan_id,
                    "candidate_id": e.candidate_id,
                    "retailer": e.retailer,
                    "metadata": e.metadata_json,
                }
                for e in events
            ]
    except Exception as exc:
        logger.warning("Analytics: query failed (%s); returning empty result.", exc)
        return []


async def count_events() -> int:
    """Returns total count of recorded analytics events."""
    try:
        async with core_db.AsyncSessionLocal() as session:
            stmt = select(func.count(PIAnalyticsEvent.event_id))
            result = await session.execute(stmt)
            return result.scalar_one() or 0
    except Exception as exc:
        logger.warning("Analytics: count failed (%s).", exc)
        return 0


def reset_for_tests() -> None:
    pass
