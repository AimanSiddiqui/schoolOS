"""Add guardian-message drafts, immutable revisions, and revision-bound approvals."""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0008_message_review"
down_revision: str | None = "0007_actions_timeline"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_unique_constraint("uq_action_school_id", "action_items", ["school_id", "id"])
    op.create_unique_constraint(
        "uq_student_guardian_school_id", "student_guardians", ["school_id", "id"]
    )
    op.create_table(
        "message_drafts",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("school_id", sa.Uuid(), nullable=False),
        sa.Column("action_id", sa.Uuid(), nullable=False),
        sa.Column("guardian_link_id", sa.Uuid(), nullable=False),
        sa.Column("recipient_name", sa.String(200), nullable=False),
        sa.Column("recipient_email", sa.String(320), nullable=False),
        sa.Column("subject", sa.String(200), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("action_revision", sa.Integer(), nullable=False),
        sa.Column("approved_revision", sa.Integer(), nullable=True),
        sa.Column("created_by_user_id", sa.Uuid(), nullable=True),
        sa.Column("updated_by_user_id", sa.Uuid(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["school_id"], ["schools.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["school_id", "action_id"],
            ["action_items.school_id", "action_items.id"],
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["school_id", "guardian_link_id"],
            ["student_guardians.school_id", "student_guardians.id"],
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["updated_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.UniqueConstraint("school_id", "id", name="uq_message_draft_school_id"),
        sa.UniqueConstraint("action_id", "guardian_link_id", name="uq_message_action_recipient"),
        sa.CheckConstraint("revision >= 1 AND action_revision >= 1", name="ck_message_revision"),
        sa.CheckConstraint(
            "approved_revision IS NULL OR approved_revision = revision",
            name="ck_message_approval_revision",
        ),
    )
    op.create_index("ix_message_drafts_school_id", "message_drafts", ["school_id"])
    op.create_index("ix_message_drafts_action_id", "message_drafts", ["action_id"])
    op.create_table(
        "message_revisions",
        sa.Column("school_id", sa.Uuid(), primary_key=True),
        sa.Column("draft_id", sa.Uuid(), primary_key=True),
        sa.Column("revision", sa.Integer(), primary_key=True),
        sa.Column("guardian_link_id", sa.Uuid(), nullable=False),
        sa.Column("recipient_name", sa.String(200), nullable=False),
        sa.Column("recipient_email", sa.String(320), nullable=False),
        sa.Column("subject", sa.String(200), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("action_revision", sa.Integer(), nullable=False),
        sa.Column("author_user_id", sa.Uuid(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["school_id", "draft_id"],
            ["message_drafts.school_id", "message_drafts.id"],
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(["author_user_id"], ["users.id"], ondelete="SET NULL"),
    )
    op.create_table(
        "message_approvals",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("school_id", sa.Uuid(), nullable=False),
        sa.Column("draft_id", sa.Uuid(), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("approver_user_id", sa.Uuid(), nullable=True),
        sa.Column("approved_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["school_id", "draft_id", "revision"],
            [
                "message_revisions.school_id",
                "message_revisions.draft_id",
                "message_revisions.revision",
            ],
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(["approver_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.UniqueConstraint(
            "school_id", "draft_id", "revision", name="uq_message_approval_revision"
        ),
    )


def downgrade() -> None:
    op.drop_table("message_approvals")
    op.drop_table("message_revisions")
    op.drop_table("message_drafts")
    op.drop_constraint("uq_student_guardian_school_id", "student_guardians", type_="unique")
    op.drop_constraint("uq_action_school_id", "action_items", type_="unique")
