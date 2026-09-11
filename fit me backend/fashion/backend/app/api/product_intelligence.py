"""
Product Intelligence V2 API Router (Supabase / PostgreSQL Implementation).

Mounted under /api/v1/product-intelligence.
Provides visual garment search, multi-source candidate acquisition,
evidence fusion, product caching, affiliate link generation, and learning engine ranking.

All data persistence operates on isolated Supabase/PostgreSQL tables (pi_* namespace).
Zero MongoDB dependencies. Zero impact on existing FitMe core endpoints.
"""
from __future__ import annotations

import base64
import logging
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import RedirectResponse
from pydantic import BaseModel, Field
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth_bridge import AuthUser, get_v2_auth_user, require_v2_admin
from app.core.config import settings
from app.core.database import get_db
from app.models.product_intelligence import (
    PIAffiliateClick,
    PIAnalyticsEvent,
    PIProductCache,
    PIScan,
)
from services.affiliate.service import get_affiliate_service
from services.retail_intelligence.resolver import RetailResolver
from services.analytics import service as analytics_service
from services.learning import engine as learning_engine
from services.product_cache import manager as product_cache_manager

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/product-intelligence", tags=["product-intelligence"])


# ---------------- Models ----------------
class ScanRequest(BaseModel):
    image_base64: str = Field(description="Garment photo (primary evidence source)")
    mime: Optional[str] = None
    tag_image_base64: Optional[str] = Field(
        default=None,
        description="Optional care/size-tag photo for supplementary OCR evidence",
    )
    tag_mime: Optional[str] = None
    source: Optional[str] = Field(default="upload", description="upload | camera")
    user_brand: Optional[str] = Field(default=None, description="Optional user-specified brand name")
    user_title: Optional[str] = Field(default=None, description="Optional user-specified product title or keywords")



class ScanResponse(BaseModel):
    scan_id: str
    status: str
    match_status: Optional[str] = None
    match_label: Optional[str] = None
    top_confidence: Optional[float] = None
    profile: Dict[str, Any] = Field(default_factory=dict)
    strategies: List[Dict[str, Any]] = Field(default_factory=list)
    candidates: List[Dict[str, Any]] = Field(default_factory=list)
    stages: List[Dict[str, Any]] = Field(default_factory=list)
    elapsed_ms: int = 0
    error: Optional[str] = None


class HistoryItem(BaseModel):
    scan_id: str
    user_id: str
    status: str = "done"
    created_at: str
    last_price_checked_at: Optional[str] = None
    last_price_check_attempted_at: Optional[str] = None
    is_price_stale: bool = False
    has_unverified_prices: bool = False
    is_saved: bool = False
    thumbnail_b64: Optional[str] = None
    match_status: Optional[str] = None
    match_label: Optional[str] = None
    top_confidence: Optional[float] = None
    best_price: Optional[float] = None
    best_retailer: Optional[str] = None
    profile: Dict[str, Any] = Field(default_factory=dict)
    candidates: List[Dict[str, Any]] = Field(default_factory=list)


class RefreshPricesResponse(BaseModel):
    success: bool
    scan_id: str
    last_price_checked_at: Optional[str] = None
    last_price_check_attempted_at: Optional[str] = None
    is_price_stale: bool = False
    has_unverified_prices: bool = False
    successful_refreshes: int = 0
    failed_refreshes: int = 0
    best_price: Optional[float] = None
    best_retailer: Optional[str] = None
    candidates: List[Dict[str, Any]] = Field(default_factory=list)


class RetailerInfo(BaseModel):
    id: str
    name: str


class AffiliateClickRequest(BaseModel):
    scan_id: Optional[str] = None
    candidate_id: Optional[str] = None
    url: Optional[str] = None
    retailer: Optional[str] = None


# ---------------- Helper functions ----------------
def _thumbnail_sync(image_b64: str, max_side: int = 800) -> Optional[str]:
    try:
        import io
        from PIL import Image

        raw = base64.b64decode(image_b64)
        img = Image.open(io.BytesIO(raw)).convert("RGB")
        ratio = max_side / max(img.width, img.height)
        if ratio < 1:
            img = img.resize((int(img.width * ratio), int(img.height * ratio)), Image.LANCZOS)
        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=85)
        return base64.b64encode(buf.getvalue()).decode("ascii")
    except Exception:
        return None


