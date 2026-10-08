"""Add attendance sessions and records.

Revision ID: 0005_attendance
Revises: 0004_academic_statuses
Create Date: 2026-10-08
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0005_attendance"
down_revision: str | None = "0004_academic_statuses"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "attendance_sessions",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("school_id", sa.Uuid(), nullable=False),
        sa.Column("section_id", sa.Uuid(), nullable=False),
        sa.Column("school_date", sa.Date(), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("finalized_by_user_id", sa.Uuid(), nullable=True),
        sa.Column("finalized_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["finalized_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["school_id"], ["schools.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["section_id"], ["sections.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "school_id",
            "section_id",
            "school_date",
            name="uq_attendance_sessions_school_section_date",
        ),
    )
    op.create_index(
        op.f("ix_attendance_sessions_school_date"),
        "attendance_sessions",
        ["school_date"],
        unique=False,
    )
    op.create_index(
        op.f("ix_attendance_sessions_school_id"),
        "attendance_sessions",
        ["school_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_attendance_sessions_section_id"),
        "attendance_sessions",
        ["section_id"],
        unique=False,
    )

    op.create_table(
        "attendance_records",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("school_id", sa.Uuid(), nullable=False),
        sa.Column("session_id", sa.Uuid(), nullable=False),
        sa.Column("student_id", sa.Uuid(), nullable=False),
        sa.Column("mark", sa.String(length=32), nullable=True),
        sa.Column("note", sa.String(length=500), nullable=True),
        sa.Column("marked_by_user_id", sa.Uuid(), nullable=True),
        sa.Column("marked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("correction_reason", sa.String(length=500), nullable=True),
        sa.Column("corrected_by_user_id", sa.Uuid(), nullable=True),
        sa.Column("corrected_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["corrected_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["marked_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["school_id"], ["schools.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["session_id"], ["attendance_sessions.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["student_id"], ["students.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "session_id",
            "student_id",
            name="uq_attendance_records_session_student",
        ),
    )
    op.create_index(
        op.f("ix_attendance_records_school_id"),
        "attendance_records",
        ["school_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_attendance_records_session_id"),
        "attendance_records",
        ["session_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_attendance_records_student_id"),
        "attendance_records",
        ["student_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_attendance_records_student_id"), table_name="attendance_records")
    op.drop_index(op.f("ix_attendance_records_session_id"), table_name="attendance_records")
    op.drop_index(op.f("ix_attendance_records_school_id"), table_name="attendance_records")
    op.drop_table("attendance_records")
    op.drop_index(op.f("ix_attendance_sessions_section_id"), table_name="attendance_sessions")
    op.drop_index(op.f("ix_attendance_sessions_school_id"), table_name="attendance_sessions")
    op.drop_index(op.f("ix_attendance_sessions_school_date"), table_name="attendance_sessions")
    op.drop_table("attendance_sessions")
