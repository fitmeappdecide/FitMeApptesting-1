import asyncio
from datetime import UTC, datetime
import os
import re
import urllib.parse
import uuid

from fastapi import APIRouter, Depends, File, Form, UploadFile
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.models.brand import Brand
from app.models.garment import Garment
from app.models.tryon_job import TryOnJob
from app.schemas.product import (
    CompareResultResponse,
    CompareStartResponse,
    CompleteTheLookResponse,
    LookupKnownProductRequest,
    LookupKnownProductResponse,
    ProductFromExtensionRequest,
    ProductFromUrlRequest,
    ProductResponse,
)
from app.services.complete_the_look_service import get_complete_the_look_service
from app.services.garment_analysis import analyse_garment

from app.services.price_comparison import compare_prices
from app.services.product_scraper import scrape_product
from app.services.storage_service import build_encrypted_storage_ref, cdn_url_for_private_ref, optimize_image, upload_image_to_storage
from app.services.vision_extractor import extract_product_from_image
from app.utils.validators import validate_image_upload

router = APIRouter(prefix="/api/v1/product", tags=["product"])
comparison_store: dict[str, list[dict]] = {}

# In-memory lock for concurrency within the current FastAPI / Uvicorn process.
# Note: For multi-worker, multi-process, or clustered deployments, this in-memory lock
# is not shared across OS processes. Under current local/single-process deployment,
# asyncio.Lock combined with double-checked DB lookup prevents race-condition duplicate inserts.
_garment_creation_lock = asyncio.Lock()


def get_canonical_product_identity(url: str) -> tuple[str, str, str]:
    """Extracts (platform, stable_product_identifier, clean_canonical_url) from a retailer URL.

    Rules:
      - Removes tracking query params (utm_*, gclid, gbraid, gad_source, fbclid, ref, etc.) and fragments.
      - Extracts stable retailer style/product identifiers (e.g. Myntra style_id, Amazon ASIN, Ajio code).
      - Never relies on product_name or loose fuzzy matching.
    """
    if not url or not isinstance(url, str):
        return ("unknown", "", "")

    raw_url = url.strip()
    try:
        parsed = urllib.parse.urlparse(raw_url)
        host = (parsed.netloc or "").lower()
        if host.startswith("www."):
            host = host[4:]

        path = parsed.path or ""

        # 1. Myntra: style ID in path (6-10 digits)
        if "myntra.com" in host:
            style_match = re.search(r"/(\d{6,10})(?:/buy|\.html|/|$|\?)", path) or re.search(r"(\d{6,10})", path)
            style_id = style_match.group(1) if style_match else ""
            clean_path = re.sub(r"/buy/?$", "", path).rstrip("/")
            clean_url = f"https://www.myntra.com{clean_path}" if clean_path else raw_url.split("?")[0].split("#")[0]
            return ("myntra", style_id, clean_url)

        # 2. Amazon: 10-character alphanumeric ASIN
        if "amazon." in host:
            asin_match = re.search(r"/(?:dp|gp/product|d)/([A-Z0-9]{10})(?:/|$|\?)", path)
            asin = asin_match.group(1) if asin_match else ""
            clean_url = f"https://{parsed.netloc}/dp/{asin}" if asin else raw_url.split("?")[0].split("#")[0]
            return ("amazon", asin, clean_url)

        # 3. Ajio: Product code in path
        if "ajio.com" in host:
            ajio_match = re.search(r"/p/([a-zA-Z0-9_]+)(?:/|$|\?)", path)
            code = ajio_match.group(1) if ajio_match else ""
            clean_url = f"https://www.ajio.com/p/{code}" if code else raw_url.split("?")[0].split("#")[0]
            return ("ajio", code, clean_url)

        # 4. General clean URL: strip query parameters and fragments
        clean_url = raw_url.split("?")[0].split("#")[0].rstrip("/")
        return ("general", "", clean_url)

    except Exception:
        clean_url = raw_url.split("?")[0].split("#")[0].rstrip("/")
        return ("general", "", clean_url)


