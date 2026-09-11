import uuid
from datetime import datetime

from pydantic import BaseModel, Field, HttpUrl


class GarmentImage(BaseModel):
    url: str
    angle: str = "front"
    width: int | None = None
    height: int | None = None


class GarmentCreate(BaseModel):
    product_name: str = Field(min_length=1, max_length=500)
    product_url: str | None = None
    garment_type_hint: str = "unknown"
    size_chart: dict = Field(default_factory=dict)
    images: list[GarmentImage] = Field(default_factory=list)


class GarmentUpdate(BaseModel):
    product_name: str | None = Field(default=None, max_length=500)
    product_url: str | None = None
    garment_type: str | None = None
    size_chart: dict | None = None


class GarmentPublic(BaseModel):
    id: uuid.UUID
    brand_id: uuid.UUID | None
    product_name: str
    product_url: str | None
    images: list[dict]
    garment_type: str
    fabric_type: str | None
    dominant_colours: list[str]
    size_chart: dict
    is_ethnic: bool
    scraped_from_url: str | None
    created_at: datetime

    model_config = {"from_attributes": True}

