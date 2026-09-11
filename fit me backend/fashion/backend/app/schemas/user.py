import uuid
from datetime import datetime

from pydantic import BaseModel, Field

from app.schemas.auth import UserPublic


class BodyProfilePublic(BaseModel):
    id: uuid.UUID
    height_cm: float | None
    chest_cm: float | None
    waist_cm: float | None
    hips_cm: float | None
    shoulder_width_cm: float | None
    inseam_cm: float | None
    sleeve_cm: float | None
    skin_tone_fitzpatrick: int | None
    skin_tone_hex: str | None
    body_type: str | None
    cluster_key: str | None
    created_at: datetime

    model_config = {"from_attributes": True}


class UserProfile(BaseModel):
    user: UserPublic
    body_profile: BodyProfilePublic | None
    try_on_count: int = 0
    saved_count: int = 0


class UserUpdate(BaseModel):
    full_name: str = Field(min_length=1, max_length=255)