def _is_valid_garment_record(g: Garment | None) -> bool:
    """Returns True if the Garment has a genuine product name and at least one valid HTTP/HTTPS image."""
    if not g:
        return False
    if not g.product_name or not g.product_name.strip():
        return False
    name_lower = g.product_name.lower().strip()
    blocked_keywords = [
        "access denied", "just a moment", "attention required", "cloudflare",
        "403 forbidden", "robot or human", "security check", "pardon our interruption",
        "service unavailable", "blocked", "scraped fashion product", "garment",
    ]
    if any(k in name_lower for k in blocked_keywords):
        return False

    if not g.images or not isinstance(g.images, list) or len(g.images) == 0:
        return False
    
    for img in g.images:
        url = img.get("url") if isinstance(img, dict) else str(img) if img else ""
        if url and (url.startswith("http://") or url.startswith("https://")):
            return True
    return False


async def _lookup_existing_garment(
    db: AsyncSession,
    clean_url: str,
    raw_url: str,
    platform: str,
    style_id: str,
    require_valid: bool = True,
) -> Garment | None:
    """Finds an existing Garment record by clean URL or verified stable retailer product identifier.
    Orders by created_at.asc() to deterministically select the canonical oldest record.
    If require_valid=True, only returns complete records with valid images and non-blocked title.
    """
    if not clean_url and not raw_url:
        return None

    # 1. Exact match on clean canonical URL or original source URL
    url_conditions = []
    if clean_url:
        url_conditions.extend([Garment.product_url == clean_url, Garment.scraped_from_url == clean_url])
    if raw_url:
        url_conditions.extend([Garment.product_url == raw_url, Garment.scraped_from_url == raw_url])

    stmt = select(Garment).where(or_(*url_conditions)).order_by(Garment.created_at.asc())
    candidates = (await db.execute(stmt)).scalars().all()
    for g in candidates:
        if not require_valid or _is_valid_garment_record(g):
            return g

    # 2. For Myntra/Amazon with verified style ID, match structured style ID pattern in path
    if platform == "myntra" and style_id:
        stmt_style = (
            select(Garment)
            .where(
                or_(
                    Garment.scraped_from_url.contains(f"/{style_id}/"),
                    Garment.scraped_from_url.contains(f"/{style_id}"),
                    Garment.product_url.contains(f"/{style_id}/"),
                    Garment.product_url.contains(f"/{style_id}"),
                )
            )
            .order_by(Garment.created_at.asc())
        )
        style_candidates = (await db.execute(stmt_style)).scalars().all()
        for g in style_candidates:
            if not require_valid or _is_valid_garment_record(g):
                return g

    return None