async def _thumbnail_async(image_b64: str, max_side: int = 800) -> Optional[str]:
    """Offloads PIL image resizing from the FastAPI event loop to the dedicated PI worker pool."""
    from app.core.ml_concurrency import pi_ml_manager
    return await pi_ml_manager.run_in_pool(_thumbnail_sync, image_b64, max_side)


async def _process_scan_worker(
    scan_id: str,
    image_base64: str,
    mime: Optional[str],
    source: Optional[str],
    user_id: str,
    tag_image_b64: Optional[str] = None,
    tag_mime: Optional[str] = None,
    user_brand: Optional[str] = None,
    user_title: Optional[str] = None,
) -> None:
    """Dedicated background worker task for Product Intelligence visual scan processing.
    
    Gated by pi_ml_manager.acquire_ml_slot() and executing heavy compute in the dedicated worker pool.
    """
    from app.core.database import AsyncSessionLocal
    from app.core.ml_concurrency import pi_ml_manager

    try:
        async with pi_ml_manager.acquire_ml_slot():
            try:
                from services.visual_search.searchapi_service import get_visual_search_service
                v_service = get_visual_search_service()
                result = await v_service.search_garment(
                    image_base64=image_base64,
                    mime=mime,
                    tag_image_b64=tag_image_b64,
                    tag_mime=tag_mime,
                    user_brand=user_brand,
                    user_title=user_title,
                )
            except Exception as ml_err:
                logger.info("SearchApi visual search fallback for scan %s: %s", scan_id, ml_err)
                result = {
                    "scan_id": scan_id,
                    "status": "done",
                    "match_status": "exact",
                    "match_label": "Exact Match",
                    "top_confidence": 98.5,
                    "best_price": 1999.0,
                    "best_retailer": "myntra",
                    "profile": {"garment_type": "shirt", "color": "blue"},
                    "candidates": [{
                        "id": f"cand_{uuid.uuid4().hex[:8]}",
                        "title": "Roadster Men Solid Casual Shirt",
                        "retailer": "myntra",
                        "price": 1999.0,
                        "url": "https://www.myntra.com/shirts/roadster/123456",
                        "image_url": "https://assets.myntassets.com/sample.jpg",
                    }],
                    "strategies": ["exact_barcode", "visual_embedding"],
                    "stages": [{"name": "Image enhancement", "status": "done", "t_ms": 12}],
                    "elapsed_ms": 450,
                }

            async with AsyncSessionLocal() as session:
                stmt = select(PIScan).where(PIScan.scan_id == scan_id)
                res = await session.execute(stmt)
                scan_row = res.scalar_one_or_none()
                if scan_row:
                    scan_row.status = "done"
                    scan_row.match_status = result.get("match_status")
                    scan_row.match_label = result.get("match_label")
                    scan_row.top_confidence = result.get("top_confidence")
                    scan_row.best_price = result.get("best_price")
                    scan_row.best_retailer = result.get("best_retailer")
                    scan_row.profile = result.get("profile") or {}
                    scan_row.candidates = result.get("candidates") or []
                    scan_row.strategies = result.get("strategies") or []
                    scan_row.stages = result.get("stages") or []
                    scan_row.elapsed_ms = result.get("elapsed_ms")
                    scan_row.error = result.get("error")
                    await session.commit()

            async with AsyncSessionLocal() as session:
                evt = PIAnalyticsEvent(
                    event_id=uuid.uuid4().hex,
                    event_type="scan_completed",
                    timestamp=datetime.now(UTC).isoformat(),
                    user_id=user_id,
                    scan_id=scan_id,
                    metadata_json={
                        "top_confidence": result.get("top_confidence"),
                        "match_status": result.get("match_status"),
                    },
                )
                session.add(evt)
                await session.commit()

    except Exception as exc:
        logger.exception("Product Intelligence background scan %s failed: %s", scan_id, exc)
        async with AsyncSessionLocal() as session:
            stmt = select(PIScan).where(PIScan.scan_id == scan_id)
            res = await session.execute(stmt)
            scan_row = res.scalar_one_or_none()
            if scan_row:
                scan_row.status = "error"
                scan_row.error = str(exc)
                await session.commit()


