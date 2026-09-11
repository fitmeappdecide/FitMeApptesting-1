import uuid
from datetime import UTC, datetime

from sqlalchemy import Boolean, CheckConstraint, DateTime, ForeignKey, String
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class Garment(Base):
    __tablename__ = "garments"
    __table_args__ = (
        CheckConstraint("garment_type in ('tshirt','shirt','kurta','saree','lehenga','dress','pants','hoodie','jacket','unknown')", name="garment_type_allowed"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    brand_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("brands.id", ondelete="CASCADE"), index=True)
    product_name: Mapped[str] = mapped_column(String(500), nullable=False)
    product_url: Mapped[str | None] = mapped_column(String(500))
    images: Mapped[list[dict]] = mapped_column(JSONB, default=list, nullable=False)
    garment_type: Mapped[str] = mapped_column(String(50), default="unknown", nullable=False)
    segmentation_masks: Mapped[dict | None] = mapped_column(JSONB)
    fabric_type: Mapped[str | None] = mapped_column(String(100))
    dominant_colours: Mapped[list[str]] = mapped_column(JSONB, default=list, nullable=False)
    size_chart: Mapped[dict] = mapped_column(JSONB, default=dict, nullable=False)
    is_ethnic: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    scraped_from_url: Mapped[str | None] = mapped_column(String(500))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(UTC), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(UTC), onupdate=lambda: datetime.now(UTC), nullable=False)

    brand = relationship("Brand", back_populates="garments")