async def _create_garment_from_product(product: dict, db: AsyncSession) -> Garment:
    source_url = product.get("source_url") or product.get("url") or ""
    platform, style_id, clean_url = get_canonical_product_identity(source_url)
    incoming_images = product.get("images") or []
    has_valid_incoming_images = False
    for img in incoming_images:
        u = img.get("url") if isinstance(img, dict) else str(img) if img else ""
        if u and (u.startswith("http://") or u.startswith("https://")):
            has_valid_incoming_images = True
            break

    # 1. Fast-path lookup (no lock overhead for previously extracted products)
    if source_url:
        existing = await _lookup_existing_garment(db, clean_url, source_url, platform, style_id, require_valid=False)
        if existing:
            if _is_valid_garment_record(existing):
                if product.get("brand") or product.get("price"):
                    current_masks = dict(existing.segmentation_masks or {})
                    if "extracted_metadata" not in current_masks:
                        meta = {}
                        if product.get("brand"):
                            meta["brand"] = str(product["brand"]).strip()
                        if product.get("price"):
                            meta["price"] = str(product["price"]).strip()
                        if product.get("platform"):
                            meta["platform"] = str(product["platform"]).strip()
                        meta["source"] = "native_extraction"
                        meta["verified_at"] = datetime.now(UTC).isoformat()
                        current_masks["extracted_metadata"] = meta
                        existing.segmentation_masks = current_masks
                        await db.commit()
                return existing
            elif has_valid_incoming_images:
                # Existing record was broken/failed from a prior extraction -> heal it with fresh valid product data!
                title = product.get("title") or product.get("product_name") or "Fashion product"
                normalized_images = [{"url": item, "angle": "front"} if isinstance(item, str) else item for item in incoming_images]
                analysis = analyse_garment(title, product.get("garment_type"), normalized_images)
                masks = dict(analysis.get("segmentation_masks") or {})
                if product.get("brand") or product.get("price"):
                    meta = {}
                    if product.get("brand"):
                        meta["brand"] = str(product["brand"]).strip()
                    if product.get("price"):
                        meta["price"] = str(product["price"]).strip()
                    if product.get("platform"):
                        meta["platform"] = str(product["platform"]).strip()
                    meta["source"] = "native_extraction"
                    meta["verified_at"] = datetime.now(UTC).isoformat()
                    masks["extracted_metadata"] = meta
                existing.product_name = title
                existing.images = normalized_images
                existing.garment_type = analysis["garment_type"]
                existing.segmentation_masks = masks
                existing.fabric_type = analysis["fabric_type"]
                existing.dominant_colours = analysis["dominant_colours"]
                existing.is_ethnic = analysis["is_ethnic"]
                existing.product_url = clean_url or source_url
                existing.scraped_from_url = clean_url or source_url
                await db.commit()
                await db.refresh(existing)
                return existing

    # 2. Synchronized double-checked block for concurrent cold-starts within this process
    async with _garment_creation_lock:
        if source_url:
            existing = await _lookup_existing_garment(db, clean_url, source_url, platform, style_id, require_valid=False)
            if existing:
                if _is_valid_garment_record(existing):
                    if product.get("brand") or product.get("price"):
                        current_masks = dict(existing.segmentation_masks or {})
                        if "extracted_metadata" not in current_masks:
                            meta = {}
                            if product.get("brand"):
                                meta["brand"] = str(product["brand"]).strip()
                            if product.get("price"):
                                meta["price"] = str(product["price"]).strip()
                            if product.get("platform"):
                                meta["platform"] = str(product["platform"]).strip()
                            meta["source"] = "native_extraction"
                            meta["verified_at"] = datetime.now(UTC).isoformat()
                            current_masks["extracted_metadata"] = meta
                            existing.segmentation_masks = current_masks
                            await db.commit()
                    return existing
                elif has_valid_incoming_images:
                    # Heal broken record
                    title = product.get("title") or product.get("product_name") or "Fashion product"
                    normalized_images = [{"url": item, "angle": "front"} if isinstance(item, str) else item for item in incoming_images]
                    analysis = analyse_garment(title, product.get("garment_type"), normalized_images)
                    masks = dict(analysis.get("segmentation_masks") or {})
                    if product.get("brand") or product.get("price"):
                        meta = {}
                        if product.get("brand"):
                            meta["brand"] = str(product["brand"]).strip()
                        if product.get("price"):
                            meta["price"] = str(product["price"]).strip()
                        if product.get("platform"):
                            meta["platform"] = str(product["platform"]).strip()
                        meta["source"] = "native_extraction"
                        meta["verified_at"] = datetime.now(UTC).isoformat()
                        masks["extracted_metadata"] = meta
                    existing.product_name = title
                    existing.images = normalized_images
                    existing.garment_type = analysis["garment_type"]
                    existing.segmentation_masks = masks
                    existing.fabric_type = analysis["fabric_type"]
                    existing.dominant_colours = analysis["dominant_colours"]
                    existing.is_ethnic = analysis["is_ethnic"]
                    existing.product_url = clean_url or source_url
                    existing.scraped_from_url = clean_url or source_url
                    await db.commit()
                    await db.refresh(existing)
                    return existing

        # 3. Create new Garment row
        title = product.get("title") or product.get("product_name") or "Scraped fashion product"
        images = product.get("images") or []
        normalized_images = [{"url": item, "angle": "front"} if isinstance(item, str) else item for item in images]
        analysis = analyse_garment(title, product.get("garment_type"), normalized_images)
        canonical_target_url = clean_url or source_url
        
        masks = dict(analysis.get("segmentation_masks") or {})
        if product.get("brand") or product.get("price"):
            meta = {}
            if product.get("brand"):
                meta["brand"] = str(product["brand"]).strip()
            if product.get("price"):
                meta["price"] = str(product["price"]).strip()
            if product.get("platform"):
                meta["platform"] = str(product["platform"]).strip()
            meta["source"] = "native_extraction"
            meta["verified_at"] = datetime.now(UTC).isoformat()
            masks["extracted_metadata"] = meta

        garment = Garment(
            id=uuid.uuid4(),
            product_name=title,
            product_url=canonical_target_url,
            images=normalized_images,
            garment_type=analysis["garment_type"],
            segmentation_masks=masks,
            fabric_type=analysis["fabric_type"],
            dominant_colours=analysis["dominant_colours"],
            is_ethnic=analysis["is_ethnic"],
            scraped_from_url=canonical_target_url,
        )
        try:
            db.add(garment)
            await db.commit()
            await db.refresh(garment)
        except Exception as e:
            await db.rollback()
            print(f"Notice: Garment commit rollback fallback ({e})")
            if source_url:
                existing = await _lookup_existing_garment(db, clean_url, source_url, platform, style_id, require_valid=False)
                if existing:
                    return existing
        return garment



