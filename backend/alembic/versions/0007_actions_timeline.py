"""Add repeated-absence policy, actions, and scoped student timelines."""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

from alembic import op

revision: str = "0007_actions_timeline"
down_revision: str | None = "0006_attendance_audit_outbox"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    json_type = sa.JSON().with_variant(JSONB, "postgresql")
    op.create_table(
        "attendance_policies",
        sa.Column("school_id", sa.Uuid(), primary_key=True),
        sa.Column("enabled", sa.Boolean(), nullable=False),
        sa.Column("threshold", sa.Integer(), nullable=False),
        sa.Column("window_days", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(["school_id"], ["schools.id"], ondelete="CASCADE"),
        sa.CheckConstraint(
            "threshold >= 1 AND threshold <= window_days", name="ck_policy_threshold"
        ),
        sa.CheckConstraint("window_days >= 1 AND window_days <= 90", name="ck_policy_window"),
    )
    op.create_table(
        "action_items",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("school_id", sa.Uuid(), nullable=False),
        sa.Column("student_id", sa.Uuid(), nullable=False),
        sa.Column("rule_key", sa.String(80), nullable=False),
        sa.Column("status", sa.String(32), nullable=False),
        sa.Column("assignee_user_id", sa.Uuid(), nullable=True),
        sa.Column("window_end", sa.Date(), nullable=False),
        sa.Column("threshold", sa.Integer(), nullable=False),
        sa.Column("window_days", sa.Integer(), nullable=False),
        sa.Column("evidence", json_type, nullable=False),
        sa.Column("qualifies", sa.Boolean(), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("resolution_reason", sa.String(500), nullable=True),
        sa.Column("closed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["school_id"], ["schools.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["student_id"], ["students.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["assignee_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.CheckConstraint(
            "status IN ('OPEN', 'IN_PROGRESS', 'RESOLVED', 'DISMISSED')", name="ck_action_status"
        ),
    )
    op.create_index("ix_action_items_school_id", "action_items", ["school_id"])
    op.create_index("ix_action_items_student_id", "action_items", ["student_id"])
    op.create_index(
        "uq_action_active_student_rule",
        "action_items",
        ["school_id", "student_id", "rule_key"],
        unique=True,
        postgresql_where=sa.text("status IN ('OPEN', 'IN_PROGRESS')"),
        sqlite_where=sa.text("status IN ('OPEN', 'IN_PROGRESS')"),
    )
    op.create_table(
        "timeline_entries",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("school_id", sa.Uuid(), nullable=False),
        sa.Column("student_id", sa.Uuid(), nullable=False),
        sa.Column("source_key", sa.String(200), nullable=False),
        sa.Column("entry_type", sa.String(80), nullable=False),
        sa.Column("visibility", sa.String(32), nullable=False),
        sa.Column("title", sa.String(200), nullable=False),
        sa.Column("summary", sa.String(1000), nullable=False),
        sa.Column("details", json_type, nullable=False),
        sa.Column("occurred_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["school_id"], ["schools.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["student_id"], ["students.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("school_id", "source_key", name="uq_timeline_school_source"),
        sa.CheckConstraint(
            "visibility IN ('INTERNAL', 'STAFF', 'GUARDIAN')", name="ck_timeline_visibility"
        ),
    )
    op.create_index("ix_timeline_entries_school_id", "timeline_entries", ["school_id"])
    op.create_index("ix_timeline_entries_student_id", "timeline_entries", ["student_id"])


def downgrade() -> None:
    op.drop_table("timeline_entries")
    op.drop_table("action_items")
    op.drop_table("attendance_policies")
