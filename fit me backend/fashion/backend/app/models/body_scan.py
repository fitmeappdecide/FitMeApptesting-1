import uuid
from datetime import UTC, datetime

from sqlalchemy import Boolean, CheckConstraint, DateTime, ForeignKey, String, Text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class BodyScan(Base):
    __tablename__ = "body_scans"
    __table_args__ = (
        CheckConstraint("processing_status in ('pending','processing','completed','failed')", name="scan_status_allowed"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    front_photo_url_encrypted: Mapped[str] = mapped_column(Text, nullable=False)
    back_photo_url_encrypted: Mapped[str | None] = mapped_column(Text)
    left_photo_url_encrypted: Mapped[str | None] = mapped_column(Text)
    right_photo_url_encrypted: Mapped[str | None] = mapped_column(Text)
    smplx_params: Mapped[dict | None] = mapped_column(JSONB)
    processing_status: Mapped[str] = mapped_column(String(20), default="pending", nullable=False, index=True)
    body_profile_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("body_profiles.id"))
    consent_given: Mapped[bool] = mapped_column(Boolean, nullable=False)
    photos_deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(UTC), nullable=False)

    user = relationship("User", back_populates="body_scans")
    body_profile = relationship("BodyProfile", back_populates="body_scans")

