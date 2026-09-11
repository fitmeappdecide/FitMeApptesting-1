from datetime import UTC, datetime, timedelta
import hashlib
from fastapi import APIRouter, Depends, File, Header, UploadFile, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import api_error, get_current_user, get_current_user_or_anonymous
from app.core.config import settings
from app.core.database import get_db
from app.models.body_profile import BodyProfile
from app.models.body_scan import BodyScan
from app.models.user import User
from app.models.user_saved_photo import UserSavedPhoto
from app.schemas.scan import ScanStatusResponse, ScanUploadResponse
from app.schemas.user import BodyProfilePublic
from app.services.body_analysis import analyse_body, cluster_key
import os
from app.services.storage_service import (
    build_encrypted_storage_ref,
    optimize_user_photo,
    upload_image_to_storage,
)
from app.utils.encryption import encrypt_text
from app.utils.validators import validate_image_upload

router = APIRouter(prefix="/api/v1/scan", tags=["scan"])


from app.utils.telemetry import TelemetryTimer

@router.post("/upload", response_model=ScanUploadResponse, status_code=status.HTTP_201_CREATED)
async def upload_scan(
    front: UploadFile = File(...),
    back: UploadFile | None = File(default=None),
    left: UploadFile | None = File(default=None),
    right: UploadFile | None = File(default=None),
    x_consent_given: bool = Header(default=False),
    user: User = Depends(get_current_user_or_anonymous),
    db: AsyncSession = Depends(get_db),
) -> ScanUploadResponse:
    with TelemetryTimer("POST /api/v1/scan/upload") as timer:
        if not x_consent_given:
            raise api_error(
                400,
                "CONSENT_REQUIRED",
                "Consent is required before processing body photos.",
                "शरीर की तस्वीरें प्रोसेस करने से पहले सहमति आवश्यक है।",
            )
        try:
            front_bytes = await validate_image_upload(front)
            back_bytes = await validate_image_upload(back) if isinstance(back, UploadFile) else None
            left_bytes = await validate_image_upload(left) if isinstance(left, UploadFile) else None
            right_bytes = await validate_image_upload(right) if isinstance(right, UploadFile) else None
            timer.mark("1. Image Validation Completed")
        except ValueError as exc:
            raise api_error(400, "INVALID_IMAGE", str(exc), "छवि अमान्य है।") from exc

        # Upload optimized images to Supabase Storage and keep the encrypted reference.
        front_opt_bytes, front_mime = optimize_user_photo(front_bytes, max_dim=1200, quality=85)
        front_ext = ".webp" if "webp" in front_mime else ".jpg"
        front_base = os.path.splitext(front.filename or "front.jpg")[0]
        front_ref = build_encrypted_storage_ref("scans", f"{front_base}{front_ext}")
        upload_image_to_storage(front_opt_bytes, front_ref)
        timer.mark("2. Front Photo Uploaded to Supabase Storage")

        back_ref = None
        if back_bytes and back:
            back_opt, back_mime = optimize_user_photo(back_bytes, max_dim=1200, quality=85)
            back_ext = ".webp" if "webp" in back_mime else ".jpg"
            back_base = os.path.splitext(back.filename or "back.jpg")[0]
            back_ref = build_encrypted_storage_ref("scans", f"{back_base}{back_ext}")
            upload_image_to_storage(back_opt, back_ref)
        left_ref = None
        if left_bytes and left:
            left_opt, left_mime = optimize_user_photo(left_bytes, max_dim=1200, quality=85)
            left_ext = ".webp" if "webp" in left_mime else ".jpg"
            left_base = os.path.splitext(left.filename or "left.jpg")[0]
            left_ref = build_encrypted_storage_ref("scans", f"{left_base}{left_ext}")
            upload_image_to_storage(left_opt, left_ref)
        right_ref = None
        if right_bytes and right:
            right_opt, right_mime = optimize_user_photo(right_bytes, max_dim=1200, quality=85)
            right_ext = ".webp" if "webp" in right_mime else ".jpg"
            right_base = os.path.splitext(right.filename or "right.jpg")[0]
            right_ref = build_encrypted_storage_ref("scans", f"{right_base}{right_ext}")
            upload_image_to_storage(right_opt, right_ref)

        profile_id = None
        smplx_params = None

    if settings.enable_body_analysis:
        print(f"DEBUG: enable_body_analysis flag = {settings.enable_body_analysis}")
        measurements = analyse_body(front_bytes, back_bytes, left_bytes, right_bytes)
        profile = BodyProfile(
            user_id=user.id,
            height_cm=measurements.height_cm,
            chest_cm=measurements.chest_cm,
            waist_cm=measurements.waist_cm,
            hips_cm=measurements.hips_cm,
            shoulder_width_cm=measurements.shoulder_width_cm,
            inseam_cm=measurements.inseam_cm,
            sleeve_cm=measurements.sleeve_cm,
            skin_tone_fitzpatrick=measurements.skin_tone_fitzpatrick,
            skin_tone_hex=measurements.skin_tone_hex,
            body_type=measurements.body_type,
            face_embedding_ref=measurements.face_embedding_ref,
            cluster_key=cluster_key(measurements),
        )
        db.add(profile)
        await db.flush()
        profile_id = profile.id
        smplx_params = measurements.smplx_params

    scan = BodyScan(
        user_id=user.id,
        front_photo_url_encrypted=encrypt_text(front_ref),
        back_photo_url_encrypted=encrypt_text(back_ref) if back_ref else None,
        left_photo_url_encrypted=encrypt_text(left_ref) if left_ref else None,
        right_photo_url_encrypted=encrypt_text(right_ref) if right_ref else None,
        smplx_params=smplx_params,
        processing_status="completed",
        body_profile_id=profile_id,
        consent_given=True,
        photos_deleted_at=datetime.now(UTC) + timedelta(hours=24),
    )
    db.add(scan)

    # Auto-save front photo into user's photo library if not already saved (checked by storage_path and content_hash)
    front_hash = hashlib.sha256(front_bytes).hexdigest()
    existing_photo = (await db.scalars(
        select(UserSavedPhoto).where(
            UserSavedPhoto.user_id == user.id,
            (UserSavedPhoto.storage_path == front_ref) | (UserSavedPhoto.content_hash == front_hash),
        )
    )).first()
    if not existing_photo:
        existing_names = set((await db.scalars(
            select(UserSavedPhoto.display_name).where(UserSavedPhoto.user_id == user.id)
        )).all())
        n = 1
        while f"My Photo {n}" in existing_names:
            n += 1
        db.add(UserSavedPhoto(
            user_id=user.id,
            storage_path=front_ref,
            display_name=f"My Photo {n}",
            original_filename=front.filename or "front.jpg",
            mime_type=front.content_type or "image/jpeg",
            content_hash=front_hash,
        ))

    try:
        await db.commit()
    except Exception:
        # If a race condition occurred in auto-save, rollback the auto-save insert and re-commit the scan
        await db.rollback()
        db.add(scan)
        await db.commit()

    await db.refresh(scan)
    print("Returning ScanUploadResponse")
    return ScanUploadResponse(scan_id=scan.id, status=scan.processing_status)


