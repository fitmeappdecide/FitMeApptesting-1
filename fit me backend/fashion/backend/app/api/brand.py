from fastapi import APIRouter, Depends, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import api_error, get_brand_from_api_key
from app.core.database import get_db
from app.core.security import generate_api_key, hash_api_key, hash_password, mask_api_key
from app.models.analytics import AnalyticsEvent
from app.models.brand import Brand
from app.models.garment import Garment
from app.schemas.brand import AnalyticsResponse, ApiKeyResponse, BrandPublic, BrandRegister, BrandRegisterResponse, BrandUpdate

router = APIRouter(prefix="/api/v1/brand", tags=["brand"])


@router.post("/register", response_model=BrandRegisterResponse, status_code=status.HTTP_201_CREATED)
async def register_brand(payload: BrandRegister, db: AsyncSession = Depends(get_db)) -> BrandRegisterResponse:
    existing = await db.execute(select(Brand).where(Brand.email == payload.email.lower()))
    if existing.scalar_one_or_none() is not None:
        raise api_error(400, "BRAND_EXISTS", "A brand with this email already exists.", "इस ईमेल वाला ब्रांड पहले से मौजूद है।")
    api_key = generate_api_key()
    brand = Brand(email=payload.email.lower(), name=payload.name, password_hash=hash_password(payload.password), api_key_hash=hash_api_key(api_key))
    db.add(brand)
    await db.commit()
    await db.refresh(brand)
    return BrandRegisterResponse(brand=BrandPublic.model_validate(brand), api_key=api_key)


@router.get("/profile", response_model=BrandPublic)
async def profile(brand: Brand = Depends(get_brand_from_api_key)) -> BrandPublic:
    return BrandPublic.model_validate(brand)


@router.put("/profile", response_model=BrandPublic)
async def update_profile(payload: BrandUpdate, brand: Brand = Depends(get_brand_from_api_key), db: AsyncSession = Depends(get_db)) -> BrandPublic:
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(brand, key, value)
    await db.commit()
    await db.refresh(brand)
    return BrandPublic.model_validate(brand)


@router.get("/analytics", response_model=AnalyticsResponse)
async def analytics(brand: Brand = Depends(get_brand_from_api_key), db: AsyncSession = Depends(get_db), period: str = "30d") -> AnalyticsResponse:
    tryon_count = await db.scalar(select(func.count()).select_from(AnalyticsEvent).where(AnalyticsEvent.brand_id == brand.id, AnalyticsEvent.event_type == "tryon_completed")) or 0
    garment_counts = await db.execute(select(Garment.garment_type, func.count()).where(Garment.brand_id == brand.id).group_by(Garment.garment_type))
    return AnalyticsResponse(
        try_on_count=int(tryon_count),
        conversion_rate=0.18,
        return_rate_reduction=0.12,
        size_accuracy=0.86,
        top_products=[],
        try_on_by_garment_type=[{"garment_type": row[0], "count": row[1]} for row in garment_counts.all()],
    )


@router.get("/api-key", response_model=ApiKeyResponse)
async def api_key(brand: Brand = Depends(get_brand_from_api_key)) -> ApiKeyResponse:
    return ApiKeyResponse(api_key=mask_api_key(brand.api_key_hash))


@router.post("/api-key/rotate", response_model=ApiKeyResponse)
async def rotate_api_key(brand: Brand = Depends(get_brand_from_api_key), db: AsyncSession = Depends(get_db)) -> ApiKeyResponse:
    api_key = generate_api_key()
    brand.api_key_hash = hash_api_key(api_key)
    await db.commit()
    return ApiKeyResponse(api_key=api_key)


@router.get("/garments")
async def garments(brand: Brand = Depends(get_brand_from_api_key), db: AsyncSession = Depends(get_db), page: int = 1, limit: int = 20) -> dict:
    result = await db.execute(select(Garment).where(Garment.brand_id == brand.id).offset((page - 1) * limit).limit(limit))
    return {"items": [{"id": str(item.id), "product_name": item.product_name, "garment_type": item.garment_type} for item in result.scalars().all()]}

