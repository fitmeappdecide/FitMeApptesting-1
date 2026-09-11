import uuid
from datetime import UTC, datetime

from sqlalchemy import CheckConstraint, DateTime, Float, ForeignKey, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class SizeRecommendation(Base):
    __tablename__ = "size_recommendations"
    __table_args__ = (
        CheckConstraint("confidence_score between 0 and 1", name="size_confidence_range"),
        CheckConstraint("chest_fit in ('tight','comfortable','loose')", name="chest_fit_allowed"),
        CheckConstraint("shoulder_fit in ('tight','true','loose')", name="shoulder_fit_allowed"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    garment_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("garments.id", ondelete="CASCADE"), nullable=False)
    brand_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("brands.id", ondelete="SET NULL"))
    recommended_size: Mapped[str] = mapped_column(String(20), nullable=False)
    confidence_score: Mapped[float] = mapped_column(Float, nullable=False)
    fit_description: Mapped[str] = mapped_column(Text, nullable=False)
    chest_fit: Mapped[str] = mapped_column(String(20), nullable=False)
    shoulder_fit: Mapped[str] = mapped_column(String(20), nullable=False)
    skin_tone_note: Mapped[str | None] = mapped_column(Text)
    user_accepted_size: Mapped[str | None] = mapped_column(String(20))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(UTC), nullable=False)

