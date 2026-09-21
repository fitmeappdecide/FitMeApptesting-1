from fastapi import APIRouter, Depends, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.core.database import get_db
from app.models.body_profile import BodyProfile
from app.models.tryon_job import TryOnJob
from app.models.user import User
from app.schemas.auth import UserPublic
from app.schemas.user import BodyProfilePublic, UserProfile, UserUpdate

router = APIRouter(prefix="/api/v1/user", tags=["user"])


@router.get("/profile", response_model=UserProfile)
async def profile(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)) -> UserProfile:
    result = await db.execute(select(BodyProfile).where(BodyProfile.user_id == user.id).order_by(BodyProfile.created_at.desc()))
    body_profile = result.scalars().first()
    
    try_on_count = await db.scalar(
        select(func.count()).select_from(TryOnJob).where(TryOnJob.user_id == user.id)
    ) or 0
    
    saved_count = await db.scalar(
        select(func.count()).select_from(TryOnJob).where(TryOnJob.user_id == user.id, TryOnJob.is_saved == True)
    ) or 0
    
    return UserProfile(
        user=UserPublic.model_validate(user),
        body_profile=BodyProfilePublic.model_validate(body_profile) if body_profile else None,
        try_on_count=int(try_on_count),
        saved_count=int(saved_count),
    )


@router.put("/profile", response_model=UserPublic)
async def update_profile(payload: UserUpdate, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)) -> UserPublic:
    user.full_name = payload.full_name
    await db.commit()
    await db.refresh(user)
    return UserPublic.model_validate(user)


