import uuid
from datetime import UTC, datetime

from sqlalchemy import CheckConstraint, DateTime, Float, ForeignKey, Integer, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class BodyProfile(Base):
    __tablename__ = "body_profiles"
    __table_args__ = (
        CheckConstraint("skin_tone_fitzpatrick between 1 and 6", name="skin_tone_range"),
        CheckConstraint("body_type in ('slim','average','athletic','plus')", name="body_type_allowed"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    height_cm: Mapped[float | None] = mapped_column(Float)
    chest_cm: Mapped[float | None] = mapped_column(Float)
    waist_cm: Mapped[float | None] = mapped_column(Float)
    hips_cm: Mapped[float | None] = mapped_column(Float)
    shoulder_width_cm: Mapped[float | None] = mapped_column(Float)
    inseam_cm: Mapped[float | None] = mapped_column(Float)
    sleeve_cm: Mapped[float | None] = mapped_column(Float)
    skin_tone_fitzpatrick: Mapped[int | None] = mapped_column(Integer)
    skin_tone_hex: Mapped[str | None] = mapped_column(String(7))
    body_type: Mapped[str | None] = mapped_column(String(20))
    face_embedding_ref: Mapped[str | None] = mapped_column(String(255))
    cluster_key: Mapped[str | None] = mapped_column(String(100), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(UTC), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(UTC), onupdate=lambda: datetime.now(UTC), nullable=False)

    user = relationship("User", back_populates="body_profiles")
    body_scans = relationship("BodyScan", back_populates="body_profile")

