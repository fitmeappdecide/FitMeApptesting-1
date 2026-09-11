"""
Product Cache — Fingerprint Hashing (V2 Phase 6).

Builds a deterministic cache key from the existing Product Fingerprint
(`StructuredProductProfile` / `profile_to_dict()` in `services/product_intelligence.py`).
No new fingerprint model is introduced — this module only normalizes and
hashes the fields that already exist on the profile.

Two-tier key strategy, deliberately mirroring the identifier-vs-semantic
priority `adapters/registry.py::run_all_adapters` already uses for retail
search (Evidence Engine Spec, Section 4):

  Tier 1 (IDENTIFIER) — if the profile carries a barcode/QR, SKU, style
  number, article number, or model number, the key is built from
  identifiers ONLY. Two scans of the same physical product should collide
  on their barcode even if OCR/vision produced slightly different color or
  pattern text between scans — identifiers are the strongest signal and
  should dominate.

  Tier 2 (DESCRIPTIVE) — no identifier present. Falls back to normalized
  descriptive attributes (brand, category, subcategory, gender, color,
  pattern, fit, material, sleeve, fabric). This is a weaker, "near-identical
  product" key — two different physical items with identical descriptive
  attributes and no identifiers WILL collide. This is an accepted trade-off
  of descriptive-only fingerprinting; see ARCHITECTURE.md.

`CACHE_VERSION` is embedded in the hash so that any future change to this
normalization/field logic automatically invalidates all previously-stored
entries (Cache Invalidation — version invalidation).
"""
from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass
from typing import Any, Dict, List, Optional

# Bump this whenever normalization rules, field selection, or the
# StructuredProductProfile schema change in a way that should invalidate
# previously-cached entries.
CACHE_VERSION = "v1"

_WS_RE = re.compile(r"\s+")
_PUNCT_RE = re.compile(r"[^a-z0-9]+")


def _norm_str(value: Optional[str]) -> str:
    """Lowercase, strip, and collapse punctuation/whitespace. Never raises —
    non-string input just becomes ''."""
    if not value or not isinstance(value, str):
        return ""
    s = value.lower().strip()
    s = _PUNCT_RE.sub(" ", s)
    s = _WS_RE.sub(" ", s).strip()
    return s


def _norm_list(values: Optional[List[str]]) -> List[str]:
    if not values:
        return []
    cleaned = sorted({_norm_str(v) for v in values if _norm_str(v)})
    return cleaned


@dataclass
class Fingerprint:
    """The normalized, hashable representation of a cache key. `tier`
    and `fields` are kept on the object (and in the cache entry) purely
    for admin/debug visibility — the hash is what's actually used as the
    lookup key."""
    tier: str  # "identifier" | "descriptive"
    fields: Dict[str, Any]
    hash: str


def _hash_payload(tier: str, fields: Dict[str, Any]) -> str:
    # Deterministic: sort keys, join with a delimiter that can't collide
    # with normalized values (normalization strips '|').
    parts = [CACHE_VERSION, tier] + [
        f"{k}={fields[k]}" for k in sorted(fields.keys())
    ]
    payload = "|".join(parts)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def compute_fingerprint(profile_dict: Dict[str, Any]) -> Optional[Fingerprint]:
    """Returns None if the profile has too little signal to safely cache
    (e.g. brand AND category both missing) — caching a near-empty
    fingerprint risks collapsing unrelated products onto the same key."""
    brand = _norm_str(profile_dict.get("brand"))
    category = _norm_str(profile_dict.get("category"))

    identifiers = {
        "barcode": ",".join(_norm_list(profile_dict.get("barcodes"))),
        "sku": _norm_str(profile_dict.get("sku")),
        "style_number": _norm_str(profile_dict.get("style_number")),
        "article_number": _norm_str(profile_dict.get("article_number")),
        "model_number": _norm_str(profile_dict.get("model_number")),
    }
    has_identifier = any(identifiers.values())

    if has_identifier:
        fields = {"brand": brand, **{k: v for k, v in identifiers.items() if v}}
        return Fingerprint(tier="identifier", fields=fields,
                           hash=_hash_payload("identifier", fields))

    if not brand and not category:
        return None  # not enough signal to cache safely

    fields = {
        "brand": brand,
        "category": category,
        "subcategory": _norm_str(profile_dict.get("subcategory")),
        "gender": _norm_str(profile_dict.get("gender")),
        "color": _norm_str(profile_dict.get("color")),
        "pattern": _norm_str(profile_dict.get("pattern")),
        "fit": _norm_str(profile_dict.get("fit")),
        "material": _norm_str(profile_dict.get("material") or profile_dict.get("fabric_type")),
        "sleeve_type": _norm_str(profile_dict.get("sleeve_type")),
    }
    return Fingerprint(tier="descriptive", fields=fields,
                       hash=_hash_payload("descriptive", fields))
