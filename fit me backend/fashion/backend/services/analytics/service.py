"""
Analytics — service (V2 Phase 8).

Two halves:
  1. WRITE — record_event() / record_event_background() / the
     record_*_event() convenience builders. Called from server.py at the
     4 real points events happen: scan completion, a Buy tap
     (product_selected + affiliate_click), and a Try On tap.
  2. READ — overview() / by_retailer() / top_products() / trend(),
     reimplementing the 4 functions `server.py` already imported from the
     never-available `services/analytics.py`, now querying
     `analytics_events` instead of scanning `db.scans`/`db.affiliate_clicks`
     ad hoc.

Every WRITE function is fail-soft: catches its own exceptions, logs, and
returns without raising. `record_event_background()` additionally never
blocks its caller — it schedules the write as a separate asyncio task and
returns immediately, so even a slow/hung Mongo instance can't add latency
to a scan, a Buy tap, or a Try On tap.
"""
from __future__ import annotations

import asyncio
import logging
from typing import Any, Dict, List, Optional

from . import database
from .models import AnalyticsEvent, AnalyticsEventType, compute_event_id

logger = logging.getLogger(__name__)


# --------------------------------------------------------------------------
# WRITE
# --------------------------------------------------------------------------
async def record_event(event: AnalyticsEvent) -> bool:
    """Awaitable, fail-soft. Returns True if a NEW event was stored,
    False if it was a duplicate (already recorded) or storage is
    unavailable/errored — callers generally don't need to check this;
    it's mainly for tests."""
    try:
        fields = event.to_dict()
        event.event_id = compute_event_id(event.event_type, fields)
        fields = event.to_dict()
        outcome = await database.insert_event(fields)
        return outcome == "inserted"
    except Exception as exc:  # noqa: BLE001
        logger.warning("Analytics: record_event failed unexpectedly (%s); event dropped.", exc)
        return False


def record_event_background(event: AnalyticsEvent) -> None:
    """Fire-and-forget: schedules record_event() on the event loop and
    returns immediately. The wrapped coroutine swallows everything
    itself (record_event already never raises), so a failed/cancelled
    task can never surface as an unhandled exception in server logs
    beyond a single warning."""
    async def _safe():
        try:
            await record_event(event)
        except Exception as exc:  # noqa: BLE001
            logger.warning("Analytics: background record_event failed (%s); event dropped.", exc)
    try:
        asyncio.create_task(_safe())
    except RuntimeError:
        # No running event loop (e.g. called from sync test code) —
        # analytics is best-effort, so just drop it rather than raise.
        logger.warning("Analytics: no running event loop; event dropped.")


def build_scan_completed_event(scan_id: str, user_id: Optional[str], result: Dict[str, Any]) -> AnalyticsEvent:
    """`result` is the full dict `run_scan()` returns (or the merged
    equivalent) — BEFORE `server.py` strips `raw` off each candidate for
    storage, so candidate provenance (discovery source) is still there."""
    candidates = result.get("candidates") or []
    source_breakdown: Dict[str, int] = {}
    for c in candidates:
        source = (c.get("raw") or {}).get("provenance", {}).get("source") or c.get("strategy")
        if source:
            source_breakdown[source] = source_breakdown.get(source, 0) + 1

    profile = result.get("profile") or {}
    best = candidates[0] if candidates else {}
    # V2 Phase 9 addition (additive, non-breaking — does not change
    # event_type, dedup key, or any existing field): strategy kinds used
    # for this scan, so the Learning Engine can approximate search
    # strategy effectiveness. `result["strategies"]` was already computed
    # and returned by run_scan() in every phase up to now; this just
    # reads it, nothing upstream changed.
    strategy_kinds = sorted({s.get("kind") for s in (result.get("strategies") or []) if s.get("kind")})
    return AnalyticsEvent(
        event_type=AnalyticsEventType.SCAN_COMPLETED,
        user_id=user_id,
        scan_id=scan_id,
        retailer=best.get("retailer"),
        brand=profile.get("brand"),
        category=profile.get("category"),
        match_status=result.get("match_status") or result.get("status"),
        extra={
            "candidate_count": len(candidates),
            "source_breakdown": source_breakdown,
            "strategy_kinds": strategy_kinds,
            "top_confidence": result.get("top_confidence"),
            "cache_hit": (result.get("cache") or {}).get("hit", False),
            "elapsed_ms": result.get("elapsed_ms"),
        },
    )


def build_product_selected_event(scan_id: str, candidate_id: str, user_id: Optional[str],
                                 candidate: Dict[str, Any]) -> AnalyticsEvent:
    source = (candidate.get("raw") or {}).get("provenance", {}).get("source") or candidate.get("strategy")
    return AnalyticsEvent(
        event_type=AnalyticsEventType.PRODUCT_SELECTED,
        user_id=user_id,
        scan_id=scan_id,
        candidate_id=candidate_id,
        retailer=candidate.get("retailer"),
        source=source,
    )


def build_affiliate_click_event(scan_id: str, candidate_id: str, click_id: str, user_id: Optional[str],
                                retailer: str, provider: str, success: bool,
                                error: Optional[str]) -> AnalyticsEvent:
    return AnalyticsEvent(
        event_type=AnalyticsEventType.AFFILIATE_CLICK,
        user_id=user_id,
        scan_id=scan_id,
        candidate_id=candidate_id,
        click_id=click_id,
        retailer=retailer,
        provider=provider,
        success=success,
        error=error,
    )


