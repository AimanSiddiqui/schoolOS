"""Add statuses to academic setup records.

Revision ID: 0004_academic_statuses
Revises: 0003_academics_students
Create Date: 2026-10-07
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0004_academic_statuses"
down_revision: str | None = "0003_academics_students"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "academic_years",
        sa.Column("status", sa.String(length=32), nullable=False, server_default="ACTIVE"),
    )
    op.add_column(
        "grade_levels",
        sa.Column("status", sa.String(length=32), nullable=False, server_default="ACTIVE"),
    )
    op.add_column(
        "subjects",
        sa.Column("status", sa.String(length=32), nullable=False, server_default="ACTIVE"),
    )
    op.alter_column("academic_years", "status", server_default=None)
    op.alter_column("grade_levels", "status", server_default=None)
    op.alter_column("subjects", "status", server_default=None)


def downgrade() -> None:
    op.drop_column("subjects", "status")
    op.drop_column("grade_levels", "status")
    op.drop_column("academic_years", "status")
