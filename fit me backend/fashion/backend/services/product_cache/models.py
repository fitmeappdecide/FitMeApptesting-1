"""
Product Cache — Entry schema (V2 Phase 6).

Only verified, ranked results are ever stored — never raw OCR, raw Google
Vision output, raw Gemini responses, failed searches, or unverified
candidates. See CachePhilosophy in ARCHITECTURE.md.
"""
from __future__ import annotations

from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional


@dataclass
class CacheEntry:
    fingerprint_hash: str
    fingerprint_tier: str                 # "identifier" | "descriptive"
    fingerprint_fields: Dict[str, Any]
    cache_version: str                    # fingerprint.CACHE_VERSION at write time
    match_status: str                     # "exact" | "closest"
    top_confidence: float
    profile: Dict[str, Any]               # the StructuredProductProfile that produced this entry
    candidates: List[Dict[str, Any]]      # the final ranked/scored candidate list
    source_retailers: List[str]
    verified_at: str = field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat()
    )
    hit_count: int = 0
    last_hit_at: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)

    @staticmethod
    def from_dict(d: Dict[str, Any]) -> "CacheEntry":
        d = dict(d)
        d.pop("_id", None)
        return CacheEntry(**d)
