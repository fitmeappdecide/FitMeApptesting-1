from datetime import UTC, datetime
import re
from typing import Any, Literal, Optional
import uuid

from fastapi import APIRouter, Depends, Header, HTTPException, Query
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import api_error, get_current_user, get_current_user_or_anonymous
from app.core.config import settings
from app.core.database import get_db
from app.models.analytics import AnalyticsEvent
from app.models.body_scan import BodyScan
from app.models.body_profile import BodyProfile
from app.models.brand import Brand
from app.models.garment import Garment
from app.models.tryon_job import TryOnJob
from app.models.user import User
from app.models.user_saved_photo import UserSavedPhoto
from app.schemas.tryon import (
    TryOnDeleteResponse,
    TryOnDetailResponse,
    TryOnHistoryItem,
    TryOnResultResponse,
    TryOnStartRequest,
    TryOnStartResponse,
    TryOnStatusResponse,
    TryOnToggleSaveResponse,
)
from app.services import storage_service
from app.services.cache_service import find_tryon_cache, store_tryon_cache
from app.services.size_recommendation import recommend_size
from app.services.tryon.factory import get_tryon_provider
from app.utils.telemetry import TelemetryTimer

router = APIRouter(prefix="/api/v1/tryon", tags=["tryon"])


# ---------------------------------------------------------------------------
# Garment type auto-detection
# ---------------------------------------------------------------------------

# Mapping from Garment.garment_type (database values) to the provider's
# Literal type.  Values not present fall back to None (provider decides).
_DB_TYPE_TO_PROVIDER: dict[str, Literal["top", "bottom", "dress", "saree", "full_body", "shoes"]] = {
    "tshirt":       "top",
    "shirt":        "top",
    "kurta":        "top",
    "hoodie":       "top",
    "jacket":       "top",
    "pants":        "bottom",
    "saree":        "saree",
    "lehenga":      "full_body",
    "dress":        "dress",
    "shoes":        "shoes",
    "shoe":         "shoes",
    "slipper":      "shoes",
    "slippers":     "shoes",
    "heel":         "shoes",
    "heels":        "shoes",
    "mule":         "shoes",
    "mules":        "shoes",
    "sandal":       "shoes",
    "sandals":      "shoes",
    "flats":        "shoes",
    "flat":         "shoes",
    "boot":         "shoes",
    "boots":        "shoes",
    "sneaker":      "shoes",
    "sneakers":     "shoes",
    "pump":         "shoes",
    "pumps":        "shoes",
    "wedge":        "shoes",
    "wedges":       "shoes",
    "clog":         "shoes",
    "clogs":        "shoes",
    "loafer":       "shoes",
    "loafers":      "shoes",
    "footwear":     "shoes",
    "footwear_set": "shoes",
}

# Keyword fallback: checked against lower-cased product_name when the DB
# garment_type is "unknown".
_KEYWORD_MAP: list[tuple[str, Literal["top", "bottom", "dress", "saree", "full_body", "shoes"]]] = [
    ("tshirt",   "top"),
    ("t-shirt",  "top"),
    ("shirt",    "top"),
    ("kurta",    "top"),
    ("hoodie",   "top"),
    ("jacket",   "top"),
    ("blazer",   "top"),
    ("top",      "top"),
    ("pant",     "bottom"),
    ("trouser",  "bottom"),
    ("jeans",    "bottom"),
    ("legging",  "bottom"),
    ("shorts",   "bottom"),
    ("saree",    "saree"),
    ("sari",     "saree"),
    ("lehenga",  "full_body"),
    ("dress",    "dress"),
    ("gown",     "full_body"),
    ("shoe",     "shoes"),
    ("shoes",    "shoes"),
    ("slipper",  "shoes"),
    ("slippers", "shoes"),
    ("sneaker",  "shoes"),
    ("sneakers", "shoes"),
    ("boot",     "shoes"),
    ("boots",    "shoes"),
    ("sandal",   "shoes"),
    ("sandals",  "shoes"),
    ("heel",     "shoes"),
    ("heels",    "shoes"),
    ("mule",     "shoes"),
    ("mules",    "shoes"),
    ("flats",    "shoes"),
    ("flat",     "shoes"),
    ("pump",     "shoes"),
    ("pumps",    "shoes"),
    ("wedge",    "shoes"),
    ("wedges",   "shoes"),
    ("clog",     "shoes"),
    ("clogs",    "shoes"),
    ("loafer",   "shoes"),
    ("loafers",  "shoes"),
    ("footwear", "shoes"),
]


