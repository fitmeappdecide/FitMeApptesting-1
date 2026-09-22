import uuid
from datetime import datetime

from pydantic import BaseModel, model_validator


class TryOnStartRequest(BaseModel):
    garment_id: uuid.UUID
    scan_id: uuid.UUID | None = None
    saved_photo_id: uuid.UUID | None = None

    @model_validator(mode="after")
    def check_photo_source(self) -> "TryOnStartRequest":
        if not self.scan_id and not self.saved_photo_id:
            raise ValueError("Either scan_id or saved_photo_id must be provided.")
        return self


class TryOnStartResponse(BaseModel):
    job_id: uuid.UUID
    estimated_seconds: int
    cache_tier: str | None = None
    status: str | None = None
    result_image_urls: list[str] | None = None


class TryOnStatusResponse(BaseModel):
    id: uuid.UUID
    status: str
    progress_pct: int
    current_step: str
    error_message: str | None = None


class TryOnResultResponse(BaseModel):
    result_image_urls: list[str]
    fit_analysis: dict
    size_recommendation: dict
    processing_time_seconds: float | None


class TryOnHistoryItem(BaseModel):
    id: uuid.UUID
    garment_id: uuid.UUID
    status: str
    result_image_urls: list[str]
    thumbnail_url: str | None = None
    created_at: datetime
    is_saved: bool = False
    saved_photo_id: uuid.UUID | None = None
    saved_photo_name: str | None = None
    title: str | None = None
    brand: str | None = None
    platform: str | None = None

    model_config = {"from_attributes": True}


class TryOnToggleSaveResponse(BaseModel):
    success: bool
    job_id: uuid.UUID
    is_saved: bool


class TryOnDeleteResponse(BaseModel):
    success: bool
    deleted: int


class TryOnDetailResponse(BaseModel):
    id: uuid.UUID
    user_id: uuid.UUID
    garment_id: uuid.UUID
    status: str
    result_image_urls: list[str]
    is_saved: bool = False
    saved_photo_id: uuid.UUID | None = None
    saved_photo_name: str | None = None
    created_at: datetime
    completed_at: datetime | None = None

    # Product & Brand Metadata
    title: str
    brand: str
    platform: str | None = None
    product_url: str | None = None
    affiliate_url: str | None = None
    garment_image_url: str | None = None
    garment_images: list[dict] = []
    garment_type: str | None = None
    price: str | None = None

    # Size Recommendation & Analysis
    size_recommendation: dict | None = None
    fit_analysis: dict | None = None
    processing_time_seconds: float | None = None

    model_config = {"from_attributes": True}