@router.post("/lookup-known", response_model=LookupKnownProductResponse)
async def lookup_known_product(payload: LookupKnownProductRequest, db: AsyncSession = Depends(get_db)) -> LookupKnownProductResponse:
    """Read-only fast lookup. Strictly queries existing Garments. Never calls scrape_product."""
    platform, style_id, clean_url = get_canonical_product_identity(payload.url)
    existing = await _lookup_existing_garment(db, clean_url, payload.url, platform, style_id)

    if existing and existing.product_name and existing.images and len(existing.images) > 0:
        raw_images = [img["url"] if isinstance(img, dict) else str(img) for img in existing.images if img]
        if raw_images:
            masks = existing.segmentation_masks or {}
            meta = masks.get("extracted_metadata") if isinstance(masks, dict) else None

            if meta and isinstance(meta, dict):
                brand_val = meta.get("brand")
                price_val = meta.get("price")

                # Strict complete-product validation: must have genuine verified brand and price
                if brand_val and str(brand_val).strip() and price_val and str(price_val).strip() and existing.product_name.strip():
                    product = {
                        "title": existing.product_name.strip(),
                        "brand": str(brand_val).strip(),
                        "price": str(price_val).strip(),
                        "garment_type": existing.garment_type,
                        "images": existing.images,
                        "image_urls": raw_images,
                        "image_url": raw_images[0],
                        "url": existing.product_url or existing.scraped_from_url or payload.url,
                        "platform": meta.get("platform") or platform,
                        "status": "fetched",
                    }
                    return LookupKnownProductResponse(
                        found=True,
                        product_id=existing.id,
                        product=product,
                    )

    return LookupKnownProductResponse(found=False)



@router.post("/from-url", response_model=ProductResponse)
async def from_url(payload: ProductFromUrlRequest, db: AsyncSession = Depends(get_db)) -> ProductResponse:
    # 1. Pre-scrape fast path: check if a complete matching Garment with verified metadata already exists
    platform, style_id, clean_url = get_canonical_product_identity(payload.url)
    existing = await _lookup_existing_garment(db, clean_url, payload.url, platform, style_id)
    if existing and existing.images and len(existing.images) > 0:
        masks = existing.segmentation_masks or {}
        meta = masks.get("extracted_metadata") if isinstance(masks, dict) else None
        if meta and isinstance(meta, dict) and meta.get("brand") and meta.get("price"):
            product = {
                "title": existing.product_name,
                "brand": str(meta["brand"]).strip(),
                "price": str(meta["price"]).strip(),
                "garment_type": existing.garment_type,
                "images": existing.images,
                "url": existing.product_url or existing.scraped_from_url or payload.url,
                "platform": meta.get("platform") or platform,
                "status": "fetched",
                "fallback_required": False,
            }
            return ProductResponse(
                product_id=existing.id,
                status="fetched",
                product=product,
                fallback_required=False,
            )

    # 2. Cold path: invoke existing, frozen scraper engine exactly as before
    product = await scrape_product(payload.url)
    garment = await _create_garment_from_product({**product, "source_url": payload.url}, db)
    return ProductResponse(
        product_id=garment.id,
        status=product.get("status", "fetched"),
        product=product,
        fallback_required=product.get("fallback_required", False),
    )


