from datetime import UTC, datetime
import hashlib
import os
import re
import uuid

from fastapi import APIRouter, Depends, File, Form, UploadFile, status
from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import api_error, get_current_user, get_current_user_or_anonymous
from app.core.config import settings
from app.core.database import get_db
from app.models.tryon_job import TryOnJob
from app.models.user import User
from app.models.user_saved_photo import UserSavedPhoto
from app.schemas.saved_photo import SavedPhotoPublic, SavedPhotoRenameRequest
from app.services.storage_service import (
    build_encrypted_storage_ref,
    create_signed_photo_url,
    delete_user_photo,
    optimize_user_photo,
    upload_user_photo,
)
from app.utils.validators import validate_image_upload

router = APIRouter(prefix="/api/v1/photos", tags=["saved_photos"])

AUTO_NAME_PATTERN = re.compile(r"^(My Photo \d+|photo\.jpg)$", re.IGNORECASE)


def _to_public_schema(photo: UserSavedPhoto) -> SavedPhotoPublic:
    signed_url = create_signed_photo_url(photo.storage_path, expires_in=3600)
    return SavedPhotoPublic(
        id=photo.id,
        user_id=photo.user_id,
        display_name=photo.display_name,
        storage_path=photo.storage_path,
        original_filename=photo.original_filename,
        mime_type=photo.mime_type,
        signed_url=signed_url,
        created_at=photo.created_at,
        updated_at=photo.updated_at,
    )


@router.post("/upload", response_model=SavedPhotoPublic, status_code=status.HTTP_201_CREATED)
async def upload_saved_photo(
    file: UploadFile = File(...),
    display_name: str | None = Form(None),
    user: User = Depends(get_current_user_or_anonymous),
    db: AsyncSession = Depends(get_db),
) -> SavedPhotoPublic:
    try:
        image_bytes = await validate_image_upload(file)
    except ValueError as exc:
        raise api_error(400, "INVALID_IMAGE", str(exc), "छवि अमान्य है।") from exc

    content_hash = hashlib.sha256(image_bytes).hexdigest()

    # 1. Pre-upload duplicate check: if the user already has this exact photo, reuse it immediately (0 storage uploads)
    existing_stmt = select(UserSavedPhoto).where(
        UserSavedPhoto.user_id == user.id,
        UserSavedPhoto.content_hash == content_hash,
    )
    existing_photo = (await db.scalars(existing_stmt)).first()
    if existing_photo:
        return _to_public_schema(existing_photo)

    # 2. Genuinely new image: compute auto-name
    clean_name = display_name.strip() if isinstance(display_name, str) and display_name.strip() else None
    if not clean_name:
        stmt = select(UserSavedPhoto.display_name).where(UserSavedPhoto.user_id == user.id)
        result = await db.scalars(stmt)
        existing_names = set(result.all())
        n = 1
        while f"My Photo {n}" in existing_names:
            n += 1
        clean_name = f"My Photo {n}"

    photo_id = uuid.uuid4()
    original_filename = file.filename or "photo.jpg"
    base_name = os.path.splitext(original_filename)[0]

    # Optimize user photo (max 1200px, WebP q85)
    opt_bytes, mime_type = optimize_user_photo(image_bytes, max_dim=1200, quality=85)
    ext = ".webp" if "webp" in mime_type else ".jpg"
    storage_path = build_encrypted_storage_ref("scans", f"{base_name}{ext}")

    # Upload optimized bytes to Supabase storage
    upload_user_photo(opt_bytes, storage_path, mime_type)

    saved_photo = UserSavedPhoto(
        id=photo_id,
        user_id=user.id,
        storage_path=storage_path,
        display_name=clean_name,
        original_filename=original_filename,
        mime_type=mime_type,
        content_hash=content_hash,
    )
    db.add(saved_photo)
    try:
        await db.commit()
        await db.refresh(saved_photo)
        return _to_public_schema(saved_photo)
    except IntegrityError:
        # Race condition safety: another concurrent request committed this exact (user_id, content_hash)
        await db.rollback()
        # Immediately clean up the losing request's uploaded storage object to prevent orphan storage files
        try:
            delete_user_photo(storage_path)
        except Exception:
            pass
        # Return the winning canonical record
        winning_photo = (await db.scalars(existing_stmt)).first()
        if winning_photo:
            return _to_public_schema(winning_photo)
        raise


