import uuid

from pydantic import BaseModel, Field


class ProductFromUrlRequest(BaseModel):
    url: str


class ProductFromExtensionRequest(BaseModel):
    title: str
    brand: str | None = None
    price: str | None = None
    images: list[str] = Field(default_factory=list)
    sizes: list[str] = Field(default_factory=list)
    source_url: str | None = None
    platform: str | None = None
    source_type: str | None = None


class ProductResponse(BaseModel):
    product_id: uuid.UUID
    status: str
    product: dict
    fallback_required: bool = False


class CompareStartResponse(BaseModel):
    job_id: uuid.UUID
    status: str


class CompareResultResponse(BaseModel):
    status: str
    comparisons: list[dict]


class LookupKnownProductRequest(BaseModel):
    url: str


class LookupKnownProductResponse(BaseModel):
    found: bool
    product_id: uuid.UUID | None = None
    product: dict | None = None


class RecommendedProduct(BaseModel):
    id: str
    slot: str
    title: str
    brand: str
    price: str
    numeric_price: float | None = None
    image: str
    category: str
    retailer: str
    product_url: str


class CompleteTheLookResponse(BaseModel):
    theme: str
    source_garment: dict = Field(default_factory=dict)
    recommendations: list[RecommendedProduct] = Field(default_factory=list)



