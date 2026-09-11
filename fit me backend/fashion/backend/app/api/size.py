from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import api_error, get_current_user
from app.core.database import get_db
from app.models.body_scan import BodyScan
from app.models.body_profile import BodyProfile
from app.models.garment import Garment
from app.models.size_recommendation import SizeRecommendation
from app.models.user import User
from app.schemas.size import SizeFeedbackRequest, SizeRecommendRequest, SizeRecommendResponse
from app.services.size_recommendation import recommend_size

router = APIRouter(prefix="/api/v1/size", tags=["size"])


@router.post("/recommend", response_model=SizeRecommendResponse)
async def recommend(payload: SizeRecommendRequest, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)) -> SizeRecommendResponse:
    scan = await db.get(BodyScan, payload.scan_id)
    garment = await db.get(Garment, payload.garment_id)
    if scan is None or str(scan.user_id) != str(user.id):
        raise api_error(404, "SCAN_NOT_FOUND", "Body scan was not found.", "बॉडी स्कैन नहीं मिला।")
    if garment is None:
        raise api_error(404, "GARMENT_NOT_FOUND", "Garment was not found.", "गारमेंट नहीं मिला।")
    profile = await db.get(BodyProfile, scan.body_profile_id) if scan.body_profile_id else None
    if profile is None:
        raise api_error(422, "PROFILE_NOT_READY", "Body profile is not ready yet.", "बॉडी प्रोफाइल अभी तैयार नहीं है।")
    result = recommend_size(profile, garment)
    db.add(SizeRecommendation(user_id=user.id, garment_id=garment.id, brand_id=payload.brand_id or garment.brand_id, recommended_size=result["size"], confidence_score=result["confidence"], fit_description=result["fit_description"], chest_fit=result["chest_fit"], shoulder_fit=result["shoulder_fit"], skin_tone_note=result["skin_tone_note"]))
    await db.commit()
    return SizeRecommendResponse(**result)


@router.post("/feedback", status_code=status.HTTP_202_ACCEPTED)
async def feedback(payload: SizeFeedbackRequest, user: User = Depends(get_current_user)) -> dict:
    return {"status": "accepted", "job_id": str(payload.job_id), "actual_size": payload.actual_size, "user_id": str(user.id)}