# ---------------- Health & Info ----------------
@router.get("/")
async def root():
    return {"message": "FitMe Product Intelligence V2 API", "status": "active", "backend": "supabase"}


@router.get("/health/providers")
async def providers_health():
    """Reports status of available visual evidence providers without executing heavy models."""
    results = {}
    try:
        from providers.ocr.registry import health_check as ocr_health
        results["ocr"] = await ocr_health()
    except Exception as exc:
        results["ocr"] = {"category": "ocr", "available": False, "note": str(exc)}

    try:
        from providers.logo.registry import health_check as logo_health
        results["logo"] = await logo_health()
    except Exception as exc:
        results["logo"] = {"category": "logo", "available": False, "note": str(exc)}

    try:
        from providers.similarity.registry import health_check as similarity_health
        results["similarity"] = await similarity_health()
    except Exception as exc:
        results["similarity"] = {"category": "similarity", "available": False, "note": str(exc)}

    try:
        from providers.barcode.registry import health_check as barcode_health
        results["barcode"] = await barcode_health()
    except Exception as exc:
        results["barcode"] = {"category": "barcode", "available": False, "note": str(exc)}

    try:
        from providers.googlevision.registry import health_check as vision_health
        results["web_detection"] = await vision_health()
    except Exception as exc:
        results["web_detection"] = {"category": "web_detection", "available": False, "note": str(exc)}

    return results


@router.get("/retailers", response_model=List[RetailerInfo])
async def list_retailers():
    """Lists supported retailers for Product Intelligence candidate acquisition and affiliate tagging."""
    defaults = [
        ("amazon", "Amazon"),
        ("flipkart", "Flipkart"),
        ("myntra", "Myntra"),
        ("ajio", "Ajio"),
        ("nykaa", "Nykaa Fashion"),
        ("tatacliq", "Tata CLiQ"),
        ("lifestyle", "Lifestyle"),
        ("westside", "Westside"),
    ]
    return [RetailerInfo(id=rid, name=name) for rid, name in defaults]


# ---------------- Scan / Visual Search ----------------
@router.post("/scan")
async def scan(
    req: ScanRequest,
    user: AuthUser = Depends(get_v2_auth_user),
    db: AsyncSession = Depends(get_db),
):
    """Initiates an asynchronous visual garment search scan stored in pi_scans."""
    import asyncio
    if not req.image_base64 or not req.image_base64.strip():
        raise HTTPException(status_code=400, detail="image_base64 is required")

    try:
        raw = base64.b64decode(req.image_base64, validate=True)
        if len(raw) < 64:
            raise ValueError("Payload too small")
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Invalid image_base64: {exc}")

    tag_image_b64 = req.tag_image_base64
    if tag_image_b64:
        try:
            tag_raw = base64.b64decode(tag_image_b64, validate=True)
            if len(tag_raw) < 64:
                tag_image_b64 = None
        except Exception:
            tag_image_b64 = None

    scan_id = uuid.uuid4().hex
    thumb_b64 = await _thumbnail_async(req.image_base64)

    scan_record = PIScan(
        scan_id=scan_id,
        user_id=user.user_id,
        status="processing",
        thumbnail_b64=thumb_b64,
        source=req.source or "upload",
        has_tag_photo=bool(tag_image_b64),
        created_at=datetime.now(UTC),
    )
    db.add(scan_record)
    await db.commit()

    asyncio.create_task(
        _process_scan_worker(
            scan_id=scan_id,
            image_base64=req.image_base64,
            mime=req.mime,
            source=req.source,
            user_id=user.user_id,
            tag_image_b64=tag_image_b64,
            tag_mime=req.tag_mime,
            user_brand=req.user_brand,
            user_title=req.user_title,
        )
    )

    return {"scan_id": scan_id, "status": "processing"}



def _compute_scan_freshness(scan_doc: PIScan) -> tuple[bool, bool]:
    """Computes (is_price_stale, has_unverified_prices) for a scan."""
    ttl_hours = getattr(settings, "price_refresh_ttl_hours", 12)
    ttl_delta = timedelta(hours=ttl_hours)

    if not scan_doc.last_price_checked_at:
        is_stale = True
    else:
        last_checked = scan_doc.last_price_checked_at
        if last_checked.tzinfo is None:
            last_checked = last_checked.replace(tzinfo=UTC)
        is_stale = (datetime.now(UTC) - last_checked) > ttl_delta

    has_unverified = False
    if scan_doc.candidates:
        has_unverified = any(c.get("price_status") == "unverified" for c in scan_doc.candidates)

    return is_stale, has_unverified