def _is_valid_uuid(val: Any) -> bool:
    if not val:
        return False
    try:
        uuid.UUID(str(val))
        return True
    except (ValueError, TypeError, AttributeError):
        return False


def _detect_garment_type(
    garment: Garment,
) -> Literal["top", "bottom", "dress", "saree", "full_body", "shoes"] | None:
    """Automatically determine the provider garment type.

    Priority:
    1. Stored ``garment_type`` field (if not "unknown").
    2. Keyword scan of ``product_name``.
    3. None → provider uses its own default logic.
    """
    db_type = (garment.garment_type or "unknown").lower()
    if db_type != "unknown" and db_type in _DB_TYPE_TO_PROVIDER:
        return _DB_TYPE_TO_PROVIDER[db_type]

    # Keyword fallback on product_name
    name_lower = (garment.product_name or "").lower()
    for keyword, provider_type in _KEYWORD_MAP:
        if keyword in name_lower:
            return provider_type

    return None  # Provider decides


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------


@router.post("/start", response_model=TryOnStartResponse)
async def start_tryon(
    payload: TryOnStartRequest,
    x_anonymous_session_id: str | None = Header(default=None),
    user: User = Depends(get_current_user_or_anonymous),
    db: AsyncSession = Depends(get_db),
) -> TryOnStartResponse:
    with TelemetryTimer("POST /api/v1/tryon/start") as timer:
        # ------------------------------------------------------------------
        # 1. Load and validate photo source and garment
        # ------------------------------------------------------------------
        garment = None
        garment_id_str = str(payload.garment_id) if payload.garment_id else ""
        if _is_valid_uuid(garment_id_str):
            try:
                garment = await db.get(Garment, payload.garment_id)
            except Exception:
                garment = None

        if garment is None and garment_id_str:
            # Candidate auto-bridge: try finding matching candidate in recent Product Intelligence scans
            try:
                from app.models.product_intelligence import PIScan
                from app.services.candidate_bridge import convert_candidate_to_garment

                stmt = select(PIScan).order_by(PIScan.created_at.desc()).limit(20)
                res = await db.execute(stmt)
                scans = res.scalars().all()
                found_cand = None
                for sc in scans:
                    if sc.candidates and isinstance(sc.candidates, list):
                        for cand in sc.candidates:
                            if isinstance(cand, dict) and str(cand.get("id")) == garment_id_str:
                                found_cand = cand
                                break
                    if found_cand:
                        break
                if found_cand:
                    garment = await convert_candidate_to_garment(found_cand, db)
            except Exception as b_err:
                print(f"Notice: Candidate auto-bridge attempt failed ({b_err})")

        if garment is None:
            raise api_error(404, "GARMENT_NOT_FOUND", "Garment was not found.", "गारमेंट नहीं मिला।")

        saved_photo_id_val = None
        saved_photo_name_val = None
        user_image_ref = None
        scan = None

        if payload.saved_photo_id:
            photo = await db.get(UserSavedPhoto, payload.saved_photo_id)
            if not photo or str(photo.user_id) != str(user.id):
                raise api_error(404, "PHOTO_NOT_FOUND", "Saved photo was not found.", "सहेजी गई तस्वीर नहीं मिली।")
            saved_photo_id_val = photo.id
            saved_photo_name_val = photo.display_name
            user_image_ref = photo.storage_path
            if payload.scan_id:
                scan = await db.get(BodyScan, payload.scan_id)
                if scan and str(scan.user_id) != str(user.id):
                    raise api_error(403, "FORBIDDEN", "You do not have access to this scan.", "आपके पास इस स्कैन की अनुमति नहीं है।")
        elif payload.scan_id:
            scan = await db.get(BodyScan, payload.scan_id)
            if scan is None or str(scan.user_id) != str(user.id):
                raise api_error(404, "SCAN_NOT_FOUND", "Body scan was not found.", "बॉडी स्कैन नहीं मिला।")
            user_image_ref = scan.front_photo_url_encrypted
        else:
            raise api_error(422, "USER_PHOTO_REQUIRED", "Either scan_id or saved_photo_id must be provided.", "यूजर फोटो आवश्यक है।")

        # ------------------------------------------------------------------
        # 2. Validate garment images
        # ------------------------------------------------------------------
        if not garment.images or not isinstance(garment.images, list):
            raise api_error(422, "GARMENT_IMAGE_MISSING", "Garment has no images.", "गारमेंट में कोई छवि नहीं है।")
        first_img = garment.images[0]
        first_garment_url: str | None = None
        if isinstance(first_img, str) and first_img.strip():
            first_garment_url = first_img.strip()
        elif isinstance(first_img, dict) and "url" in first_img and first_img["url"]:
            first_garment_url = str(first_img["url"]).strip()

        if not first_garment_url:
            raise api_error(422, "GARMENT_IMAGE_URL_INVALID", "Garment image URL missing.", "गारमेंट छवि URL गलत है।")
        if first_garment_url.startswith("file://"):
            raise api_error(422, "GARMENT_IMAGE_URL_INVALID", "Garment image must be a remotely accessible HTTPS URL.", "गारमेंट छवि एक मान्य URL होनी चाहिए।")

        # ------------------------------------------------------------------
        # 3. Brand monthly limit check
        # ------------------------------------------------------------------
        brand = await db.get(Brand, garment.brand_id) if garment.brand_id else None
        if brand and brand.try_ons_used_this_month >= brand.try_ons_limit:
            raise api_error(
                402,
                "PLAN_LIMIT_EXCEEDED",
                "This brand has exceeded its monthly try-on limit.",
                "इस ब्रांड की मासिक ट्राई-ऑन सीमा समाप्त हो गई है।",
            )

        # ------------------------------------------------------------------
        # 4. Body profile / cluster key check
        # ------------------------------------------------------------------
        profile = await db.get(BodyProfile, scan.body_profile_id) if (scan and scan.body_profile_id) else None
        timer.mark("1. DB Validation Queries Completed")
        
        if settings.enable_body_analysis and scan:
            if profile is None or not profile.cluster_key:
                raise api_error(
                    422,
                    "PROFILE_NOT_READY",
                    "Body profile is not ready yet.",
                    "बॉडी प्रोफाइल अभी तैयार नहीं है।",
                )
            cluster_key_val = profile.cluster_key
        else:
            cluster_key_val = None

        # ------------------------------------------------------------------
        # 5. Cache lookup & Exact Duplicate Check
        # ------------------------------------------------------------------
        cache_tier, cached_urls = await find_tryon_cache(str(garment.id), cluster_key_val) if cluster_key_val else (None, [])

        # Exact Duplicate Check: if this user already completed this exact garment + photo combination, reuse it
        exact_dup_stmt = (
            select(TryOnJob)
            .where(
                TryOnJob.user_id == user.id,
                TryOnJob.garment_id == garment.id,
                TryOnJob.status == "completed",
            )
        )
        if saved_photo_id_val:
            exact_dup_stmt = exact_dup_stmt.where(TryOnJob.saved_photo_id == saved_photo_id_val)
        elif scan:
            exact_dup_stmt = exact_dup_stmt.where(TryOnJob.saved_photo_id.is_(None))

        exact_dup_stmt = exact_dup_stmt.order_by(TryOnJob.created_at.desc())
        existing_dup = (await db.execute(exact_dup_stmt)).scalars().first()

        if existing_dup and existing_dup.result_image_urls and len(existing_dup.result_image_urls) > 0:
            return TryOnStartResponse(
                job_id=existing_dup.id,
                estimated_seconds=1,
                cache_tier="exact",
            )

        # ------------------------------------------------------------------
        # 6. Create job record with saved photo snapshot and session isolation
        # ------------------------------------------------------------------
        anon_session_val = None
        if user.email == settings.anonymous_website_user_email.lower() and x_anonymous_session_id:
            anon_session_val = f"anon_session:{x_anonymous_session_id.strip()}"

        job = TryOnJob(
            user_id=user.id,
            garment_id=garment.id,
            brand_id=garment.brand_id,
            status="processing",
            cache_tier=cache_tier,
            saved_photo_id=saved_photo_id_val,
            saved_photo_name=saved_photo_name_val,
            runpod_job_id=anon_session_val,
        )
        db.add(job)
        await db.flush()
        timer.mark("2. TryOnJob Created in DB")

        # ------------------------------------------------------------------
        # 7. Execute try-on (cache hit or live provider call)
        # ------------------------------------------------------------------
        try:
            if cached_urls:
                job.result_image_urls = cached_urls
                job.status = "completed"
                job.processing_time_seconds = 0.05 if cache_tier == "exact" else 0.2
            else:
                garment_image_url: str = first_garment_url
                garment_type = garment.garment_type if (garment.garment_type and garment.garment_type != "unknown") else _detect_garment_type(garment)

                if garment_type == "shoes":
                    raise api_error(
                        422,
                        "FOOTWEAR_TRYON_UNSUPPORTED",
                        "Virtual try-on is currently available for apparel (tops, bottoms, dresses, ethnic wear). Footwear try-on is not supported by Google Vertex AI.",
                        "वर्चुअल ट्राई-ऑन वर्तमान में केवल कपड़ों (टॉप्स, बॉटम्स, ड्रेस) के लिए उपलब्ध है। जूते/चप्पल ट्राई-ऑन समर्थित नहीं है।",
                    )

                provider = get_tryon_provider()
                result = await provider.generate_tryon(
                    user_image_url=user_image_ref or "",
                    garment_image_url=garment_image_url,
                    garment_type=garment_type,
                )
                timer.mark("3. TryOnProvider Execution Completed")

                job.result_image_urls = result.image_urls
                job.processing_time_seconds = result.processing_time_seconds
                job.status = "completed"

            if cluster_key_val and job.result_image_urls:
                await store_tryon_cache(
                    str(garment.id),
                    cluster_key_val,
                    job.result_image_urls,
                )

        except HTTPException:
            raise
        except Exception as exc:
            print(f"Notice: TryOn generation failed ({exc}).")
            job.status = "failed"
            job.result_image_urls = []
            job.error_message = str(exc)
            job.processing_time_seconds = 0.5

        # ------------------------------------------------------------------
        # 8. Finalise job, brand counter, analytics
        # ------------------------------------------------------------------
        job.completed_at = datetime.now(UTC)

        if brand and job.status == "completed":
            try:
                brand.try_ons_used_this_month += 1
            except Exception:
                pass

        if job.status == "completed":
            try:
                db.add(
                    AnalyticsEvent(
                        brand_id=garment.brand_id,
                        event_type="tryon_completed",
                        tryon_job_id=job.id,
                        user_id=user.id,
                        garment_id=garment.id,
                        metadata_json={"cache_tier": cache_tier},
                    )
                )
            except Exception as ae_err:
                print(f"Notice: AnalyticsEvent creation skipped ({ae_err})")

        try:
            await db.commit()
        except Exception as commit_err:
            print(f"Notice: TryOn primary commit error ({commit_err}), rolling back and committing job alone.")
            await db.rollback()
            try:
                # Re-add job in fresh transaction
                job.completed_at = datetime.now(UTC)
                db.add(job)
                await db.commit()
            except Exception as final_err:
                print(f"Notice: TryOn fallback commit notice ({final_err})")

        return TryOnStartResponse(
            job_id=job.id,
            estimated_seconds=1 if cached_urls else 25,
            cache_tier=cache_tier,
        )


