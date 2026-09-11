"""add price comparison enhancements to pi_scans

Revision ID: 003_add_price_comparison_enhancements
Revises: 002_add_product_intelligence_tables
Create Date: 2026-08-19
"""
from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa

revision: str = "003_add_price_comparison_enhancements"
down_revision: str | None = "002_add_product_intelligence_tables"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # 1. Add is_saved column with default FALSE
    op.add_column(
        "pi_scans",
        sa.Column("is_saved", sa.Boolean(), server_default=sa.text("false"), nullable=False),
    )

    # 2. Add last_price_checked_at and last_price_check_attempted_at
    op.add_column(
        "pi_scans",
        sa.Column("last_price_checked_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "pi_scans",
        sa.Column("last_price_check_attempted_at", sa.DateTime(timezone=True), nullable=True),
    )

    # 3. Backfill existing records: set last_price_checked_at = created_at
    op.execute(
        "UPDATE pi_scans SET last_price_checked_at = created_at, last_price_check_attempted_at = created_at WHERE last_price_checked_at IS NULL"
    )

    # 4. Indexes for fast user queries
    op.create_index(
        op.f("ix_pi_scans_user_saved"),
        "pi_scans",
        ["user_id", "is_saved"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_pi_scans_user_saved"), table_name="pi_scans")
    op.drop_column("pi_scans", "last_price_check_attempted_at")
    op.drop_column("pi_scans", "last_price_checked_at")
    op.drop_column("pi_scans", "is_saved")
