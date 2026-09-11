"""
Affiliate Service — models (V2 Phase 7).

`services/affiliate.py` (the pre-Phase-7 `affiliate_wrap`/`resolved_tags`/
`_TAG_SPEC` implementation `server.py` already imports) was never provided
during this build, and per explicit product decision this phase builds the
Affiliate Service FRESH rather than reverse-engineering it — see
ARCHITECTURE.md Section 14 for the full note. Everything below is new.
"""
from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Any, Dict, Optional


@dataclass
class AffiliateResult:
    """What every provider returns, and what the service layer hands back
    to `server.py`. Never contains a credential value directly — only a
    finished URL (which necessarily embeds a tag/id, same as any real
    affiliate link) or `generated=False` with a machine-readable `error`."""
    retailer: str
    original_url: str
    affiliate_url: Optional[str]
    generated: bool
    provider: str                 # provider class name, e.g. "AmazonAffiliateProvider"
    expires_at: Optional[str]     # ISO timestamp, or None (persistent / session-based / not generated)
    tracking_id: Optional[str]    # click_id, assigned by the service layer, not the provider
    error: Optional[str] = None   # machine-readable reason when generated=False

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)