@router.get("/{scan_id}", response_model=ScanStatusResponse)
async def get_scan(
    scan_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> ScanStatusResponse:
    scan = await db.get(BodyScan, scan_id)
    if scan is None:
        raise api_error(404, "SCAN_NOT_FOUND", "Body scan was not found.", "बॉडी स्कैन नहीं मिला।")
    profile = await db.get(BodyProfile, scan.body_profile_id) if scan.body_profile_id else None
    measurements = {}
    if profile:
        measurements = {"height_cm": profile.height_cm, "chest_cm": profile.chest_cm, "waist_cm": profile.waist_cm, "hips_cm": profile.hips_cm}
    return ScanStatusResponse(
        id=scan.id,
        status=scan.processing_status,
        body_profile=BodyProfilePublic.model_validate(profile) if profile else None,
        measurements=measurements,
        cluster_key=profile.cluster_key if profile else None,
        created_at=scan.created_at,
    )


@router.delete("/{scan_id}")
async def delete_scan(
    scan_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    scan = await db.get(BodyScan, scan_id)
    if scan is None or str(scan.user_id) != str(user.id):
        raise api_error(404, "SCAN_NOT_FOUND", "Body scan was not found.", "बॉडी स्कैन नहीं मिला।")
    await db.delete(scan)
    await db.commit()
    return {"status": "deleted"}
