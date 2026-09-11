import json

from fastapi import APIRouter, Depends, File, Form, UploadFile, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import api_error, get_brand_from_api_key, get_current_user
from app.core.database import get_db
from app.models.brand import Brand
from app.models.garment import Garment
from app.models.user import User
from app.schemas.garment import GarmentPublic, GarmentUpdate
from app.services.garment_analysis import analyse_garment
from app.services.storage_service import cdn_url_for_private_ref, build_encrypted_storage_ref, upload_image_to_storage
from app.utils.validators import validate_image_upload

router = APIRouter(prefix="/api/v1/garment", tags=["garment"])


@router.post("/upload", response_model=GarmentPublic, status_code=status.HTTP_201_CREATED)
async def upload_garment(
    product_name: str = Form(...),
    product_url: str | None = Form(default=None),
    garment_type_hint: str = Form(default="unknown"),
    size_chart: str = Form(default="{}"),
    images: list[UploadFile] = File(default=[]),
    brand: Brand = Depends(get_brand_from_api_key),
    db: AsyncSession = Depends(get_db),
) -> GarmentPublic:
    image_rows = []
    for index, image in enumerate(images):
        img_bytes = await validate_image_upload(image)
        private_ref = build_encrypted_storage_ref("garments", image.filename or f"garment-{index}.jpg")
        upload_image_to_storage(img_bytes, private_ref)
        image_rows.append({"url": cdn_url_for_private_ref(private_ref), "angle": "front" if index == 0 else f"angle-{index + 1}"})
    analysis = analyse_garment(product_name, garment_type_hint, image_rows)
    garment = Garment(
        brand_id=brand.id,
        product_name=product_name,
        product_url=product_url,
        images=image_rows,
        garment_type=analysis["garment_type"],
        segmentation_masks=analysis["segmentation_masks"],
        fabric_type=analysis["fabric_type"],
        dominant_colours=analysis["dominant_colours"],
        size_chart=json.loads(size_chart),
        is_ethnic=analysis["is_ethnic"],
    )
    db.add(garment)
    await db.commit()
    await db.refresh(garment)
    return GarmentPublic.model_validate(garment)


@router.post("/user-upload", response_model=GarmentPublic, status_code=status.HTTP_201_CREATED)
async def user_upload_garment(
    product_name: str = Form(...),
    product_url: str | None = Form(default=None),
    garment_type_hint: str = Form(default="unknown"),
    size_chart: str = Form(default="{}"),
    images: list[UploadFile] = File(default=[]),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> GarmentPublic:
    """Consumer fallback route to manually upload a garment if scraping fails."""
    image_rows = []
    for index, image in enumerate(images):
        img_bytes = await validate_image_upload(image)
        private_ref = build_encrypted_storage_ref("garments", image.filename or f"garment-{index}.jpg")
        upload_image_to_storage(img_bytes, private_ref)
        image_rows.append({"url": cdn_url_for_private_ref(private_ref), "angle": "front" if index == 0 else f"angle-{index + 1}"})
        
    analysis = analyse_garment(product_name, garment_type_hint, image_rows)
    garment = Garment(
        brand_id=None,  # User-uploaded garments don't belong to a brand
        product_name=product_name,
        product_url=product_url,
        images=image_rows,
        garment_type=analysis["garment_type"],
        segmentation_masks=analysis["segmentation_masks"],
        fabric_type=analysis["fabric_type"],
        dominant_colours=analysis["dominant_colours"],
        size_chart=json.loads(size_chart),
        is_ethnic=analysis["is_ethnic"],
    )
    db.add(garment)
    await db.commit()
    await db.refresh(garment)
    return GarmentPublic.model_validate(garment)


@router.get("/brand/garments", response_model=list[GarmentPublic])
async def brand_garments(brand: Brand = Depends(get_brand_from_api_key), db: AsyncSession = Depends(get_db), page: int = 1, limit: int = 20) -> list[GarmentPublic]:
    result = await db.execute(select(Garment).where(Garment.brand_id == brand.id).offset((page - 1) * limit).limit(limit))
    return [GarmentPublic.model_validate(item) for item in result.scalars().all()]


@router.get("/{id}", response_model=GarmentPublic)
async def get_garment(id: str, db: AsyncSession = Depends(get_db)) -> GarmentPublic:
    garment = await db.get(Garment, id)
    if garment is None:
        raise api_error(404, "GARMENT_NOT_FOUND", "Garment was not found.", "गारमेंट नहीं मिला।")
    return GarmentPublic.model_validate(garment)


@router.put("/{id}", response_model=GarmentPublic)
async def update_garment(id: str, payload: GarmentUpdate, brand: Brand = Depends(get_brand_from_api_key), db: AsyncSession = Depends(get_db)) -> GarmentPublic:
    garment = await db.get(Garment, id)
    if garment is None or garment.brand_id != brand.id:
        raise api_error(404, "GARMENT_NOT_FOUND", "Garment was not found.", "गारमेंट नहीं मिला।")
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(garment, key, value)
    await db.commit()
    await db.refresh(garment)
    return GarmentPublic.model_validate(garment)


@router.delete("/{id}")
async def delete_garment(id: str, brand: Brand = Depends(get_brand_from_api_key), db: AsyncSession = Depends(get_db)) -> dict:
    garment = await db.get(Garment, id)
    if garment is None or garment.brand_id != brand.id:
        raise api_error(404, "GARMENT_NOT_FOUND", "Garment was not found.", "गारमेंट नहीं मिला।")
    await db.delete(garment)
    await db.commit()
    return {"status": "deleted"}

