from datetime import datetime
import uuid

from pydantic import BaseModel, Field


class SavedPhotoPublic(BaseModel):
    id: uuid.UUID
    user_id: uuid.UUID
    display_name: str
    storage_path: str
    original_filename: str | None = None
    mime_type: str = "image/jpeg"
    signed_url: str | None = None
    scan_id: uuid.UUID | None = None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class SavedPhotoRenameRequest(BaseModel):
    display_name: str = Field(..., min_length=1, max_length=100)


class SavedPhotoListResponse(BaseModel):
    items: list[SavedPhotoPublic]
