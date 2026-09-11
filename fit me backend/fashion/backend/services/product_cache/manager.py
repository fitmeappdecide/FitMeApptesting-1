"""
Product Cache — Manager (V2 Phase 6).

The only module `scan_service.py` talks to. Two calls total:

    cache_result = await lookup(profile_dict)
    if cache_result is not None:
        ... skip Candidate Acquisition..Confidence Engine, return it ...
    ...
    await populate(profile_dict, match_status, top_confidence, candidates)

Every function here is safe to call unconditionally — on any internal
failure (bad fingerprint, storage unavailable, etc.) `lookup()` returns
None (= "treat as miss, run the full pipeline") and `populate()` is a
no-op. A cache problem must never turn into a scan failure.
"""
from __future__ import annotations

import logging
import time
from typing import Any, Dict, List, Optional

from . import database
from .fingerprint import CACHE_VERSION, compute_fingerprint
from .models import CacheEntry

logger = logging.getLogger(__name__)

# Only these match_status values represent a verified-enough result to
# cache (Cache Population: "only after verification, ranking, and
# confidence calculation" + the product decision that both exact (>=95)
# and closest (>=80) match tiers are worth caching, not just exact).
CACHEABLE_MATCH_STATUSES = ("exact", "closest")


class _Metrics:
    """Process-local counters. Reset on restart — fine for the admin
    /cache-stats endpoint's purpose (recent operational visibility), not
    meant to be a durable analytics store (that's a later phase)."""
    def __init__(self) -> None:
        self.hits = 0
        self.misses = 0
        self.errors = 0
        self.total_lookup_ms = 0.0

    def record_lookup(self, hit: bool, elapsed_ms: float) -> None:
        if hit:
            self.hits += 1
        else:
            self.misses += 1
        self.total_lookup_ms += elapsed_ms

    def to_dict(self) -> Dict[str, Any]:
        total = self.hits + self.misses
        return {
            "hits": self.hits,
            "misses": self.misses,
            "errors": self.errors,
            "hit_rate": round(self.hits / total, 4) if total else 0.0,
            "avg_lookup_ms": round(self.total_lookup_ms / total, 2) if total else 0.0,
        }


_metrics = _Metrics()


async def lookup(profile_dict: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """Returns the cached entry dict on a hit, or None on a miss/error/
    ineligible profile. Never raises."""
    started = time.time()
    try:
        fp = compute_fingerprint(profile_dict)
        if fp is None:
            # Not enough signal on the profile to cache safely — treat as
            # a miss, same as any other case where we fall through to the
            # full pipeline.
            _metrics.record_lookup(hit=False, elapsed_ms=(time.time() - started) * 1000)
            return None

        entry = await database.get_entry(fp.hash)
        elapsed_ms = (time.time() - started) * 1000

        if entry is None:
            _metrics.record_lookup(hit=False, elapsed_ms=elapsed_ms)
            return None

        if entry.get("cache_version") != CACHE_VERSION:
            # Stale schema/normalization — don't serve it, and don't
            # bother deleting it here; clear_by_version() (admin-triggered
            # or a future scheduled job) handles bulk cleanup.
            _metrics.record_lookup(hit=False, elapsed_ms=elapsed_ms)
            return None

        _metrics.record_lookup(hit=True, elapsed_ms=elapsed_ms)
        await database.record_hit(fp.hash)
        return entry
    except Exception as exc:  # noqa: BLE001
        logger.warning("Product Cache: lookup() failed unexpectedly (%s); falling through to full pipeline.", exc)
        _metrics.errors += 1
        return None


async def populate(profile_dict: Dict[str, Any], match_status: str, top_confidence: float,
                   candidates: List[Dict[str, Any]]) -> bool:
    """Stores a verified result. No-op (returns False) if match_status
    isn't cacheable, the profile has too little signal to fingerprint, or
    storage is unavailable. Never raises."""
    if match_status not in CACHEABLE_MATCH_STATUSES:
        return False
    try:
        fp = compute_fingerprint(profile_dict)
        if fp is None:
            return False

        source_retailers = sorted({
            c.get("retailer") for c in candidates if c.get("retailer")
        })
        entry = CacheEntry(
            fingerprint_hash=fp.hash,
            fingerprint_tier=fp.tier,
            fingerprint_fields=fp.fields,
            cache_version=CACHE_VERSION,
            match_status=match_status,
            top_confidence=top_confidence,
            profile=profile_dict,
            candidates=candidates,
            source_retailers=source_retailers,
        )
        return await database.put_entry(entry.to_dict())
    except Exception as exc:  # noqa: BLE001
        logger.warning("Product Cache: populate() failed unexpectedly (%s); result was not cached.", exc)
        return False


async def stats() -> Dict[str, Any]:
    entry_count = await database.count_entries()
    return {"entry_count": entry_count, "cache_version": CACHE_VERSION, **_metrics.to_dict()}


async def debug_lookup(profile_dict: Dict[str, Any]) -> Dict[str, Any]:
    """Admin-only: shows what fingerprint a profile WOULD produce and
    whether it currently hits, without affecting metrics or requiring a
    real scan."""
    fp = compute_fingerprint(profile_dict)
    if fp is None:
        return {"fingerprint": None, "reason": "insufficient signal to cache"}
    entry = await database.get_entry(fp.hash)
    return {
        "fingerprint_hash": fp.hash,
        "fingerprint_tier": fp.tier,
        "fingerprint_fields": fp.fields,
        "cache_hit": entry is not None,
        "entry": entry,
    }


async def clear(version_only: bool = False) -> int:
    if version_only:
        return await database.clear_by_version(CACHE_VERSION)
    return await database.clear_all()