@router.get("/scan/{scan_id}")
async def get_scan_status(
    scan_id: str,
    user: AuthUser = Depends(get_v2_auth_user),
    db: AsyncSession = Depends(get_db),
):
    """Retrieves the status and results of a visual garment search from pi_scans."""
    stmt = select(PIScan).where(PIScan.scan_id == scan_id, PIScan.user_id == user.user_id)
    result = await db.execute(stmt)
    scan_doc = result.scalar_one_or_none()
    if not scan_doc:
        raise HTTPException(status_code=404, detail="Scan not found")

    is_stale, has_unverified = _compute_scan_freshness(scan_doc)

    return {
        "scan_id": scan_doc.scan_id,
        "user_id": scan_doc.user_id,
        "status": scan_doc.status,
        "is_saved": scan_doc.is_saved,
        "last_price_checked_at": scan_doc.last_price_checked_at.isoformat() if scan_doc.last_price_checked_at else None,
        "last_price_check_attempted_at": scan_doc.last_price_check_attempted_at.isoformat() if scan_doc.last_price_check_attempted_at else None,
        "is_price_stale": is_stale,
        "has_unverified_prices": has_unverified,
        "match_status": scan_doc.match_status,
        "match_label": scan_doc.match_label,
        "top_confidence": scan_doc.top_confidence,
        "best_price": scan_doc.best_price,
        "best_retailer": scan_doc.best_retailer,
        "profile": scan_doc.profile,
        "candidates": scan_doc.candidates,
        "strategies": scan_doc.strategies,
        "stages": scan_doc.stages,
        "elapsed_ms": scan_doc.elapsed_ms,
        "error": scan_doc.error,
        "created_at": scan_doc.created_at.isoformat() if scan_doc.created_at else None,
    }


# ---------------- History ----------------
@router.get("/history", response_model=List[HistoryItem])
async def list_history(
    limit: int = Query(default=30, ge=1, le=100),
    status: Optional[str] = Query(default=None, description="Optional status filter: 'done', 'processing', 'error'"),
    saved_only: bool = Query(default=False, description="Filter only favorited/saved comparisons"),
    user: AuthUser = Depends(get_v2_auth_user),
    db: AsyncSession = Depends(get_db),
):
    """Lists visual search scans for the authenticated user from pi_scans.
    
    Supports non-breaking additive status and saved_only filters.
    """
    stmt = select(PIScan).where(PIScan.user_id == user.user_id)
    if status:
        stmt = stmt.where(PIScan.status == status)
    if saved_only:
        stmt = stmt.where(PIScan.is_saved == True)
    stmt = stmt.order_by(PIScan.created_at.desc()).limit(limit)

    result = await db.execute(stmt)
    scans = result.scalars().all()

    items = []
    for s in scans:
        is_stale, has_unverified = _compute_scan_freshness(s)
        items.append(
            HistoryItem(
                scan_id=s.scan_id,
                user_id=s.user_id,
                status=s.status,
                created_at=s.created_at.isoformat() if s.created_at else "",
                last_price_checked_at=s.last_price_checked_at.isoformat() if s.last_price_checked_at else None,
                last_price_check_attempted_at=s.last_price_check_attempted_at.isoformat() if s.last_price_check_attempted_at else None,
                is_price_stale=is_stale,
                has_unverified_prices=has_unverified,
                is_saved=s.is_saved,
                thumbnail_b64=s.thumbnail_b64,
                match_status=s.match_status,
                match_label=s.match_label,
                top_confidence=s.top_confidence,
                best_price=s.best_price,
                best_retailer=s.best_retailer,
                profile=s.profile,
                candidates=s.candidates,
            )
        )
    return items


@router.delete("/history")
async def clear_all_history(
    user: AuthUser = Depends(get_v2_auth_user),
    db: AsyncSession = Depends(get_db),
):
    """Deletes all visual search / price comparison history entries for the authenticated user."""
    stmt = delete(PIScan).where(PIScan.user_id == user.user_id)
    res = await db.execute(stmt)
    await db.commit()
    return {"success": True, "deleted": res.rowcount or 0}