# ---------------------------------------------------------------------------
# History
# ---------------------------------------------------------------------------


def _extract_platform_from_url(url: str | None) -> str | None:
    if not url:
        return None
    u = url.lower()
    if "amazon" in u:
        return "Amazon"
    if "myntra" in u:
        return "Myntra"
    if "ajio" in u:
        return "AJIO"
    if "flipkart" in u:
        return "Flipkart"
    if "nykaa" in u:
        return "Nykaa"
    if "meesho" in u:
        return "Meesho"
    if "tatacliq" in u:
        return "Tata CLiQ"
    if "zara" in u:
        return "Zara"
    if "hm.com" in u or "h&m" in u:
        return "H&M"
    return None


def _extract_brand_from_title_or_url(title: str | None, url: str | None) -> str:
    if not title:
        return "FitMe"
    match = re.match(r"^Buy\s+([A-Za-z0-9'&.\-]+)", title.strip(), re.IGNORECASE)
    if match:
        candidate = match.group(1).strip()
        if candidate.lower() not in ("the", "this", "a", "an", "women", "women's", "men", "men's"):
            return candidate
    return "FitMe"


@router.get("/history", response_model=list[TryOnHistoryItem])
async def history(
    status: Optional[str] = Query(default=None, description="Optional status filter, e.g. 'completed'"),
    saved_only: bool = Query(default=False, description="Filter only favorited/saved try-on looks"),
    saved_photo_id: Optional[str] = Query(default=None, description="Filter by saved photo ID"),
    user: User = Depends(get_current_user_or_anonymous),
    db: AsyncSession = Depends(get_db),
    page: int = 1,
    limit: int = 20,
) -> list[TryOnHistoryItem]:
    if user.email == settings.anonymous_website_user_email.lower():
        return []

    stmt = select(TryOnJob).where(TryOnJob.user_id == user.id)
    if status:
        stmt = stmt.where(TryOnJob.status == status)
    if saved_only:
        stmt = stmt.where(TryOnJob.is_saved == True)
    if saved_photo_id:
        try:
            photo_uuid = uuid.UUID(str(saved_photo_id).strip())
            stmt = stmt.where(TryOnJob.saved_photo_id == photo_uuid)
        except (ValueError, TypeError):
            # If not a valid UUID format (e.g. demo/local placeholder), match nothing
            stmt = stmt.where(TryOnJob.id == uuid.uuid4())
    stmt = stmt.order_by(TryOnJob.created_at.desc()).offset((page - 1) * limit).limit(limit)

    result = await db.execute(stmt)
    jobs = result.scalars().all()

    items: list[TryOnHistoryItem] = []
    if not jobs:
        return items

    garment_ids = list({j.garment_id for j in jobs if j.garment_id})
    brand_ids_set = {j.brand_id for j in jobs if j.brand_id}

    garments_map: dict[uuid.UUID, Garment] = {}
    if garment_ids:
        gres = await db.execute(select(Garment).where(Garment.id.in_(garment_ids)))
        for g in gres.scalars().all():
            garments_map[g.id] = g
            if g.brand_id:
                brand_ids_set.add(g.brand_id)

    brands_map: dict[uuid.UUID, Brand] = {}
    brand_ids = [b for b in brand_ids_set if b is not None]
    if brand_ids:
        bres = await db.execute(select(Brand).where(Brand.id.in_(brand_ids)))
        for b in bres.scalars().all():
            brands_map[b.id] = b

    for j in jobs:
        garment = garments_map.get(j.garment_id) if j.garment_id else None
        brand = brands_map.get(j.brand_id) if j.brand_id else None
        if not brand and garment and garment.brand_id:
            brand = brands_map.get(garment.brand_id)

        brand_name: str
        if brand and brand.name:
            brand_name = brand.name
        elif garment and garment.product_name:
            brand_name = _extract_brand_from_title_or_url(
                garment.product_name,
                garment.scraped_from_url or garment.product_url,
            )
        else:
            brand_name = "FitMe"

        plat = None
        if garment:
            plat = _extract_platform_from_url(garment.scraped_from_url or garment.product_url)
        if not plat and brand:
            plat = brand.name
        if not plat:
            plat = "Store"

        first_url = j.result_image_urls[0] if (j.result_image_urls and len(j.result_image_urls) > 0) else None
        thumb_url = storage_service.get_thumbnail_url_for_result(first_url) if first_url else None
        signed_image_urls = [storage_service.sign_if_private(u) for u in (j.result_image_urls or [])]

        items.append(
            TryOnHistoryItem(
                id=j.id,
                garment_id=j.garment_id,
                status=j.status,
                result_image_urls=signed_image_urls,
                thumbnail_url=thumb_url,
                created_at=j.created_at,
                is_saved=bool(j.is_saved),
                saved_photo_id=j.saved_photo_id,
                saved_photo_name=j.saved_photo_name,
                title=garment.product_name if garment else "Virtual Try-On",
                brand=brand_name,
                platform=plat,
            )
        )
    return items


