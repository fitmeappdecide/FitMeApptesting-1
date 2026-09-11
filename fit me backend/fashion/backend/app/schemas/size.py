import uuid

from pydantic import BaseModel


class SizeRecommendRequest(BaseModel):
    scan_id: uuid.UUID
    garment_id: uuid.UUID
    brand_id: uuid.UUID | None = None


class SizeRecommendResponse(BaseModel):
    size: str
    confidence: float
    fit_description: str
    chest_fit: str
    shoulder_fit: str
    skin_tone_note: str | None


class SizeFeedbackRequest(BaseModel):
    job_id: uuid.UUID
    actual_size: str