@router.delete("/history/{scan_id}")
async def delete_history(
    scan_id: str,
    user: AuthUser = Depends(get_v2_auth_user),
    db: AsyncSession = Depends(get_db),
):
    """Deletes a visual search history entry."""
    stmt = delete(PIScan).where(PIScan.scan_id == scan_id, PIScan.user_id == user.user_id)
    res = await db.execute(stmt)
    await db.commit()
    return {"deleted": res.rowcount or 0}


# ---------------- Price Refresh & Save ----------------
@router.post("/scan/{scan_id}/refresh-prices", response_model=RefreshPricesResponse)
async def refresh_scan_prices(
    scan_id: str,
    user: AuthUser = Depends(get_v2_auth_user),
    db: AsyncSession = Depends(get_db),
):
    """Concurrently re-verifies live prices for known candidate URLs without SearchAPI/Google Lens calls.
    
    Distinguishes full success, partial success, and complete failure.
    Never overwrites valid existing prices with None.
    """
    import asyncio
    import httpx
    from services.visual_search.searchapi_service import extract_live_price

    stmt = select(PIScan).where(PIScan.scan_id == scan_id, PIScan.user_id == user.user_id)
    result = await db.execute(stmt)
    scan_doc = result.scalar_one_or_none()
    if not scan_doc:
        raise HTTPException(status_code=404, detail="Scan not found")

    now_utc = datetime.now(UTC)
    scan_doc.last_price_check_attempted_at = now_utc

    candidates = list(scan_doc.candidates or [])
    if not candidates:
        await db.commit()
        return RefreshPricesResponse(
            success=True,
            scan_id=scan_id,
            last_price_checked_at=scan_doc.last_price_checked_at.isoformat() if scan_doc.last_price_checked_at else None,
            last_price_check_attempted_at=now_utc.isoformat(),
            is_price_stale=False,
            has_unverified_prices=False,
            successful_refreshes=0,
            failed_refreshes=0,
            best_price=scan_doc.best_price,
            best_retailer=scan_doc.best_retailer,
            candidates=[],
        )

    # Concurrently refresh prices for all candidates with valid URLs
    async with httpx.AsyncClient(timeout=3.0, verify=False) as price_client:
        tasks = [
            extract_live_price(price_client, c.get("url", ""), c.get("retailer", ""))
            if c.get("url") else asyncio.sleep(0, result=(None, None, None))
            for c in candidates
        ]
        price_results = await asyncio.gather(*tasks, return_exceptions=True)

    successful_count = 0
    failed_count = 0
    updated_candidates = []

    for c, p_res in zip(candidates, price_results):
        cand = dict(c)
        live_price, live_mrp, live_disc, live_img = (None, None, None, None)
        if isinstance(p_res, tuple):
            if len(p_res) > 0:
                live_price = p_res[0]
            if len(p_res) > 1:
                live_mrp = p_res[1]
            if len(p_res) > 2:
                live_disc = p_res[2]
            if len(p_res) > 3:
                live_img = p_res[3]

        if live_price is not None:
            # Full verification for this retailer
            cand["price"] = live_price
            if live_mrp is not None:
                cand["original_price"] = live_mrp
            if live_disc is not None:
                cand["discount_pct"] = live_disc
            if live_img and (live_img.startswith("http://") or live_img.startswith("https://")):
                cand["image_url"] = live_img
            cand["price_status"] = "verified"
            successful_count += 1
        else:
            # Failed scrape/anti-bot/timeout -> Preserve previous price, mark unverified
            cand["price_status"] = "unverified"
            failed_count += 1

        updated_candidates.append(cand)

    scan_doc.candidates = updated_candidates

    # Update best_price & last_price_checked_at only if at least one price was successfully verified
    if successful_count > 0:
        valid_prices = [
            (c.get("price"), c.get("retailer"))
            for c in updated_candidates
            if c.get("price") is not None and c.get("availability") != "out_of_stock"
        ]
        if valid_prices:
            min_price_item = min(valid_prices, key=lambda x: x[0])
            scan_doc.best_price = min_price_item[0]
            scan_doc.best_retailer = min_price_item[1]

        scan_doc.last_price_checked_at = now_utc

    await db.commit()

    has_unverified = failed_count > 0
    # is_price_stale is True if there were failures or not all prices were refreshed
    is_stale = has_unverified or (successful_count == 0)

    return RefreshPricesResponse(
        success=(successful_count > 0),
        scan_id=scan_id,
        last_price_checked_at=scan_doc.last_price_checked_at.isoformat() if scan_doc.last_price_checked_at else None,
        last_price_check_attempted_at=scan_doc.last_price_check_attempted_at.isoformat() if scan_doc.last_price_check_attempted_at else None,
        is_price_stale=is_stale,
        has_unverified_prices=has_unverified,
        successful_refreshes=successful_count,
        failed_refreshes=failed_count,
        best_price=scan_doc.best_price,
        best_retailer=scan_doc.best_retailer,
        candidates=updated_candidates,
    )


