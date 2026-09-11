"""
Analytics — event model (V2 Phase 8).

`services/analytics.py` (the pre-Phase-8 `overview`/`by_retailer`/
`top_products`/`trend` implementation `server.py` already imports) was
never provided during any build in this project, same gap as
`services/affiliate.py` was before Phase 7. Those 4 read-only reporting
functions are reimplemented in `service.py` against the new
`analytics_events` collection this phase introduces — see
ARCHITECTURE.md Section 15 for the full note. Everything below is new.
"""
from __future__ import annotations

import hashlib
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from enum import Enum
from typing import Any, Dict, Optional


class AnalyticsEventType(str, Enum):
    SCAN_COMPLETED = "scan_completed"          # a scan finished (success, no_matches, no_strategies, or error)
    PRODUCT_SELECTED = "product_selected"       # user tapped Buy on a specific candidate
    AFFILIATE_CLICK = "affiliate_click"         # affiliate link generation was attempted (success or failure)
    TRYON_SELECTED = "tryon_selected"           # user tapped Try On on a specific candidate
    CONVERSION = "conversion"                   # a confirmed purchase — see service.py; never auto-generated today


# Which fields form each event type's natural idempotency key — see
# service.py::_compute_event_id. Keeps the "what makes two events the
# same event" decision in one visible place instead of scattered logic.
_DEDUPE_KEY_FIELDS: Dict[AnalyticsEventType, tuple] = {
    AnalyticsEventType.SCAN_COMPLETED: ("scan_id",),
    AnalyticsEventType.PRODUCT_SELECTED: ("scan_id", "candidate_id"),
    AnalyticsEventType.AFFILIATE_CLICK: ("click_id",),
    AnalyticsEventType.TRYON_SELECTED: ("scan_id", "candidate_id"),
    AnalyticsEventType.CONVERSION: ("click_id",),
}


@dataclass
class AnalyticsEvent:
    """One row in `analytics_events`. Only `event_type` is truly
    required — every identifier/context field is Optional because not
    every event type carries every field (e.g. a `scan_completed` event
    has no `retailer`; an `affiliate_click` event does)."""
    event_type: AnalyticsEventType
    event_id: str = ""                 # deterministic hash, set by service.py — never set this by hand
    timestamp: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())

    # Reused identifiers (Requirement 2) — never re-derived, always the
    # same values already present on db.scans / db.affiliate_clicks.
    user_id: Optional[str] = None
    scan_id: Optional[str] = None
    candidate_id: Optional[str] = None
    click_id: Optional[str] = None

    # Product context
    retailer: Optional[str] = None
    brand: Optional[str] = None
    category: Optional[str] = None
    match_status: Optional[str] = None

    # Candidate discovery source (Requirement: "candidate discovery
    # sources") — "retail_search" | "google_vision" | "brand_search" for
    # a single-candidate event; a scan_completed event instead carries
    # `source_breakdown` (counts across all final candidates) in `extra`.
    source: Optional[str] = None

    # Affiliate-specific
    provider: Optional[str] = None       # e.g. "AmazonAffiliateProvider"
    success: Optional[bool] = None       # affiliate generation outcome
    error: Optional[str] = None

    # Small, event-specific extras that don't warrant their own column
    # (e.g. scan_completed's source_breakdown, top_confidence). Kept
    # deliberately small — this is an event log, not a document store.
    extra: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        d = asdict(self)
        d["event_type"] = self.event_type.value
        return d

    @staticmethod
    def from_dict(d: Dict[str, Any]) -> "AnalyticsEvent":
        d = dict(d)
        d.pop("_id", None)
        d["event_type"] = AnalyticsEventType(d["event_type"])
        return AnalyticsEvent(**d)


def compute_event_id(event_type: AnalyticsEventType, fields: Dict[str, Any]) -> str:
    """Deterministic idempotency key: same event_type + same natural key
    fields -> same event_id, so recording "the same" event twice (a
    retried request, a double-tap) is a no-op rather than a duplicate
    row. Falls back to including ALL provided identifier fields if the
    event type's declared key fields are missing (better an over-wide
    key than silently colliding unrelated events)."""
    key_fields = _DEDUPE_KEY_FIELDS.get(event_type, ())
    parts = [event_type.value]
    used_any = False
    for k in key_fields:
        v = fields.get(k)
        if v:
            parts.append(f"{k}={v}")
            used_any = True
    if not used_any:
        # No natural key available (e.g. a malformed/minimal event) —
        # every field goes in, so at least identical calls dedupe.
        for k in sorted(fields.keys()):
            if fields[k] is not None:
                parts.append(f"{k}={fields[k]}")
    payload = "|".join(parts)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()