@router.delete("/account", status_code=status.HTTP_200_OK)
async def delete_account(current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)) -> dict:
    stmt = select(User).where(User.id == current_user.id)
    user = (await db.execute(stmt)).scalar_one_or_none()
    if not user:
        return {"status": "deleted", "message": "User account and all personal data permanently deleted."}

    user_email = user.email
    user_id = user.id

    import uuid
    from sqlalchemy import delete as sql_delete, func
    from app.models.user_saved_photo import UserSavedPhoto
    from app.models.body_scan import BodyScan
    from app.models.body_profile import BodyProfile
    from app.models.tryon_job import TryOnJob
    from app.models.garment import Garment
    from app.models.size_recommendation import SizeRecommendation
    from app.models.ava import AVAConversation, AVAMessage, AVAPreference, AVASavedOutfit
    from app.models.product_intelligence import PIScan, PIAffiliateClick, PIAnalyticsEvent
    from app.models.analytics import AnalyticsEvent
    from app.services.storage_service import (
        delete_storage_objects_batched,
        delete_garment_images_from_storage,
        is_user_uploaded_garment,
        get_garment_storage_paths,
        decrypt_text,
        extract_storage_path,
    )
    from app.core.firebase import delete_firebase_user

    storage_paths_to_delete: set[str] = set()
    garment_ids_to_check: set[uuid.UUID] = set()

    # PHASE 1: Fast in-memory collection of all user storage paths and garments
    try:
        # User saved photos
        saved_photos_stmt = select(UserSavedPhoto.storage_path).where(UserSavedPhoto.user_id == user_id)
        photo_paths = (await db.execute(saved_photos_stmt)).scalars().all()
        for p in photo_paths:
            if p:
                storage_paths_to_delete.add(p)

        # Body scans (decrypt paths if encrypted)
        scans_stmt = select(
            BodyScan.front_photo_url_encrypted,
            BodyScan.back_photo_url_encrypted,
            BodyScan.left_photo_url_encrypted,
            BodyScan.right_photo_url_encrypted,
        ).where(BodyScan.user_id == user_id)
        scan_rows = (await db.execute(scans_stmt)).all()
        for row in scan_rows:
            for enc_ref in row:
                if enc_ref:
                    try:
                        dec_ref = decrypt_text(enc_ref)
                    except Exception:
                        dec_ref = enc_ref
                    clean_path = extract_storage_path(dec_ref)
                    if clean_path:
                        storage_paths_to_delete.add(clean_path)

        # Try-on jobs & result images
        jobs_stmt = select(TryOnJob.result_image_urls, TryOnJob.garment_id).where(TryOnJob.user_id == user_id)
        job_rows = (await db.execute(jobs_stmt)).all()
        for res_urls, gid in job_rows:
            if res_urls and isinstance(res_urls, list):
                for u in res_urls:
                    if u:
                        storage_paths_to_delete.add(u)
            if gid:
                garment_ids_to_check.add(gid)

        # Reference-aware check for user-uploaded garments
        for gid in garment_ids_to_check:
            try:
                garment = await db.get(Garment, gid)
                if garment and is_user_uploaded_garment(garment):
                    # Check if any OTHER user still references this garment
                    remaining_count = (await db.execute(
                        select(func.count(TryOnJob.id)).where(TryOnJob.garment_id == gid, TryOnJob.user_id != user_id)
                    )).scalar() or 0

                    if remaining_count == 0:
                        g_paths = get_garment_storage_paths(garment)
                        await db.delete(garment)
                        if g_paths:
                            delete_garment_images_from_storage(g_paths)
            except Exception as g_err:
                print(f"Notice: Garment check warning on delete_account ({g_err})")
    except Exception as collect_err:
        print(f"Notice: Storage path collection warning ({collect_err})")

    # PHASE 2: Firebase Auth deletion (preserves DB state for retry if Firebase fails)
    try:
        if user_email:
            delete_firebase_user(email=user_email)
    except Exception as fb_err:
        print(f"Notice: Firebase Auth deletion failed during account deletion: {fb_err}")
        from app.api.deps import api_error
        raise api_error(
            status.HTTP_502_BAD_GATEWAY,
            "FIREBASE_DELETION_FAILED",
            f"Failed to delete Firebase authentication identity ({str(fb_err)}). Please retry.",
            "फायरबेस प्रमाणीकरण हटाने में विफल रहा। कृपया पुनः प्रयास करें।"
        )

    # PHASE 3: Complete database cascading deletion & COMMIT immediately
    # (Releases DB connection back to pool so no idle session is held during storage batch deletion)
    try:
        # AVA messages and conversations
        user_conv_ids_stmt = select(AVAConversation.id).where(AVAConversation.user_id == user_id)
        await db.execute(sql_delete(AVAMessage).where(AVAMessage.conversation_id.in_(user_conv_ids_stmt)))
        await db.execute(sql_delete(AVAConversation).where(AVAConversation.user_id == user_id))
        await db.execute(sql_delete(AVAPreference).where(AVAPreference.user_id == user_id))
        await db.execute(sql_delete(AVASavedOutfit).where(AVASavedOutfit.user_id == user_id))

        # Try-on jobs, body scans, profiles, saved photos, size recommendations
        await db.execute(sql_delete(TryOnJob).where(TryOnJob.user_id == user_id))
        await db.execute(sql_delete(BodyScan).where(BodyScan.user_id == user_id))
        await db.execute(sql_delete(BodyProfile).where(BodyProfile.user_id == user_id))
        await db.execute(sql_delete(UserSavedPhoto).where(UserSavedPhoto.user_id == user_id))
        await db.execute(sql_delete(SizeRecommendation).where(SizeRecommendation.user_id == user_id))

        # Product intelligence scans, clicks, and analytics events
        await db.execute(sql_delete(PIScan).where(PIScan.user_id == str(user_id)))
        await db.execute(sql_delete(PIAffiliateClick).where(PIAffiliateClick.user_id == str(user_id)))
        await db.execute(sql_delete(PIAnalyticsEvent).where(PIAnalyticsEvent.user_id == str(user_id)))
        await db.execute(sql_delete(AnalyticsEvent).where(AnalyticsEvent.user_id == user_id))

        # Delete user record and commit
        await db.delete(user)
        await db.commit()
    except Exception as db_err:
        await db.rollback()
        print(f"Error: Database deletion failed: {db_err}")
        from app.api.deps import api_error
        raise api_error(
            status.HTTP_500_INTERNAL_SERVER_ERROR,
            "DATABASE_DELETION_FAILED",
            f"Failed to delete account database records: {str(db_err)}"
        )

    # PHASE 4: Batch Storage Deletion (Zero DB connection held, all keys batched)
    if storage_paths_to_delete:
        try:
            delete_storage_objects_batched(storage_paths_to_delete, batch_size=50)
        except Exception as storage_err:
            print(f"Notice: Batch storage cleanup notice ({storage_err})")

    return {"status": "deleted", "message": "User account and all personal data permanently deleted."}