@router.post("/from-image", response_model=ProductResponse)
async def from_image(image: UploadFile | None = File(default=None), image_url: str | None = None, db: AsyncSession = Depends(get_db)) -> ProductResponse:
    image_bytes = await validate_image_upload(image) if image else None
    product = extract_product_from_image(image_bytes=image_bytes, image_url=image_url)
    garment = await _create_garment_from_product(product, db)
    return ProductResponse(product_id=garment.id, status="fetched", product=product, fallback_required=False)


@router.post("/upload-garment", response_model=ProductResponse)
async def upload_garment(
    image: UploadFile = File(...),
    title: str = Form("Uploaded Garment"),
    brand: str = Form(""),
    price: str = Form(""),
    db: AsyncSession = Depends(get_db),
) -> ProductResponse:
    """Uploads user's selected garment image bytes to Supabase Storage (garments/ bucket)
    using the existing FitMe image optimizer (max 1200px, WebP q85 with progressive JPEG fallback)
    and registers the garment with a public HTTPS CDN URL.
    ZERO Gemini calls, ZERO LLM calls, ZERO automatic cropping.
    """
    image_bytes = await validate_image_upload(image)
    opt_bytes, mime_type = optimize_image(image_bytes, max_dim=1200, quality=85, format_preference="WEBP")

    original_filename = image.filename or "garment.jpg"
    base_name = os.path.splitext(original_filename)[0]
    ext = ".webp" if "webp" in mime_type else ".jpg"
    storage_path = build_encrypted_storage_ref("garments", f"{base_name}{ext}")

    upload_image_to_storage(opt_bytes, storage_path)
    public_url = cdn_url_for_private_ref(storage_path)

    product_data = {
        "title": title or "Uploaded Garment",
        "brand": brand or "",
        "price": price or "",
        "images": [public_url],
        "source_type": "image_upload",
        "source_url": None,
        "platform": None,
    }
    garment = await _create_garment_from_product(product_data, db)
    return ProductResponse(
        product_id=garment.id,
        status="fetched",
        product={**product_data, "tryon_url": f"/tryon/{garment.id}"},
        fallback_required=False,
    )


@router.post("/extract-screenshot", response_model=dict)
async def extract_screenshot(image: UploadFile = File(...)) -> dict:
    image_bytes = await validate_image_upload(image)
    product = extract_product_from_image(image_bytes=image_bytes, image_url=None)
    return product


@router.post("/from-extension", response_model=ProductResponse)
async def from_extension(payload: ProductFromExtensionRequest, db: AsyncSession = Depends(get_db)) -> ProductResponse:
    title_lower = (payload.title or "").lower().strip()
    blocked_keywords = ["access denied", "just a moment", "attention required", "cloudflare", "403 forbidden", "robot or human", "security check", "pardon our interruption", "blocked"]
    if not payload.title or any(k in title_lower for k in blocked_keywords):
        raise HTTPException(status_code=400, detail=f"Anti-bot block or invalid title: {payload.title}")

    if payload.source_url:
        platform, style_id, clean_url = get_canonical_product_identity(payload.source_url)
        existing = await _lookup_existing_garment(db, clean_url, payload.source_url, platform, style_id)
        if existing and existing.images and len(existing.images) > 0:
            if payload.brand or payload.price:
                current_masks = dict(existing.segmentation_masks or {})
                if "extracted_metadata" not in current_masks:
                    meta = {}
                    if payload.brand:
                        meta["brand"] = str(payload.brand).strip()
                    if payload.price:
                        meta["price"] = str(payload.price).strip()
                    if payload.platform:
                        meta["platform"] = str(payload.platform).strip()
                    meta["source"] = "native_extraction"
                    meta["verified_at"] = datetime.now(UTC).isoformat()
                    current_masks["extracted_metadata"] = meta
                    existing.segmentation_masks = current_masks
                    await db.commit()

            product = payload.model_dump()
            product["title"] = payload.title
            return ProductResponse(
                product_id=existing.id,
                status="fetched",
                product={**product, "tryon_url": f"/tryon/{existing.id}"},
                fallback_required=False,
            )

    product = payload.model_dump()
    product["title"] = payload.title
    garment = await _create_garment_from_product(product, db)
    return ProductResponse(
        product_id=garment.id,
        status="fetched",
        product={**product, "tryon_url": f"/tryon/{garment.id}"},
        fallback_required=False,
    )


