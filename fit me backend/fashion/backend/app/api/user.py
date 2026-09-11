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

    from sqlalchemy import delete as sql_delete
    from app.models.user_saved_photo import UserSavedPhoto
    from app.models.body_scan import BodyScan
    from app.models.body_profile import BodyProfile
    from app.models.tryon_job import TryOnJob
    from app.models.ava import AVAConversation, AVAMessage, AVAPreference, AVASavedOutfit
    from app.models.product_intelligence import PIScan, PIAffiliateClick
    from app.services.storage_service import delete_user_photo, delete_images_from_storage

    # 1. Clean up user photos and tryon assets from storage
    try:
        saved_photos_stmt = select(UserSavedPhoto).where(UserSavedPhoto.user_id == user.id)
        saved_photos = (await db.execute(saved_photos_stmt)).scalars().all()
        for p in saved_photos:
            if p.storage_path:
                delete_user_photo(p.storage_path)

        scans_stmt = select(BodyScan).where(BodyScan.user_id == user.id)
        scans = (await db.execute(scans_stmt)).scalars().all()
        for s in scans:
            for ref in [s.front_photo_url_encrypted, s.back_photo_url_encrypted, s.left_photo_url_encrypted, s.right_photo_url_encrypted]:
                if ref:
                    delete_user_photo(ref)

        jobs_stmt = select(TryOnJob).where(TryOnJob.user_id == user.id)
        jobs = (await db.execute(jobs_stmt)).scalars().all()
        for j in jobs:
            if j.result_image_urls:
                delete_images_from_storage(j.result_image_urls)
    except Exception as storage_err:
        print(f"Notice: Storage cleanup warning during account deletion ({storage_err})")

    # 2. Explicitly remove all user records across all models
    try:
        # AVA messages and conversations
        user_conv_ids_stmt = select(AVAConversation.id).where(AVAConversation.user_id == user.id)
        await db.execute(sql_delete(AVAMessage).where(AVAMessage.conversation_id.in_(user_conv_ids_stmt)))
        await db.execute(sql_delete(AVAConversation).where(AVAConversation.user_id == user.id))
        await db.execute(sql_delete(AVAPreference).where(AVAPreference.user_id == user.id))
        await db.execute(sql_delete(AVASavedOutfit).where(AVASavedOutfit.user_id == user.id))

        # Try-on jobs, body scans, profiles, saved photos
        await db.execute(sql_delete(TryOnJob).where(TryOnJob.user_id == user.id))
        await db.execute(sql_delete(BodyScan).where(BodyScan.user_id == user.id))
        await db.execute(sql_delete(BodyProfile).where(BodyProfile.user_id == user.id))
        await db.execute(sql_delete(UserSavedPhoto).where(UserSavedPhoto.user_id == user.id))

        # Product intelligence scans and clicks
        await db.execute(sql_delete(PIScan).where(PIScan.user_id == str(user.id)))
        await db.execute(sql_delete(PIAffiliateClick).where(PIAffiliateClick.user_id == str(user.id)))
    except Exception as cascade_err:
        print(f"Notice: Cascade records cleanup warning ({cascade_err})")

    # 3. Delete user record
    await db.delete(user)
    await db.commit()

    return {"status": "deleted", "message": "User account and all personal data permanently deleted."}

