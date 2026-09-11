"""
SQLAlchemy ORM Models for Product Intelligence V2 (Isolated Supabase / PostgreSQL Tables).

All tables are strictly prefixed with `pi_` to guarantee zero conflict with
existing FitMe core tables (users, body_scans, garments, tryon_jobs, etc.).
"""
from __future__ import annotations

from datetime import UTC, datetime
from typing import Any, Dict, List, Optional

from sqlalchemy import Boolean, DateTime, Float, Index, Integer, String, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class PIProductCache(Base):
    """Stores product fingerprint hashes, match status, confidence, and candidate results."""
    __tablename__ = "pi_product_cache"

    fingerprint_hash: Mapped[str] = mapped_column(String(64), primary_key=True)
    fingerprint_tier: Mapped[str] = mapped_column(String(32), nullable=False)
    fingerprint_fields: Mapped[dict] = mapped_column(JSONB, default=dict, nullable=False)
    cache_version: Mapped[str] = mapped_column(String(32), nullable=False)
    match_status: Mapped[str] = mapped_column(String(32), nullable=False)
    top_confidence: Mapped[float] = mapped_column(Float, nullable=False)
    profile: Mapped[dict] = mapped_column(JSONB, default=dict, nullable=False)
    candidates: Mapped[list] = mapped_column(JSONB, default=list, nullable=False)
    source_retailers: Mapped[list] = mapped_column(JSONB, default=list, nullable=False)
    hit_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(UTC), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, index=True)
    last_hit_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)


class PIScan(Base):
    """Stores visual garment search scan jobs and candidate results."""
    __tablename__ = "pi_scans"

    scan_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    status: Mapped[str] = mapped_column(String(32), default="processing", nullable=False)
    is_saved: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    last_price_checked_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    last_price_check_attempted_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    thumbnail_b64: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    match_status: Mapped[Optional[str]] = mapped_column(String(32), nullable=True)
    match_label: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    top_confidence: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    best_price: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    best_retailer: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    profile: Mapped[dict] = mapped_column(JSONB, default=dict, nullable=False)
    candidates: Mapped[list] = mapped_column(JSONB, default=list, nullable=False)
    strategies: Mapped[list] = mapped_column(JSONB, default=list, nullable=False)
    stages: Mapped[list] = mapped_column(JSONB, default=list, nullable=False)
    source: Mapped[str] = mapped_column(String(32), default="upload", nullable=False)
    has_tag_photo: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    elapsed_ms: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    error: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(UTC), nullable=False, index=True)


class PIAffiliateClick(Base):
    """Stores affiliate link clicks and generated URLs."""
    __tablename__ = "pi_affiliate_clicks"

    click_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    scan_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    candidate_id: Mapped[str] = mapped_column(String(64), nullable=False)
    retailer: Mapped[str] = mapped_column(String(64), nullable=False)
    original_url: Mapped[str] = mapped_column(Text, nullable=False)
    affiliate_url: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    generated: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    provider: Mapped[str] = mapped_column(String(64), nullable=False)
    error: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    expires_at: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    tracking_id: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(UTC), nullable=False)


class PIAnalyticsEvent(Base):
    """Stores Product Intelligence events for ranking analytics and the Learning Engine."""
    __tablename__ = "pi_analytics_events"
    __table_args__ = (
        Index("ix_pi_analytics_events_type_time", "event_type", "timestamp"),
    )

    event_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    event_type: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    timestamp: Mapped[str] = mapped_column(String(64), nullable=False)
    user_id: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    scan_id: Mapped[Optional[str]] = mapped_column(String(64), nullable=True, index=True)
    candidate_id: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    retailer: Mapped[Optional[str]] = mapped_column(String(64), nullable=True, index=True)
    metadata_json: Mapped[dict] = mapped_column("metadata", JSONB, default=dict, nullable=False)
