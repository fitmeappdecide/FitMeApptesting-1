import uuid
from datetime import datetime

from pydantic import BaseModel

from app.schemas.user import BodyProfilePublic


class ScanUploadResponse(BaseModel):
    scan_id: uuid.UUID
    status: str


class ScanStatusResponse(BaseModel):
    id: uuid.UUID
    status: str
    body_profile: BodyProfilePublic | None
    measurements: dict
    cluster_key: str | None
    created_at: datetime

