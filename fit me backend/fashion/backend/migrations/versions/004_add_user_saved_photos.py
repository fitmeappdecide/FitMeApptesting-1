"""add user_saved_photos table and tryon_jobs snapshot columns

Revision ID: 004_add_user_saved_photos
Revises: 003_add_price_comparison_enhancements
Create Date: 2026-08-20
"""
from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "004_add_user_saved_photos"
down_revision: str | None = "003_add_price_comparison_enhancements"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # 1. Create user_saved_photos table
    op.create_table(
        "user_saved_photos",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("storage_path", sa.Text(), nullable=False),
        sa.Column("display_name", sa.String(length=255), nullable=False),
        sa.Column("original_filename", sa.String(length=255), nullable=True),
        sa.Column("mime_type", sa.String(length=50), server_default="image/jpeg", nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
    )
    op.create_index("ix_user_saved_photos_user_id", "user_saved_photos", ["user_id"])
    op.create_index("ix_user_saved_photos_created_at", "user_saved_photos", ["created_at"])

    # 2. Add saved_photo_id and saved_photo_name snapshot to tryon_jobs
    op.add_column(
        "tryon_jobs",
        sa.Column("saved_photo_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("user_saved_photos.id", ondelete="SET NULL"), nullable=True)
    )
    op.add_column(
        "tryon_jobs",
        sa.Column("saved_photo_name", sa.String(length=255), nullable=True)
    )
    op.create_index("ix_tryon_jobs_saved_photo_id", "tryon_jobs", ["saved_photo_id"])


def downgrade() -> None:
    op.drop_index("ix_tryon_jobs_saved_photo_id", table_name="tryon_jobs")
    op.drop_column("tryon_jobs", "saved_photo_name")
    op.drop_column("tryon_jobs", "saved_photo_id")
    op.drop_index("ix_user_saved_photos_created_at", table_name="user_saved_photos")
    op.drop_index("ix_user_saved_photos_user_id", table_name="user_saved_photos")
    op.drop_table("user_saved_photos")
