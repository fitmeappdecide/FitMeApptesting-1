import uuid
from datetime import UTC, datetime
from typing import Any, Dict, List, Optional

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class AVAConversation(Base):
    __tablename__ = "ava_conversations"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=True, index=True)
    title: Mapped[str] = mapped_column(String(255), default="Fashion Styling Session", nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(UTC), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(UTC), onupdate=lambda: datetime.now(UTC), nullable=False
    )

    messages = relationship("AVAMessage", back_populates="conversation", cascade="all, delete-orphan", order_by="AVAMessage.created_at")


class AVAMessage(Base):
    __tablename__ = "ava_messages"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    conversation_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("ava_conversations.id", ondelete="CASCADE"), nullable=False, index=True)
    sender: Mapped[str] = mapped_column(String(50), nullable=False)  # "user" | "ava"
    text_content: Mapped[str] = mapped_column(Text, nullable=False)
    intent: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    structured_payload: Mapped[Optional[Dict[str, Any]]] = mapped_column(JSONB, nullable=True)
    tool_calls_log: Mapped[Optional[List[Dict[str, Any]]]] = mapped_column(JSONB, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(UTC), nullable=False)

    conversation = relationship("AVAConversation", back_populates="messages")


class AVAPreference(Base):
    __tablename__ = "ava_preferences"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), unique=True, nullable=False, index=True)
    style_dna: Mapped[Dict[str, float]] = mapped_column(
        JSONB, default=lambda: {"casual": 0.5, "minimal": 0.5, "streetwear": 0.3, "formal": 0.3, "ethnic": 0.3}, nullable=False
    )
    preferred_colors: Mapped[List[str]] = mapped_column(JSONB, default=list, nullable=False)
    disliked_colors: Mapped[List[str]] = mapped_column(JSONB, default=list, nullable=False)
    disliked_items: Mapped[List[str]] = mapped_column(JSONB, default=list, nullable=False)
    preferred_fits: Mapped[List[str]] = mapped_column(JSONB, default=list, nullable=False)  # "oversized", "slim", "relaxed"
    favorite_brands: Mapped[List[str]] = mapped_column(JSONB, default=list, nullable=False)
    favorite_retailers: Mapped[List[str]] = mapped_column(JSONB, default=list, nullable=False)  # "myntra", "ajio", "amazon"
    budget_range_min: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    budget_range_max: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(UTC), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(UTC), onupdate=lambda: datetime.now(UTC), nullable=False
    )


class AVASavedOutfit(Base):
    __tablename__ = "ava_saved_outfits"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    occasion: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    style: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    total_price: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    items: Mapped[List[Dict[str, Any]]] = mapped_column(JSONB, default=list, nullable=False)
    tryon_image_url: Mapped[Optional[str]] = mapped_column(String(1024), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(UTC), nullable=False)
