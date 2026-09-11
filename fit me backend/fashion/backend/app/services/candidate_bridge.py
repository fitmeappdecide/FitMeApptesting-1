"""
Candidate to Garment Bridge Service (Phase 3).

Bridges Product Intelligence V2 search candidates into the existing FitMe
PostgreSQL `garments` table for immediate virtual Try-On and size recommendation.

Preserves 100% of the existing `Garment` schema and constraints.
"""
from __future__ import annotations

import logging
import uuid
from typing import Any, Dict, List, Optional

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.garment import Garment
from app.services.garment_analysis import analyse_garment

logger = logging.getLogger(__name__)


async def convert_candidate_to_garment(
    candidate: Dict[str, Any],
    db: AsyncSession,
    brand_id: Optional[uuid.UUID] = None,
) -> Garment:
    """Converts a V2 visual search candidate dictionary into a PostgreSQL Garment record.

    Maps:
    - title / product_name -> Garment.product_name
    - url -> Garment.product_url & Garment.scraped_from_url
    - image_url / images -> Garment.images (list of dicts with {"url": ..., "angle": "front"})
    - category / type -> Garment.garment_type (validated via analyse_garment)
    - size_chart -> Garment.size_chart
    """
    title = candidate.get("title") or candidate.get("product_name") or "Product Intelligence Garment"
    url = candidate.get("url") or candidate.get("source_url") or ""

    raw_images = candidate.get("images") or []
    if not raw_images and candidate.get("image_url"):
        raw_images = [candidate["image_url"]]
    elif not raw_images and candidate.get("image"):
        raw_images = [candidate["image"]]

    normalized_images: List[Dict[str, Any]] = []
    for item in raw_images:
        if isinstance(item, str):
            normalized_images.append({"url": item, "angle": "front"})
        elif isinstance(item, dict) and "url" in item:
            normalized_images.append(item)

    if not normalized_images and candidate.get("url"):
        normalized_images = [{"url": candidate["url"], "angle": "front"}]

    category_hint = candidate.get("category") or candidate.get("garment_type")
    analysis = analyse_garment(title, category_hint, normalized_images)

    raw_size_chart = candidate.get("size_chart") or {
        "S": {"chest": 88, "waist": 76, "shoulder": 38},
        "M": {"chest": 96, "waist": 84, "shoulder": 41},
        "L": {"chest": 104, "waist": 92, "shoulder": 44},
        "XL": {"chest": 112, "waist": 100, "shoulder": 47},
    }

    # Normalize list ranges (e.g., [90, 95]) to midpoint floats for size recommendation engine
    size_chart = {}
    for sz, vals in raw_size_chart.items():
        if isinstance(vals, dict):
            size_chart[sz] = {
                k: (float(sum(v)) / len(v) if isinstance(v, (list, tuple)) and v else float(v) if isinstance(v, (int, float, str)) else v)
                for k, v in vals.items()
            }
        else:
            size_chart[sz] = vals

    garment = Garment(
        brand_id=brand_id,
        product_name=title,
        product_url=url,
        images=normalized_images,
        garment_type=analysis["garment_type"],
        segmentation_masks=analysis["segmentation_masks"],
        fabric_type=analysis["fabric_type"],
        dominant_colours=analysis["dominant_colours"],
        size_chart=size_chart,
        is_ethnic=analysis["is_ethnic"],
        scraped_from_url=url,
    )

    db.add(garment)
    await db.flush()
    logger.info("Successfully converted candidate to Garment: %s (%s)", garment.id, garment.product_name)
    return garment
