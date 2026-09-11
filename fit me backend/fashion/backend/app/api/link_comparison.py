"""
Link Comparison API Router — Dedicated endpoint for URL-originated Exact Product Price Comparisons.
"""
from __future__ import annotations

import logging
from typing import Any, Dict, Optional
import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.models.garment import Garment
from app.models.tryon_job import TryOnJob
from app.schemas.link_comparison import URLProductCompareRequest, URLProductCompareResponse
from services.link_comparison.url_product_comparison_service import get_url_product_comparison_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/link-comparison", tags=["link-comparison"])


@router.post("/compare", response_model=URLProductCompareResponse)
async def compare_link_product(
    payload: URLProductCompareRequest,
    db: AsyncSession = Depends(get_db),
) -> Dict[str, Any]:
    """
    Executes isolated, exact-product price comparison for a URL-originated garment.
    Uses authoritative product metadata extracted from the pasted URL.
    """
    source_url = payload.source_url
    brand = payload.brand
    title = payload.title
    price = payload.price
    original_price = payload.original_price
    image_url = payload.image_url
    retailer = payload.retailer

    # If job_id is provided, load authoritative product metadata from TryOnJob & Garment
    if payload.job_id:
        try:
            job_stmt = select(TryOnJob).where(TryOnJob.id == payload.job_id)
            job_res = await db.execute(job_stmt)
            job = job_res.scalar_one_or_none()

            if job and job.garment_id:
                garment_stmt = select(Garment).where(Garment.id == job.garment_id)
                g_res = await db.execute(garment_stmt)
                garment = g_res.scalar_one_or_none()

                if garment:
                    source_url = getattr(garment, "scraped_from_url", None) or getattr(garment, "product_url", None) or source_url
                    if garment.brand_id:
                        b_stmt = select(Brand).where(Brand.id == garment.brand_id)
                        b_res = await db.execute(b_stmt)
                        b_obj = b_res.scalar_one_or_none()
                        if b_obj and b_obj.name:
                            brand = b_obj.name
                    title = getattr(garment, "product_name", None) or title
                    if garment.images and len(garment.images) > 0:
                        first_img = garment.images[0]
                        image_url = first_img.get("url") if isinstance(first_img, dict) else str(first_img)
        except Exception as e:
            logger.warn(f"[LinkComparison] Error loading job {payload.job_id}: {e}")

    if not title and not source_url:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Either title, source_url, or a valid job_id must be provided for link comparison.",
        )

    svc = get_url_product_comparison_service()
    res = await svc.compare_product(
        source_url=source_url,
        brand=brand,
        title=title,
        price=price,
        original_price=original_price,
        image_url=image_url,
        retailer=retailer,
    )

    return res
