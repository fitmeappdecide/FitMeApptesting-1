import uuid
from datetime import UTC, date, datetime

from sqlalchemy import CheckConstraint, Date, DateTime, Integer, String
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class Brand(Base):
    __tablename__ = "brands"
    __table_args__ = (
        CheckConstraint("plan in ('free','starter','growth','enterprise')", name="brand_plan_allowed"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False, index=True)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    shopify_store_url: Mapped[str | None] = mapped_column(String(500))
    woocommerce_site_url: Mapped[str | None] = mapped_column(String(500))
    api_key_hash: Mapped[str | None] = mapped_column(String(255), unique=True, index=True)
    plan: Mapped[str] = mapped_column(String(20), default="free", nullable=False)
    try_ons_used_this_month: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    try_ons_limit: Mapped[int] = mapped_column(Integer, default=50, nullable=False)
    billing_period_start: Mapped[date | None] = mapped_column(Date)
    stripe_customer_id: Mapped[str | None] = mapped_column(String(255))
    stripe_subscription_id: Mapped[str | None] = mapped_column(String(255))
    cors_origins: Mapped[list[str]] = mapped_column(JSONB, default=list, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(UTC), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(UTC), onupdate=lambda: datetime.now(UTC), nullable=False)

    garments = relationship("Garment", back_populates="brand", cascade="all, delete-orphan")

