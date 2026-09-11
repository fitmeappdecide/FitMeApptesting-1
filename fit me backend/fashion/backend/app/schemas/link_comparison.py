from __future__ import annotations

import uuid
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field


class URLProductCompareRequest(BaseModel):
    job_id: Optional[uuid.UUID] = Field(default=None, description="Optional Try-on job ID")
    source_url: Optional[str] = Field(default=None, description="Authoritative source product URL")
    brand: Optional[str] = Field(default=None, description="Authoritative extracted brand")
    title: Optional[str] = Field(default=None, description="Authoritative extracted title")
    price: Optional[float] = Field(default=None, description="Source product price")
    original_price: Optional[float] = Field(default=None, description="Source product MRP")
    image_url: Optional[str] = Field(default=None, description="Canonical product image URL")
    retailer: Optional[str] = Field(default=None, description="Source platform name")


class URLProductOffer(BaseModel):
    id: str
    retailer: str
    platform: str
    title: str
    url: str
    image_url: Optional[str] = None
    price: Optional[float] = None
    formatted_price: str
    original_price: Optional[float] = None
    formatted_original_price: Optional[str] = None
    discount_pct: Optional[int] = None
    discount_text: Optional[str] = None
    is_exact: bool = True
    match_confidence: float = 100.0
    is_best_deal: bool = False
    price_source: Optional[str] = None
    delivery_note: Optional[str] = "Free delivery"


class URLProductCompareResponse(BaseModel):
    source_product: Dict[str, Any]
    best_deal_id: Optional[str] = None
    best_price: Optional[float] = None
    best_retailer: Optional[str] = None
    candidates: List[URLProductOffer] = []
    total_exact_stores: int = 0