@router.post("/{id}/compare-prices", response_model=CompareStartResponse)
async def start_compare(id: str, db: AsyncSession = Depends(get_db)) -> CompareStartResponse:
    garment = await db.get(Garment, id)
    product = {"title": garment.product_name if garment else "FitMe product", "brand": (garment.product_name.split()[0] if garment else "FitMe"), "garment_type": garment.garment_type if garment else "unknown"}
    job_id, comparisons = await compare_prices(product)
    comparison_store[str(job_id)] = comparisons
    return CompareStartResponse(job_id=job_id, status="completed")


@router.get("/{id}/compare-prices/{job_id}", response_model=CompareResultResponse)
async def get_compare(id: str, job_id: str) -> CompareResultResponse:
    return CompareResultResponse(status="completed" if job_id in comparison_store else "queued", comparisons=comparison_store.get(job_id, []))


@router.get("/complete-the-look", response_model=CompleteTheLookResponse)
async def get_complete_the_look(
    job_id: str | None = None,
    garment_id: str | None = None,
    title: str | None = None,
    brand: str | None = None,
    category: str | None = None,
    gender: str | None = None,
    color: str | None = None,
    image_url: str | None = None,
    db: AsyncSession = Depends(get_db),
) -> CompleteTheLookResponse:
    """Returns real, outfit-specific complementary product recommendations for Complete the Look."""
    target_title = title
    target_brand = brand
    target_type = category
    target_gender = gender
    target_color = color
    target_image = image_url
    target_url = None
    target_is_ethnic = False
    resolved_garment_id = garment_id

    # 1. Authoritative TryOnJob lookup if job_id provided
    if job_id:
        try:
            job_uuid = uuid.UUID(str(job_id))
            job = await db.get(TryOnJob, job_uuid)
            if job and job.garment_id:
                resolved_garment_id = str(job.garment_id)
        except Exception:
            pass

    # 2. Authoritative Garment record lookup
    if resolved_garment_id:
        try:
            g_uuid = uuid.UUID(str(resolved_garment_id))
            garment = await db.get(Garment, g_uuid)
            if garment:
                target_title = garment.product_name or target_title
                target_type = garment.garment_type or target_type
                target_is_ethnic = bool(garment.is_ethnic)
                target_url = garment.product_url or garment.scraped_from_url
                if garment.images and len(garment.images) > 0:
                    first_img = garment.images[0]
                    target_image = first_img.get("url") if isinstance(first_img, dict) else str(first_img)
                if garment.brand_id:
                    b_obj = await db.get(Brand, garment.brand_id)
                    if b_obj and b_obj.name:
                        target_brand = b_obj.name
                masks = garment.segmentation_masks or {}
                meta = masks.get("extracted_metadata") if isinstance(masks, dict) else None
                if meta and isinstance(meta, dict):
                    target_brand = target_brand or meta.get("brand")
        except Exception:
            pass

    if not target_title and not target_url:
        return CompleteTheLookResponse(
            theme="Hand-picked pairings",
            source_garment={},
            recommendations=[],
        )

    svc = get_complete_the_look_service()
    res = await svc.get_recommendations(
        title=target_title or "Fashion garment",
        brand=target_brand,
        garment_type=target_type,
        is_ethnic=target_is_ethnic,
        gender=target_gender,
        dominant_color=target_color,
        image_url=target_image,
        source_url=target_url,
        garment_id=resolved_garment_id,
    )
    return CompleteTheLookResponse(**res)


