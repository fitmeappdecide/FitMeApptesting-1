"""
Learning Engine — aggregation (V2 Phase 9).

Reads `analytics_events` (V2 Phase 8) via `services.analytics.database`
directly (read-only — never calls `insert_event`). Every function here
is fail-soft: on any error it returns empty/neutral stats rather than
raising, so a broken or unavailable analytics store degrades the
Learning Engine to "no data" rather than breaking a scan (Requirement 9).

Deliberately implemented as "fetch bounded event lists, aggregate in
Python" rather than Mongo aggregation pipelines with $objectToArray/
$unwind on the nested `extra.source_breakdown` field — simpler to read,
simpler to test, and the event volumes this reads (affiliate clicks,
selections, recent scans) are not large enough for that to matter.
"""
from __future__ import annotations

import logging
from typing import Any, Dict, List

from services.analytics import database as analytics_db
from services.analytics.models import AnalyticsEventType

from .models import RetailerStat, SourceStat, min_samples

logger = logging.getLogger(__name__)

_FETCH_LIMIT = 5000


async def _fetch(event_type: AnalyticsEventType, since_iso: str) -> List[Dict[str, Any]]:
    try:
        return await analytics_db.query_events(
            event_type=event_type.value, since_iso=since_iso, limit=_FETCH_LIMIT
        )
    except Exception as exc:  # noqa: BLE001
        logger.warning("Learning Engine: fetching %s events failed (%s); treating as no data.",
                       event_type.value, exc)
        return []


async def compute_retailer_stats(since_iso: str) -> Dict[str, RetailerStat]:
    events = await _fetch(AnalyticsEventType.AFFILIATE_CLICK, since_iso)
    stats: Dict[str, RetailerStat] = {}
    threshold = min_samples()
    for e in events:
        retailer = e.get("retailer")
        if not retailer:
            continue
        s = stats.setdefault(retailer, RetailerStat(retailer=retailer))
        s.total_clicks += 1
        if e.get("success"):
            s.successful_clicks += 1
    for s in stats.values():
        s.sufficient = s.total_clicks >= threshold
    return stats


async def compute_source_stats(since_iso: str) -> Dict[str, SourceStat]:
    scan_events = await _fetch(AnalyticsEventType.SCAN_COMPLETED, since_iso)
    selection_events = await _fetch(AnalyticsEventType.PRODUCT_SELECTED, since_iso)

    stats: Dict[str, SourceStat] = {}
    threshold = min_samples()
    for e in scan_events:
        breakdown = (e.get("extra") or {}).get("source_breakdown") or {}
        for source, count in breakdown.items():
            s = stats.setdefault(source, SourceStat(source=source))
            s.appearances += int(count or 0)
    for e in selection_events:
        source = e.get("source")
        if not source:
            continue
        s = stats.setdefault(source, SourceStat(source=source))
        s.selections += 1
    for s in stats.values():
        s.sufficient = s.appearances >= threshold
    return stats


async def compute_brand_retailer_counts(since_iso: str) -> Dict[str, Dict[str, int]]:
    """Informational only (Requirement 3) — never read by engine.py's
    ranking logic. Co-occurrence of brand (from scan_completed) and
    retailer (from affiliate_click) isn't directly joinable without a
    real join key beyond scan_id, so this approximates via scan_id
    matching between the two event streams."""
    scan_events = await _fetch(AnalyticsEventType.SCAN_COMPLETED, since_iso)
    click_events = await _fetch(AnalyticsEventType.AFFILIATE_CLICK, since_iso)
    brand_by_scan = {e["scan_id"]: e.get("brand") for e in scan_events if e.get("scan_id") and e.get("brand")}

    counts: Dict[str, Dict[str, int]] = {}
    for click in click_events:
        brand = brand_by_scan.get(click.get("scan_id"))
        retailer = click.get("retailer")
        if not brand or not retailer:
            continue
        counts.setdefault(brand, {}).setdefault(retailer, 0)
        counts[brand][retailer] += 1
    return counts


async def compute_strategy_effectiveness(since_iso: str) -> Dict[str, Dict[str, int]]:
    """Informational only (Requirement 3) — search strategy effectiveness
    ('which strategy KIND tends to produce a selected candidate'), using
    scan_completed's stored strategies list vs product_selected's source.
    Approximate by design: a scan's strategies aren't individually tied
    to which candidate they produced, so this reports 'selected after a
    scan that used strategy kind X' co-occurrence, not per-candidate
    attribution — clearly weaker evidence than source_stats, which is
    why it never feeds ranking."""
    scan_events = await _fetch(AnalyticsEventType.SCAN_COMPLETED, since_iso)
    selection_events = await _fetch(AnalyticsEventType.PRODUCT_SELECTED, since_iso)
    selected_scan_ids = {e["scan_id"] for e in selection_events if e.get("scan_id")}

    out: Dict[str, Dict[str, int]] = {}
    for e in scan_events:
        kinds = (e.get("extra") or {}).get("strategy_kinds") or []
        for kind in kinds:
            bucket = out.setdefault(kind, {"shown": 0, "selected": 0})
            bucket["shown"] += 1
            if e.get("scan_id") in selected_scan_ids:
                bucket["selected"] += 1
    return out


async def compute_match_status_counts(since_iso: str) -> Dict[str, int]:
    """Informational only — plain observed counts of failed vs
    successful searches (Requirement: 'failed searches', 'successful
    matches')."""
    scan_events = await _fetch(AnalyticsEventType.SCAN_COMPLETED, since_iso)
    counts: Dict[str, int] = {}
    for e in scan_events:
        status = e.get("match_status") or "unknown"
        counts[status] = counts.get(status, 0) + 1
    return counts
