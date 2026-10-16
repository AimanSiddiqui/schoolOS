"""Add append-only audit history and durable attendance events.

Revision ID: 0006_attendance_audit_outbox
Revises: 0005_attendance
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

from alembic import op

revision: str = "0006_attendance_audit_outbox"
down_revision: str | None = "0005_attendance"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    json_type = sa.JSON().with_variant(JSONB, "postgresql")
    op.create_table(
        "audit_entries",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("school_id", sa.Uuid(), nullable=False),
        sa.Column("actor_user_id", sa.Uuid(), nullable=True),
        sa.Column("operation", sa.String(80), nullable=False),
        sa.Column("target_type", sa.String(80), nullable=False),
        sa.Column("target_id", sa.Uuid(), nullable=False),
        sa.Column("changes", json_type, nullable=False),
        sa.Column("occurred_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["school_id"], ["schools.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["actor_user_id"], ["users.id"], ondelete="SET NULL"),
    )
    op.create_index("ix_audit_entries_school_id", "audit_entries", ["school_id"])
    op.create_index("ix_audit_entries_target_id", "audit_entries", ["target_id"])
    op.create_table(
        "outbox_events",
        sa.Column("event_id", sa.Uuid(), primary_key=True),
        sa.Column("school_id", sa.Uuid(), nullable=False),
        sa.Column("event_type", sa.String(80), nullable=False),
        sa.Column("schema_version", sa.Integer(), nullable=False),
        sa.Column("occurred_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("aggregate_id", sa.Uuid(), nullable=False),
        sa.Column("idempotency_key", sa.String(200), nullable=False),
        sa.Column("payload", json_type, nullable=False),
        sa.Column("status", sa.String(32), nullable=False),
        sa.ForeignKeyConstraint(["school_id"], ["schools.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("school_id", "idempotency_key", name="uq_outbox_school_idempotency"),
    )
    op.create_index("ix_outbox_events_school_id", "outbox_events", ["school_id"])
    op.create_index("ix_outbox_events_status", "outbox_events", ["status"])


def downgrade() -> None:
    op.drop_table("outbox_events")
    op.drop_table("audit_entries")
