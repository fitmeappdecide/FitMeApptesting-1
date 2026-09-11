"""add isolated product intelligence tables

Revision ID: 002_add_product_intelligence_tables
Revises: 001_initial_schema
Create Date: 2026-08-17
"""
from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "002_add_product_intelligence_tables"
down_revision: str | None = "001_initial_schema"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # 1. pi_product_cache
    op.create_table(
        "pi_product_cache",
        sa.Column("fingerprint_hash", sa.String(length=64), nullable=False),
        sa.Column("fingerprint_tier", sa.String(length=32), nullable=False),
        sa.Column("fingerprint_fields", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("cache_version", sa.String(length=32), nullable=False),
        sa.Column("match_status", sa.String(length=32), nullable=False),
        sa.Column("top_confidence", sa.Float(), nullable=False),
        sa.Column("profile", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("candidates", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("source_retailers", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("hit_count", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_hit_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("fingerprint_hash", name=op.f("pk_pi_product_cache")),
    )
    op.create_index(op.f("ix_pi_product_cache_expires_at"), "pi_product_cache", ["expires_at"], unique=False)

    # 2. pi_scans
    op.create_table(
        "pi_scans",
        sa.Column("scan_id", sa.String(length=64), nullable=False),
        sa.Column("user_id", sa.String(length=64), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("thumbnail_b64", sa.Text(), nullable=True),
        sa.Column("match_status", sa.String(length=32), nullable=True),
        sa.Column("match_label", sa.String(length=64), nullable=True),
        sa.Column("top_confidence", sa.Float(), nullable=True),
        sa.Column("best_price", sa.Float(), nullable=True),
        sa.Column("best_retailer", sa.String(length=64), nullable=True),
        sa.Column("profile", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("candidates", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("strategies", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("stages", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("source", sa.String(length=32), nullable=False),
        sa.Column("has_tag_photo", sa.Boolean(), nullable=False),
        sa.Column("elapsed_ms", sa.Integer(), nullable=False),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("scan_id", name=op.f("pk_pi_scans")),
    )
    op.create_index(op.f("ix_pi_scans_user_id"), "pi_scans", ["user_id"], unique=False)
    op.create_index(op.f("ix_pi_scans_created_at"), "pi_scans", ["created_at"], unique=False)

    # 3. pi_affiliate_clicks
    op.create_table(
        "pi_affiliate_clicks",
        sa.Column("click_id", sa.String(length=64), nullable=False),
        sa.Column("user_id", sa.String(length=64), nullable=False),
        sa.Column("scan_id", sa.String(length=64), nullable=False),
        sa.Column("candidate_id", sa.String(length=64), nullable=False),
        sa.Column("retailer", sa.String(length=64), nullable=False),
        sa.Column("original_url", sa.Text(), nullable=False),
        sa.Column("affiliate_url", sa.Text(), nullable=True),
        sa.Column("generated", sa.Boolean(), nullable=False),
        sa.Column("provider", sa.String(length=64), nullable=False),
        sa.Column("error", sa.String(length=255), nullable=True),
        sa.Column("expires_at", sa.String(length=64), nullable=True),
        sa.Column("tracking_id", sa.String(length=64), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("click_id", name=op.f("pk_pi_affiliate_clicks")),
    )
    op.create_index(op.f("ix_pi_affiliate_clicks_user_id"), "pi_affiliate_clicks", ["user_id"], unique=False)
    op.create_index(op.f("ix_pi_affiliate_clicks_scan_id"), "pi_affiliate_clicks", ["scan_id"], unique=False)

    # 4. pi_analytics_events
    op.create_table(
        "pi_analytics_events",
        sa.Column("event_id", sa.String(length=64), nullable=False),
        sa.Column("event_type", sa.String(length=64), nullable=False),
        sa.Column("timestamp", sa.String(length=64), nullable=False),
        sa.Column("user_id", sa.String(length=64), nullable=True),
        sa.Column("scan_id", sa.String(length=64), nullable=True),
        sa.Column("candidate_id", sa.String(length=64), nullable=True),
        sa.Column("retailer", sa.String(length=64), nullable=True),
        sa.Column("metadata", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.PrimaryKeyConstraint("event_id", name=op.f("pk_pi_analytics_events")),
    )
    op.create_index(op.f("ix_pi_analytics_events_event_type"), "pi_analytics_events", ["event_type"], unique=False)
    op.create_index(op.f("ix_pi_analytics_events_scan_id"), "pi_analytics_events", ["scan_id"], unique=False)
    op.create_index(op.f("ix_pi_analytics_events_retailer"), "pi_analytics_events", ["retailer"], unique=False)
    op.create_index("ix_pi_analytics_events_type_time", "pi_analytics_events", ["event_type", "timestamp"], unique=False)


def downgrade() -> None:
    op.drop_table("pi_analytics_events")
    op.drop_table("pi_affiliate_clicks")
    op.drop_table("pi_scans")
    op.drop_table("pi_product_cache")
