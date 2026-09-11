from pydantic import BaseModel
from fastapi import APIRouter, Depends

from app.api.deps import get_brand_from_api_key
from app.models.brand import Brand

router = APIRouter(prefix="/api/v1/widget", tags=["widget"])


class WidgetTryOnRequest(BaseModel):
    product_url: str
    scan_id: str


@router.post("/tryon")
async def widget_tryon(payload: WidgetTryOnRequest, brand: Brand = Depends(get_brand_from_api_key)) -> dict:
    return {"job_id": f"widget-{brand.id}-{payload.scan_id}", "status": "queued", "product_url": payload.product_url}

