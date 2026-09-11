"""
Learning Engine — core (V2 Phase 9).

The only function `scan_service.py` calls: `apply_learned_ranking(scored,
profile_dict)`. Everything else here supports that or the admin insights
endpoint.

SAFETY CONTRACT (Requirements 5-9 — read this before touching the file):

1. Never raises. Any failure anywhere in this module (bad analytics data,
   storage unavailable, a malformed stat) results in
   `apply_learned_ranking()` returning the INPUT LIST UNCHANGED — the
   existing deterministic Confidence Engine ranking is always the
   fallback, never a broken/partial learned ranking.

2. Never touches a candidate's `confidence` field. `top_confidence` and
   `match_status` in scan_service.py are computed from `confidence` — the
   Learning Engine only ever adds NEW fields (`learned_boost`,
   `adjusted_confidence`) and may REORDER the list. It cannot change
   what confidence value ends up seeding match_status, because it never
   writes to the field that seeds it.

3. Verified-identifier candidates (barcode_match / sku_match /
   style_match / article_match == 1.0 in confidence_breakdown) are
   partitioned OUT before any reordering happens, keep their original
   relative order (which is already the deterministic Confidence
   Engine's ordering), and are placed ahead of every non-identifier
   candidate unconditionally. The Learning Engine's reordering logic
   only ever runs on the remaining (non-identifier) candidates. This is
   what makes "never override a verified identifier match" a structural
   guarantee rather than a hopeful heuristic — see
   `_partition_identifier_verified()`.

4. Hard Filter rejects never reach this module at all — `scored` is
   built from Hard Filter survivors only (scan_service.py), and this
   module has no mechanism to look up or re-admit anything else. There
   is nothing to "protect against" here beyond simply never being given
   rejected candidates in the first place.

5. Boosts are capped at ±MAX_BOOST_POINTS (3.0, out of a 0-100 scale) and
   only apply when the underlying stat has `sufficient=True` (>= the
   configured minimum sample count) — a single click or a single scan
   can never move the needle (Requirement 5/6).
"""
from __future__ import annotations

import logging
import time
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from . import aggregator
from .models import LearnedStats, MAX_BOOST_POINTS, stats_cache_ttl_seconds

logger = logging.getLogger(__name__)

_IDENTIFIER_FIELDS = ("barcode_match", "sku_match", "style_match", "article_match")

_cache: Optional[LearnedStats] = None
_cache_computed_at_monotonic: float = 0.0

_WINDOW_DAYS = 30


def _is_identifier_verified(candidate: Dict[str, Any]) -> bool:
    breakdown = candidate.get("confidence_breakdown") or {}
    return any(float(breakdown.get(f, 0.0) or 0.0) >= 1.0 for f in _IDENTIFIER_FIELDS)


def _partition_identifier_verified(scored: List[Dict[str, Any]]):
    identified = [c for c in scored if _is_identifier_verified(c)]
    others = [c for c in scored if not _is_identifier_verified(c)]
    return identified, others


async def _get_stats(force: bool = False) -> LearnedStats:
    """In-process cache (Requirement: this runs on every scan). Never
    raises — on any aggregation failure, returns (and caches) an empty
    LearnedStats, which makes every downstream boost 0."""
    global _cache, _cache_computed_at_monotonic
    now = time.monotonic()
    if not force and _cache is not None and (now - _cache_computed_at_monotonic) < stats_cache_ttl_seconds():
        return _cache

    since_iso = (datetime.now(timezone.utc) - timedelta(days=_WINDOW_DAYS)).isoformat()
    try:
        retailer_stats = await aggregator.compute_retailer_stats(since_iso)
        source_stats = await aggregator.compute_source_stats(since_iso)
        brand_retailer_counts = await aggregator.compute_brand_retailer_counts(since_iso)
        strategy_effectiveness = await aggregator.compute_strategy_effectiveness(since_iso)
        match_status_counts = await aggregator.compute_match_status_counts(since_iso)
        stats = LearnedStats(
            computed_at=datetime.now(timezone.utc).isoformat(),
            window_days=_WINDOW_DAYS,
            retailer_stats=retailer_stats,
            source_stats=source_stats,
            brand_retailer_counts=brand_retailer_counts,
            strategy_effectiveness=strategy_effectiveness,
            match_status_counts=match_status_counts,
        )
    except Exception as exc:  # noqa: BLE001
        logger.warning("Learning Engine: stats computation failed (%s); using empty/neutral stats.", exc)
        stats = LearnedStats(computed_at=datetime.now(timezone.utc).isoformat(), window_days=_WINDOW_DAYS)

    _cache = stats
    _cache_computed_at_monotonic = now
    return stats


def _candidate_source(candidate: Dict[str, Any]) -> Optional[str]:
    return (candidate.get("raw") or {}).get("provenance", {}).get("source") or candidate.get("strategy")


