import uuid
from datetime import date, datetime

from pydantic import BaseModel, EmailStr, Field


class BrandRegister(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)


class BrandUpdate(BaseModel):
    name: str | None = Field(default=None, max_length=255)
    shopify_store_url: str | None = Field(default=None, max_length=500)
    woocommerce_site_url: str | None = Field(default=None, max_length=500)
    cors_origins: list[str] | None = None


class BrandPublic(BaseModel):
    id: uuid.UUID
    name: str
    email: EmailStr
    shopify_store_url: str | None
    woocommerce_site_url: str | None
    plan: str
    try_ons_used_this_month: int
    try_ons_limit: int
    billing_period_start: date | None
    cors_origins: list[str]
    created_at: datetime

    model_config = {"from_attributes": True}


class BrandRegisterResponse(BaseModel):
    brand: BrandPublic
    api_key: str


class ApiKeyResponse(BaseModel):
    api_key: str


class AnalyticsResponse(BaseModel):
    try_on_count: int
    conversion_rate: float
    return_rate_reduction: float
    size_accuracy: float
    top_products: list[dict]
    try_on_by_garment_type: list[dict]