@router.get("/", response_model=list[SavedPhotoPublic])
async def list_saved_photos(
    user: User = Depends(get_current_user_or_anonymous),
    db: AsyncSession = Depends(get_db),
) -> list[SavedPhotoPublic]:
    # Privacy safeguard: anonymous visitors should never see a shared photo library
    if user.email == settings.anonymous_website_user_email.lower():
        return []

    stmt = (
        select(UserSavedPhoto)
        .where(UserSavedPhoto.user_id == user.id)
        .order_by(UserSavedPhoto.created_at.desc())
    )
    result = await db.scalars(stmt)
    photos = result.all()
    return [_to_public_schema(p) for p in photos]


@router.get("/{photo_id}/url")
async def get_photo_signed_url(
    photo_id: uuid.UUID,
    user: User = Depends(get_current_user_or_anonymous),
    db: AsyncSession = Depends(get_db),
) -> dict:
    photo = await db.get(UserSavedPhoto, photo_id)
    if not photo or str(photo.user_id) != str(user.id):
        raise api_error(404, "PHOTO_NOT_FOUND", "Saved photo was not found.", "सहेजी गई तस्वीर नहीं मिली।")

    signed_url = create_signed_photo_url(photo.storage_path, expires_in=3600)
    return {"url": signed_url, "photo_id": str(photo.id)}


@router.patch("/{photo_id}", response_model=SavedPhotoPublic)
async def rename_saved_photo(
    photo_id: uuid.UUID,
    req: SavedPhotoRenameRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> SavedPhotoPublic:
    photo = await db.get(UserSavedPhoto, photo_id)
    if not photo or str(photo.user_id) != str(user.id):
        raise api_error(404, "PHOTO_NOT_FOUND", "Saved photo was not found.", "सहेजी गई तस्वीर नहीं मिली।")

    new_name = req.display_name.strip()
    photo.display_name = new_name
    photo.updated_at = datetime.now(UTC)

    # Synchronize linked active TryOnJobs
    await db.execute(
        update(TryOnJob)
        .where(TryOnJob.saved_photo_id == photo.id)
        .values(saved_photo_name=new_name)
    )

    await db.commit()
    await db.refresh(photo)

    return _to_public_schema(photo)


@router.delete("/{photo_id}")
async def delete_saved_photo(
    photo_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    photo = await db.get(UserSavedPhoto, photo_id)
    if not photo or str(photo.user_id) != str(user.id):
        raise api_error(404, "PHOTO_NOT_FOUND", "Saved photo was not found.", "सहेजी गई तस्वीर नहीं मिली।")

    # Clean up storage
    delete_user_photo(photo.storage_path)

    # Explicitly clear saved_photo_id on associated tryon jobs while preserving saved_photo_name historical snapshot
    await db.execute(
        update(TryOnJob).where(TryOnJob.saved_photo_id == photo.id).values(saved_photo_id=None)
    )

    # Delete DB record
    await db.delete(photo)
    await db.flush()

    # Renumber remaining auto-named photos sequentially without gaps
    remaining_photos = (await db.execute(
        select(UserSavedPhoto)
        .where(UserSavedPhoto.user_id == user.id)
        .order_by(UserSavedPhoto.created_at.asc())
    )).scalars().all()

    auto_idx = 1
    for p in remaining_photos:
        if bool(AUTO_NAME_PATTERN.match(p.display_name.strip())):
            target_name = f"My Photo {auto_idx}"
            auto_idx += 1
            if p.display_name != target_name:
                p.display_name = target_name
                # Keep active linked TryOnJobs synchronized
                await db.execute(
                    update(TryOnJob)
                    .where(TryOnJob.saved_photo_id == p.id)
                    .values(saved_photo_name=target_name)
                )

    await db.commit()

    return {"status": "deleted", "id": str(photo_id)}
