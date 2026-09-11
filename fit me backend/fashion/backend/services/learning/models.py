"""
Learning Engine — models & config (V2 Phase 9).

Built on top of `analytics_events` (V2 Phase 8) — this module defines
NO new event types and writes nothing; it only reads.
"""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from typing import Dict, Optional

# Minimum number of historical observations required before a learned
# statistic is trusted enough to influence ranking at all (Requirement 6).
# Below this, the stat is still computed and shown (Requirement 3 — an
# admin can see "3 clicks, 100% success" as an observed fact) but
# `sufficient=False` and it contributes zero boost.
DEFAULT_MIN_SAMPLES = 20


def min_samples() -> int:
    raw = os.environ.get("LEARNING_MIN_SAMPLES", str(DEFAULT_MIN_SAMPLES))
    try:
        return max(int(raw), 1)
    except ValueError:
        return DEFAULT_MIN_SAMPLES


# How long computed stats are cached in-process before recomputing
# (Requirement: this runs on every scan's ranking step, so recomputing a
# multi-hundred-event aggregation from scratch every time would be both
# wasteful and unnecessary — learned behavior patterns don't meaningfully
# shift scan-to-scan).
def stats_cache_ttl_seconds() -> int:
    raw = os.environ.get("LEARNING_STATS_CACHE_TTL_SECONDS", "300")
    try:
        return max(int(raw), 1)
    except ValueError:
        return 300


# Ranking adjustment is capped small and deliberately (Requirement 5 —
# "do not directly modify ranking weights based on a single user event";
# Requirement 8 — boosts adjust, never override). Expressed in the same
# 0-100 point scale as `confidence`.
MAX_BOOST_POINTS = 3.0


@dataclass
class RetailerStat:
    """Observed fact: how affiliate clicks for this retailer have gone
    historically. `preference_score` is a plain success rate — NOT a
    recommendation by itself; see engine.py for how (and whether) it
    gets used."""
    retailer: str
    total_clicks: int = 0
    successful_clicks: int = 0
    sufficient: bool = False

    @property
    def preference_score(self) -> float:
        return (self.successful_clicks / self.total_clicks) if self.total_clicks else 0.0


@dataclass
class SourceStat:
    """Observed fact: of the candidates that appeared from a given
    discovery source (retail_search / google_vision / brand_search),
    what fraction were the one the user actually selected."""
    source: str
    appearances: int = 0
    selections: int = 0
    sufficient: bool = False

    @property
    def effectiveness_score(self) -> float:
        return (self.selections / self.appearances) if self.appearances else 0.0


@dataclass
class LearnedStats:
    """One snapshot of everything the Learning Engine currently knows,
    as of `computed_at`. Cached in engine.py; see stats_cache_ttl_seconds()."""
    computed_at: str
    window_days: int
    retailer_stats: Dict[str, RetailerStat] = field(default_factory=dict)
    source_stats: Dict[str, SourceStat] = field(default_factory=dict)
    # Informational-only observed facts (Requirement 3 — separated from
    # anything that touches ranking). Never consulted by engine.py's
    # compute_boost(); exposed only via the admin insights endpoint.
    brand_retailer_counts: Dict[str, Dict[str, int]] = field(default_factory=dict)   # brand -> retailer -> count
    strategy_effectiveness: Dict[str, Dict[str, int]] = field(default_factory=dict)  # strategy kind -> {shown, selected}
    match_status_counts: Dict[str, int] = field(default_factory=dict)                # exact/closest/similar/no_matches -> count
