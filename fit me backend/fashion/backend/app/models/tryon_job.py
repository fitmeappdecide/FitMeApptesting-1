import uuid
from datetime import UTC, datetime

from sqlalchemy import Boolean, CheckConstraint, DateTime, Float, ForeignKey, String, Text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class TryOnJob(Base):
    __tablename__ = "tryon_jobs"
    __table_args__ = (
        CheckConstraint("status in ('queued','processing','completed','failed')", name="tryon_status_allowed"),
        CheckConstraint("cache_tier is null or cache_tier in ('exact','cluster','full')", name="tryon_cache_tier_allowed"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    garment_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("garments.id", ondelete="CASCADE"), nullable=False, index=True)
    brand_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("brands.id", ondelete="SET NULL"), index=True)
    status: Mapped[str] = mapped_column(String(20), default="queued", nullable=False, index=True)
    result_image_urls: Mapped[list[str]] = mapped_column(JSONB, default=list, nullable=False)
    cache_tier: Mapped[str | None] = mapped_column(String(20))
    processing_time_seconds: Mapped[float | None] = mapped_column(Float)
    runpod_job_id: Mapped[str | None] = mapped_column(String(255))
    error_message: Mapped[str | None] = mapped_column(Text)
    is_saved: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False, server_default="false")
    saved_photo_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("user_saved_photos.id", ondelete="SET NULL"), nullable=True, index=True)
    saved_photo_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(UTC), nullable=False)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    garment = relationship("Garment")
    brand = relationship("Brand")
    saved_photo = relationship("UserSavedPhoto")


