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


@router.delete("/account", status_code=status.HTTP_202_ACCEPTED)
async def delete_account(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)) -> dict:
    user.is_active = False
    await db.commit()
    return {"status": "deletion_scheduled", "complete_within_hours": 24}