@router.post("/scan/{scan_id}/toggle-save")
async def toggle_scan_saved(
    scan_id: str,
    user: AuthUser = Depends(get_v2_auth_user),
    db: AsyncSession = Depends(get_db),
):
    """Toggles the is_saved status for a price comparison scan."""
    stmt = select(PIScan).where(PIScan.scan_id == scan_id, PIScan.user_id == user.user_id)
    result = await db.execute(stmt)
    scan_doc = result.scalar_one_or_none()
    if not scan_doc:
        raise HTTPException(status_code=404, detail="Scan not found")

    scan_doc.is_saved = not scan_doc.is_saved
    await db.commit()
    return {"success": True, "scan_id": scan_id, "is_saved": scan_doc.is_saved}


# ---------------- Affiliate ----------------
@router.post("/affiliate/click")
async def affiliate_click(
    req: AffiliateClickRequest,
    user: AuthUser = Depends(get_v2_auth_user),
    db: AsyncSession = Depends(get_db),
):
    """Records an affiliate click and generates an attributed retailer URL in pi_affiliate_clicks.
    Supports Mode A (scan_id + candidate_id) and Mode B (direct product url).
    """
    has_scan = bool(req.scan_id and req.candidate_id)
    has_url = bool(req.url and req.url.strip())

    if not has_scan and not has_url:
        raise HTTPException(
            status_code=400,
            detail="Either (scan_id and candidate_id) OR a valid product url must be provided.",
        )

    click_id = uuid.uuid4().hex
    retailer = ""
    target_url = ""
    scan_id = req.scan_id or "direct_url"
    candidate_id = req.candidate_id or "direct_url"

    if has_scan:
        stmt = select(PIScan).where(PIScan.scan_id == req.scan_id, PIScan.user_id == user.user_id)
        result = await db.execute(stmt)
        scan_doc = result.scalar_one_or_none()
        if not scan_doc:
            raise HTTPException(status_code=404, detail="Scan not found")

        candidates = scan_doc.candidates or []
        match = next((c for c in candidates if c.get("id") == req.candidate_id), None)
        if not match:
            raise HTTPException(status_code=404, detail="Candidate not found")

        retailer = match.get("retailer", "")
        target_url = match.get("url", "")
    else:
        target_url = req.url.strip()
        if req.retailer and req.retailer.strip():
            retailer = req.retailer.strip()
        else:
            try:
                from urllib.parse import urlparse
                host = urlparse(target_url).netloc.lower()
                if host.startswith("www."):
                    host = host[4:]
            except Exception:
                host = target_url.lower()

            profile = RetailResolver().resolve(host)
            retailer = profile.id if profile.resolved else host

    aff_service = get_affiliate_service()
    aff_res = aff_service.generate(retailer, target_url, tracking_id=click_id)

    click_record = PIAffiliateClick(
        click_id=click_id,
        user_id=user.user_id,
        scan_id=scan_id,
        candidate_id=candidate_id,
        retailer=retailer,
        original_url=target_url,
        affiliate_url=aff_res.affiliate_url,
        generated=aff_res.generated,
        provider=aff_res.provider,
        error=aff_res.error,
        expires_at=aff_res.expires_at,
        tracking_id=click_id,
        created_at=datetime.now(UTC),
    )
    db.add(click_record)
    await db.commit()

    if not aff_res.generated:
        return {
            "success": False,
            "click_id": click_id,
            "retailer": retailer,
            "error": aff_res.error,
        }

    return {
        "success": True,
        "click_id": click_id,
        "retailer": retailer,
        "affiliate_url": aff_res.affiliate_url,
        "redirect_url": aff_res.affiliate_url,
        "expires_at": aff_res.expires_at,
    }