@router.delete("/history", response_model=TryOnDeleteResponse)
async def clear_all_history(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> TryOnDeleteResponse:
    """Deletes all virtual try-on jobs for the authenticated user and cleans up Storage."""
    result = await db.execute(select(TryOnJob).where(TryOnJob.user_id == user.id))
    jobs = result.scalars().all()

    all_image_urls: list[str] = []
    for j in jobs:
        if j.result_image_urls and isinstance(j.result_image_urls, list):
            all_image_urls.extend(j.result_image_urls)

    del_stmt = delete(TryOnJob).where(TryOnJob.user_id == user.id)
    del_res = await db.execute(del_stmt)
    await db.commit()

    if all_image_urls:
        storage_service.delete_images_from_storage(all_image_urls)

    return TryOnDeleteResponse(success=True, deleted=del_res.rowcount or 0)


@router.delete("/{job_id}", response_model=TryOnDeleteResponse)
async def delete_tryon(
    job_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> TryOnDeleteResponse:
    """Deletes an individual virtual try-on job for the authenticated user and cleans up Storage."""
    try:
        job_uuid = uuid.UUID(str(job_id))
    except ValueError:
        raise api_error(404, "JOB_NOT_FOUND", "Try-on job was not found.", "ट्राई-ऑन जॉब नहीं मिला।")

    job = await db.get(TryOnJob, job_uuid)
    if job is None or str(job.user_id) != str(user.id):
        raise api_error(404, "JOB_NOT_FOUND", "Try-on job was not found.", "ट्राई-ऑन जॉब नहीं मिला।")

    image_urls = list(job.result_image_urls or [])
    await db.delete(job)
    await db.commit()

    if image_urls:
        storage_service.delete_images_from_storage(image_urls)

    return TryOnDeleteResponse(success=True, deleted=1)


@router.post("/{job_id}/toggle-save", response_model=TryOnToggleSaveResponse)
async def toggle_save(
    job_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> TryOnToggleSaveResponse:
    """Toggles the saved/favorited status of a virtual try-on."""
    try:
        job_uuid = uuid.UUID(str(job_id))
    except ValueError:
        raise api_error(404, "JOB_NOT_FOUND", "Try-on job was not found.", "ट्राई-ऑन जॉब नहीं मिला।")

    job = await db.get(TryOnJob, job_uuid)
    if job is None or str(job.user_id) != str(user.id):
        raise api_error(404, "JOB_NOT_FOUND", "Try-on job was not found.", "ट्राई-ऑन जॉब नहीं मिला।")

    job.is_saved = not bool(job.is_saved)
    await db.commit()
    return TryOnToggleSaveResponse(success=True, job_id=job.id, is_saved=job.is_saved)


# ---------------------------------------------------------------------------
# Status
# ---------------------------------------------------------------------------


@router.get("/{job_id}", response_model=TryOnStatusResponse)
async def status(
    job_id: str,
    x_anonymous_session_id: str | None = Header(default=None),
    user: User = Depends(get_current_user_or_anonymous),
    db: AsyncSession = Depends(get_db),
) -> TryOnStatusResponse:
    try:
        job_uuid = uuid.UUID(str(job_id))
    except ValueError:
        raise api_error(404, "JOB_NOT_FOUND", "Try-on job was not found.", "ट्राई-ऑन जॉब नहीं मिला।")

    job = await db.get(TryOnJob, job_uuid)
    if job is None or str(job.user_id) != str(user.id):
        raise api_error(404, "JOB_NOT_FOUND", "Try-on job was not found.", "ट्राई-ऑन जॉब नहीं मिला।")

    # Anonymous session isolation check
    if user.email == settings.anonymous_website_user_email.lower() and job.runpod_job_id and job.runpod_job_id.startswith("anon_session:"):
        expected_session = job.runpod_job_id.split(":", 1)[1]
        if x_anonymous_session_id and x_anonymous_session_id.strip() != expected_session:
            raise api_error(403, "FORBIDDEN", "You do not have access to this anonymous try-on job.", "आपके पास इस जॉब की अनुमति नहीं है।")

    progress = 100 if job.status == "completed" else 40 if job.status == "processing" else 0
    step = "Upscaling to HD" if job.status == "completed" else ("Failed" if job.status == "failed" else "Running AI synthesis")
    return TryOnStatusResponse(
        id=job.id,
        status=job.status,
        progress_pct=progress,
        current_step=step,
        error_message=job.error_message if job.status == "failed" else None,
    )


# ---------------------------------------------------------------------------
# Detail & Result
# ---------------------------------------------------------------------------


@router.get("/{job_id}/detail", response_model=TryOnDetailResponse)
async def get_tryon_detail(
    job_id: str,
    x_anonymous_session_id: str | None = Header(default=None),
    user: User = Depends(get_current_user_or_anonymous),
    db: AsyncSession = Depends(get_db),
) -> TryOnDetailResponse:
    """Returns the full rich detail payload for an individual virtual try-on job."""
    try:
        job_uuid = uuid.UUID(str(job_id))
    except ValueError:
        raise api_error(404, "JOB_NOT_FOUND", "Try-on job was not found.", "ट्राई-ऑन जॉब नहीं मिला।")

    job = await db.get(TryOnJob, job_uuid)
    if job is None or str(job.user_id) != str(user.id):
        raise api_error(404, "JOB_NOT_FOUND", "Try-on job was not found.", "ट्राई-ऑन जॉब नहीं मिला।")

    # Anonymous session isolation check
    if user.email == settings.anonymous_website_user_email.lower() and job.runpod_job_id and job.runpod_job_id.startswith("anon_session:"):
        expected_session = job.runpod_job_id.split(":", 1)[1]
        if x_anonymous_session_id and x_anonymous_session_id.strip() != expected_session:
            raise api_error(403, "FORBIDDEN", "You do not have access to this anonymous try-on job.", "आपके पास इस जॉब की अनुमति नहीं है।")

    garment = await db.get(Garment, job.garment_id) if job.garment_id else None
    brand = await db.get(Brand, job.brand_id) if job.brand_id else None
    if not brand and garment and garment.brand_id:
        brand = await db.get(Brand, garment.brand_id)

    brand_name: str
    if brand and brand.name:
        brand_name = brand.name
    elif garment and garment.product_name:
        brand_name = _extract_brand_from_title_or_url(
            garment.product_name,
            garment.scraped_from_url or garment.product_url,
        )
    else:
        brand_name = "FitMe"

    platform = None
    if garment:
        platform = _extract_platform_from_url(garment.scraped_from_url or garment.product_url)
    if not platform and brand:
        platform = brand.name
    if not platform:
        platform = "Store"

    # Resolve garment images
    garment_images = garment.images if garment and isinstance(garment.images, list) else []
    garment_image_url = None
    if garment_images:
        first_img = garment_images[0]
        if isinstance(first_img, dict) and "url" in first_img:
            garment_image_url = first_img["url"]
        elif isinstance(first_img, str):
            garment_image_url = first_img

    signed_garment_image_url = storage_service.sign_if_private(garment_image_url) if garment_image_url else None
    signed_garment_images = []
    for gimg in garment_images:
        if isinstance(gimg, dict) and "url" in gimg and gimg["url"]:
            signed_garment_images.append({**gimg, "url": storage_service.sign_if_private(gimg["url"])})
        elif isinstance(gimg, str):
            signed_garment_images.append(storage_service.sign_if_private(gimg))
        else:
            signed_garment_images.append(gimg)

    # Resolve product URL
    product_url = garment.product_url or garment.scraped_from_url if garment else None

    # Resolve size recommendation
    scan_result = await db.execute(
        select(BodyScan)
        .where(BodyScan.user_id == user.id)
        .order_by(BodyScan.created_at.desc())
    )
    scan = scan_result.scalars().first()
    size: dict = {
        "size": None,
        "confidence": None,
        "fit_description": None,
        "chest_fit": None,
        "shoulder_fit": None,
        "skin_tone_note": None,
    }
    if settings.enable_body_analysis and scan and garment and scan.body_profile_id:
        profile = await db.get(BodyProfile, scan.body_profile_id)
        if profile:
            size = recommend_size(profile, garment)

    price_val = None
    if garment and isinstance(garment.segmentation_masks, dict):
        meta = garment.segmentation_masks.get("extracted_metadata")
        if isinstance(meta, dict):
            price_val = meta.get("price")

    signed_results = [storage_service.sign_if_private(u) for u in (job.result_image_urls or [])]

    return TryOnDetailResponse(
        id=job.id,
        user_id=job.user_id,
        garment_id=job.garment_id,
        status=job.status,
        result_image_urls=signed_results,
        is_saved=bool(job.is_saved),
        saved_photo_id=job.saved_photo_id,
        saved_photo_name=job.saved_photo_name,
        created_at=job.created_at,
        completed_at=job.completed_at,
        title=garment.product_name if garment else "Virtual Look",
        brand=brand_name,
        platform=platform,
        product_url=product_url,
        affiliate_url=None,
        garment_image_url=signed_garment_image_url,
        garment_images=signed_garment_images,
        garment_type=garment.garment_type if garment else None,
        price=price_val,
        size_recommendation=size,
        fit_analysis={"cache_tier": job.cache_tier, "identity_lock": "ArcFace + IP-Adapter FaceID ready"},
        processing_time_seconds=job.processing_time_seconds,
    )


@router.get("/{job_id}/result", response_model=TryOnResultResponse)
async def result(
    job_id: str,
    x_anonymous_session_id: str | None = Header(default=None),
    user: User = Depends(get_current_user_or_anonymous),
    db: AsyncSession = Depends(get_db),
) -> TryOnResultResponse:
    try:
        job_uuid = uuid.UUID(str(job_id))
    except ValueError:
        raise api_error(404, "JOB_NOT_FOUND", "Try-on job was not found.", "ट्राई-ऑन जॉब नहीं मिला।")

    job = await db.get(TryOnJob, job_uuid)
    if job is None or str(job.user_id) != str(user.id):
        raise api_error(404, "JOB_NOT_FOUND", "Try-on job was not found.", "ट्राई-ऑन जॉब नहीं मिला।")

    # Anonymous session isolation check
    if user.email == settings.anonymous_website_user_email.lower() and job.runpod_job_id and job.runpod_job_id.startswith("anon_session:"):
        expected_session = job.runpod_job_id.split(":", 1)[1]
        if x_anonymous_session_id and x_anonymous_session_id.strip() != expected_session:
            raise api_error(403, "FORBIDDEN", "You do not have access to this anonymous try-on job.", "आपके पास इस जॉब की अनुमति नहीं है।")

    if job.status == "failed":
        raise api_error(
            422,
            "TRYON_FAILED",
            job.error_message or "Try-on generation failed. Please try again with a clearer photo.",
            "ट्राई-ऑन जनरेशन विफल रहा।",
        )

    garment = await db.get(Garment, job.garment_id)
    scan_result = await db.execute(
        select(BodyScan)
        .where(BodyScan.user_id == user.id)
        .order_by(BodyScan.created_at.desc())
    )
    scan = scan_result.scalars().first()

    size: dict = {
        "size": None,
        "confidence": None,
        "fit_description": None,
        "chest_fit": None,
        "shoulder_fit": None,
        "skin_tone_note": None,
    }
    
    if settings.enable_body_analysis and scan:
        profile = await db.get(BodyProfile, scan.body_profile_id) if scan.body_profile_id else None
        if garment and profile:
            size = recommend_size(profile, garment)

    signed_results = [storage_service.sign_if_private(u) for u in (job.result_image_urls or [])]

    return TryOnResultResponse(
        result_image_urls=signed_results,
        fit_analysis={"cache_tier": job.cache_tier, "identity_lock": "ArcFace + IP-Adapter FaceID ready"},
        size_recommendation=size,
        processing_time_seconds=job.processing_time_seconds,
    )