def build_tryon_selected_event(scan_id: str, candidate_id: str, user_id: Optional[str],
                               candidate: Dict[str, Any]) -> AnalyticsEvent:
    return AnalyticsEvent(
        event_type=AnalyticsEventType.TRYON_SELECTED,
        user_id=user_id,
        scan_id=scan_id,
        candidate_id=candidate_id,
        retailer=candidate.get("retailer"),
    )


def build_conversion_event(click_id: str, retailer: Optional[str], user_id: Optional[str],
                           extra: Optional[Dict[str, Any]] = None) -> AnalyticsEvent:
    """NOT called automatically anywhere in this codebase (Requirement
    8) — no retailer sends this project a purchase webhook/postback
    today. This exists only for the admin-triggered manual-reconciliation
    endpoint and as the landing spot for a real integration later. See
    ARCHITECTURE.md Section 15."""
    return AnalyticsEvent(
        event_type=AnalyticsEventType.CONVERSION,
        user_id=user_id,
        click_id=click_id,
        retailer=retailer,
        extra=extra or {},
    )


# --------------------------------------------------------------------------
# READ — replaces the never-available services/analytics.py's 4 functions
# --------------------------------------------------------------------------
def _since_iso(days: int) -> str:
    from datetime import datetime, timedelta, timezone
    return (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()


async def overview(days: int = 30) -> Dict[str, Any]:
    since = _since_iso(days)
    scans = await database.aggregate([
        {"$match": {"event_type": AnalyticsEventType.SCAN_COMPLETED.value, "timestamp": {"$gte": since}}},
        {"$group": {"_id": "$match_status", "count": {"$sum": 1}}},
    ])
    clicks = await database.aggregate([
        {"$match": {"event_type": AnalyticsEventType.AFFILIATE_CLICK.value, "timestamp": {"$gte": since}}},
        {"$group": {"_id": "$success", "count": {"$sum": 1}}},
    ])
    tryons = await database.aggregate([
        {"$match": {"event_type": AnalyticsEventType.TRYON_SELECTED.value, "timestamp": {"$gte": since}}},
        {"$count": "count"},
    ])
    conversions = await database.aggregate([
        {"$match": {"event_type": AnalyticsEventType.CONVERSION.value, "timestamp": {"$gte": since}}},
        {"$count": "count"},
    ])
    scan_by_status = {row["_id"] or "unknown": row["count"] for row in scans}
    click_success = next((r["count"] for r in clicks if r["_id"] is True), 0)
    click_failure = next((r["count"] for r in clicks if r["_id"] is False), 0)
    return {
        "days": days,
        "scans_total": sum(scan_by_status.values()),
        "scans_by_match_status": scan_by_status,
        "affiliate_clicks_total": click_success + click_failure,
        "affiliate_clicks_succeeded": click_success,
        "affiliate_clicks_failed": click_failure,
        "tryon_selections_total": (tryons[0]["count"] if tryons else 0),
        # Always present, always honest about being (usually) zero — see
        # build_conversion_event's docstring. A non-zero number here means
        # someone actually used the manual admin endpoint, not that
        # automatic tracking exists.
        "conversions_total": (conversions[0]["count"] if conversions else 0),
    }


async def by_retailer(days: int = 30) -> List[Dict[str, Any]]:
    since = _since_iso(days)
    rows = await database.aggregate([
        {"$match": {"event_type": AnalyticsEventType.AFFILIATE_CLICK.value, "timestamp": {"$gte": since}}},
        {"$group": {
            "_id": "$retailer",
            "clicks": {"$sum": 1},
            "succeeded": {"$sum": {"$cond": ["$success", 1, 0]}},
        }},
        {"$sort": {"clicks": -1}},
    ])
    return [{"retailer": r["_id"], "clicks": r["clicks"], "succeeded": r["succeeded"]} for r in rows]


async def top_products(days: int = 30, limit: int = 10) -> List[Dict[str, Any]]:
    since = _since_iso(days)
    rows = await database.aggregate([
        {"$match": {"event_type": AnalyticsEventType.SCAN_COMPLETED.value, "timestamp": {"$gte": since},
                   "brand": {"$ne": None}}},
        {"$group": {"_id": {"brand": "$brand", "category": "$category"}, "count": {"$sum": 1}}},
        {"$sort": {"count": -1}},
        {"$limit": limit},
    ])
    return [{"brand": r["_id"]["brand"], "category": r["_id"]["category"], "count": r["count"]} for r in rows]


async def trend(days: int = 7) -> List[Dict[str, Any]]:
    since = _since_iso(days)
    rows = await database.aggregate([
        {"$match": {"event_type": AnalyticsEventType.SCAN_COMPLETED.value, "timestamp": {"$gte": since}}},
        {"$group": {"_id": {"$substrCP": ["$timestamp", 0, 10]}, "count": {"$sum": 1}}},
        {"$sort": {"_id": 1}},
    ])
    return [{"date": r["_id"], "count": r["count"]} for r in rows]