def compute_boost(candidate: Dict[str, Any], stats: LearnedStats) -> float:
    """Small, capped, sample-gated ranking nudge for ONE candidate.
    Returns 0.0 (neutral — no opinion) whenever either underlying stat is
    insufficient, missing, or the candidate has no retailer/source at
    all. Never raises — a malformed candidate dict just contributes 0."""
    try:
        retailer = candidate.get("retailer")
        source = _candidate_source(candidate)

        retailer_component = 0.0
        if retailer and retailer in stats.retailer_stats:
            rs = stats.retailer_stats[retailer]
            if rs.sufficient:
                retailer_component = rs.preference_score - 0.5  # centered: -0.5..+0.5

        source_component = 0.0
        if source and source in stats.source_stats:
            ss = stats.source_stats[source]
            if ss.sufficient:
                source_component = ss.effectiveness_score - 0.5

        combined = (retailer_component + source_component) / 2.0  # still -0.5..+0.5
        boost = combined * 2 * MAX_BOOST_POINTS  # scale to -MAX_BOOST_POINTS..+MAX_BOOST_POINTS
        return round(max(-MAX_BOOST_POINTS, min(MAX_BOOST_POINTS, boost)), 3)
    except Exception as exc:  # noqa: BLE001
        logger.warning("Learning Engine: compute_boost failed for a candidate (%s); using 0.", exc)
        return 0.0


async def apply_learned_ranking(scored: List[Dict[str, Any]], profile_dict: Dict[str, Any]) -> List[Dict[str, Any]]:
    """See module docstring for the full safety contract. On ANY error,
    returns `scored` completely unmodified (not even copied) — the
    Confidence Engine's ordering stands exactly as computed."""
    if not scored:
        return scored
    try:
        stats = await _get_stats()
        identified, others = _partition_identifier_verified(scored)

        boosted_others = []
        for c in others:
            c2 = dict(c)
            boost = compute_boost(c, stats)
            c2["learned_boost"] = boost
            c2["adjusted_confidence"] = round(c2["confidence"] + boost, 3)
            boosted_others.append(c2)
        boosted_others.sort(key=lambda x: (x["adjusted_confidence"], x.get("ai_score", 0.0)), reverse=True)

        # Identifier-verified candidates are untouched (no learned_boost
        # field at all — makes it visually obvious in a response payload
        # which candidates the Learning Engine was even allowed to
        # consider) and always come first, in their existing order.
        return identified + boosted_others
    except Exception as exc:  # noqa: BLE001
        logger.warning("Learning Engine: apply_learned_ranking failed (%s); falling back to unmodified ranking.", exc)
        return scored


async def get_insights(days: int = 30) -> Dict[str, Any]:
    """Admin-facing (Requirement 11). Forces a fresh computation (not the
    ranking-path cache) so an admin always sees current data, and
    reports EVERYTHING — including sub-threshold stats — clearly labeled,
    per Requirement 3 (observed facts vs what's actually influencing
    ranking)."""
    since_iso = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
    try:
        retailer_stats = await aggregator.compute_retailer_stats(since_iso)
        source_stats = await aggregator.compute_source_stats(since_iso)
        brand_retailer_counts = await aggregator.compute_brand_retailer_counts(since_iso)
        strategy_effectiveness = await aggregator.compute_strategy_effectiveness(since_iso)
        match_status_counts = await aggregator.compute_match_status_counts(since_iso)
    except Exception as exc:  # noqa: BLE001
        logger.warning("Learning Engine: get_insights failed (%s); returning empty stats.", exc)
        retailer_stats, source_stats = {}, {}
        brand_retailer_counts, strategy_effectiveness, match_status_counts = {}, {}, {}

    from .models import min_samples
    return {
        "window_days": days,
        "min_samples_threshold": min_samples(),
        "observed_facts": {
            "retailer_click_stats": {
                r: {"total_clicks": s.total_clicks, "successful_clicks": s.successful_clicks,
                   "preference_score": round(s.preference_score, 3), "sufficient_data": s.sufficient}
                for r, s in retailer_stats.items()
            },
            "source_effectiveness": {
                src: {"appearances": s.appearances, "selections": s.selections,
                     "effectiveness_score": round(s.effectiveness_score, 3), "sufficient_data": s.sufficient}
                for src, s in source_stats.items()
            },
            "brand_retailer_relationships": brand_retailer_counts,
            "search_strategy_effectiveness": strategy_effectiveness,
            "match_status_distribution": match_status_counts,
        },
        "actively_influencing_ranking": {
            # Only these two feed compute_boost() — everything else above
            # is informational-only (Requirement 3).
            "retailers_with_sufficient_data": [r for r, s in retailer_stats.items() if s.sufficient],
            "sources_with_sufficient_data": [src for src, s in source_stats.items() if s.sufficient],
            "max_boost_points": MAX_BOOST_POINTS,
        },
    }


def invalidate_stats_cache() -> None:
    """Forces the next apply_learned_ranking()/get_insights() call to
    recompute rather than use the cached snapshot. Used by the admin
    /admin/learning/refresh-cache endpoint and by tests."""
    global _cache, _cache_computed_at_monotonic
    _cache = None
    _cache_computed_at_monotonic = 0.0