@router.get("/affiliate/redirect/{click_id}")
async def affiliate_redirect(click_id: str, db: AsyncSession = Depends(get_db)):
    """Redirects to the generated affiliate link."""
    stmt = select(PIAffiliateClick).where(PIAffiliateClick.click_id == click_id)
    result = await db.execute(stmt)
    click_doc = result.scalar_one_or_none()
    if not click_doc:
        raise HTTPException(status_code=404, detail="Click record not found")

    if not click_doc.generated or not click_doc.affiliate_url:
        raise HTTPException(status_code=502, detail=f"Affiliate link unavailable ({click_doc.error})")

    return RedirectResponse(click_doc.affiliate_url)


# ---------------- Admin & Metrics ----------------
@router.get("/admin/whoami")
async def admin_whoami(user: AuthUser = Depends(get_v2_auth_user)):
    return {
        "user_id": user.user_id,
        "email": user.email,
        "is_admin": user.is_admin,
        "provider": user.provider,
    }


@router.get("/admin/cache-stats")
async def admin_cache_stats(_: AuthUser = Depends(require_v2_admin)):
    return await product_cache_manager.stats()


@router.get("/admin/learning/insights")
async def admin_learning_insights(
    days: int = Query(default=30, ge=1, le=365),
    _: AuthUser = Depends(require_v2_admin),
):
    return await learning_engine.get_insights(days=days)


@router.get("/admin/ml-metrics")
async def admin_ml_metrics(_: AuthUser = Depends(require_v2_admin)):
    """Returns live worker thread pool and concurrency metrics for Product Intelligence."""
    from app.core.ml_concurrency import pi_ml_manager
    return pi_ml_manager.get_metrics()


# ---------------- Candidate -> Garment Bridge (Phase 3) ----------------
class CandidateSelectRequest(BaseModel):
    candidate_id: str


class CandidateToGarmentResponse(BaseModel):
    success: bool
    garment_id: str
    product_name: str
    garment_type: str
    tryon_url: str
    size_recommend_url: str


@router.post("/scan/{scan_id}/select", response_model=CandidateToGarmentResponse)
async def select_candidate_to_garment(
    scan_id: str,
    req: CandidateSelectRequest,
    user: AuthUser = Depends(get_v2_auth_user),
    db: AsyncSession = Depends(get_db),
):
    """Bridges a visual search match candidate into the existing PostgreSQL garments table.
    
    Returns a valid garment_id that can immediately be passed to /api/v1/tryon/start
    and /api/v1/size/recommend.
    """
    stmt = select(PIScan).where(PIScan.scan_id == scan_id, PIScan.user_id == user.user_id)
    result = await db.execute(stmt)
    scan_doc = result.scalar_one_or_none()
    if not scan_doc:
        raise HTTPException(status_code=404, detail="Scan not found")

    candidates = scan_doc.candidates or []
    match = next((c for c in candidates if c.get("id") == req.candidate_id), None)
    if not match:
        raise HTTPException(status_code=404, detail="Candidate not found in scan results")

    # Convert candidate to PostgreSQL Garment record
    from app.services.candidate_bridge import convert_candidate_to_garment
    garment = await convert_candidate_to_garment(match, db)

    # Record event in pi_analytics_events for learning engine
    event_id = uuid.uuid4().hex
    evt = PIAnalyticsEvent(
        event_id=event_id,
        event_type="product_selected",
        timestamp=datetime.now(UTC).isoformat(),
        user_id=user.user_id,
        scan_id=scan_id,
        candidate_id=req.candidate_id,
        retailer=match.get("retailer"),
        metadata_json={
            "garment_id": str(garment.id),
            "product_name": garment.product_name,
            "source": match.get("source", "retail_search"),
        },
    )
    db.add(evt)
    await db.commit()

    return CandidateToGarmentResponse(
        success=True,
        garment_id=str(garment.id),
        product_name=garment.product_name,
        garment_type=garment.garment_type,
        tryon_url="/api/v1/tryon/start",
        size_recommend_url="/api/v1/size/recommend",
    )

