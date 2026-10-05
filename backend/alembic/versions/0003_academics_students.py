"""Create academics, students, guardians, and enrollments.

Revision ID: 0003_academics_students
Revises: 0002_user_sessions
Create Date: 2026-10-05
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "0003_academics_students"
down_revision: str | None = "0002_user_sessions"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def create_timestamp_column() -> sa.Column:
    return sa.Column(
        "created_at",
        sa.DateTime(timezone=True),
        nullable=False,
        server_default=sa.func.now(),
    )


def upgrade() -> None:
    op.create_table(
        "academic_years",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("school_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("starts_on", sa.Date(), nullable=False),
        sa.Column("ends_on", sa.Date(), nullable=False),
        create_timestamp_column(),
        sa.ForeignKeyConstraint(["school_id"], ["schools.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("school_id", "name", name="uq_academic_years_school_name"),
    )
    op.create_index("ix_academic_years_school_id", "academic_years", ["school_id"])

    op.create_table(
        "grade_levels",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("school_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("label", sa.String(length=80), nullable=False),
        sa.Column("sort_order", sa.Integer(), nullable=False),
        create_timestamp_column(),
        sa.ForeignKeyConstraint(["school_id"], ["schools.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("school_id", "label", name="uq_grade_levels_school_label"),
        sa.UniqueConstraint("school_id", "sort_order", name="uq_grade_levels_school_sort_order"),
    )
    op.create_index("ix_grade_levels_school_id", "grade_levels", ["school_id"])

    op.create_table(
        "subjects",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("school_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        create_timestamp_column(),
        sa.ForeignKeyConstraint(["school_id"], ["schools.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("school_id", "name", name="uq_subjects_school_name"),
    )
    op.create_index("ix_subjects_school_id", "subjects", ["school_id"])

    op.create_table(
        "students",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("school_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("student_number", sa.String(length=80), nullable=False),
        sa.Column("given_name", sa.String(length=120), nullable=False),
        sa.Column("family_name", sa.String(length=120), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False),
        create_timestamp_column(),
        sa.ForeignKeyConstraint(["school_id"], ["schools.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("school_id", "student_number", name="uq_students_school_number"),
    )
    op.create_index("ix_students_school_id", "students", ["school_id"])

    op.create_table(
        "guardians",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("school_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("display_name", sa.String(length=200), nullable=False),
        sa.Column("email", sa.String(length=320), nullable=False),
        sa.Column("phone", sa.String(length=80), nullable=True),
        create_timestamp_column(),
        sa.ForeignKeyConstraint(["school_id"], ["schools.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="SET NULL"),
        sa.UniqueConstraint("school_id", "email", name="uq_guardians_school_email"),
    )
    op.create_index("ix_guardians_school_id", "guardians", ["school_id"])
    op.create_index("ix_guardians_user_id", "guardians", ["user_id"])

    op.create_table(
        "sections",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("school_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("academic_year_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("grade_level_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("label", sa.String(length=80), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False),
        create_timestamp_column(),
        sa.ForeignKeyConstraint(["academic_year_id"], ["academic_years.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["grade_level_id"], ["grade_levels.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["school_id"], ["schools.id"], ondelete="CASCADE"),
        sa.UniqueConstraint(
            "school_id",
            "academic_year_id",
            "grade_level_id",
            "label",
            name="uq_sections_school_year_level_label",
        ),
    )
    op.create_index("ix_sections_academic_year_id", "sections", ["academic_year_id"])
    op.create_index("ix_sections_grade_level_id", "sections", ["grade_level_id"])
    op.create_index("ix_sections_school_id", "sections", ["school_id"])

    op.create_table(
        "student_guardians",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("school_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("student_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("guardian_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("relationship", sa.String(length=80), nullable=False),
        sa.Column("portal_access", sa.Boolean(), nullable=False),
        sa.Column("can_receive_notifications", sa.Boolean(), nullable=False),
        sa.Column("emergency_contact", sa.Boolean(), nullable=False),
        create_timestamp_column(),
        sa.ForeignKeyConstraint(["guardian_id"], ["guardians.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["school_id"], ["schools.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["student_id"], ["students.id"], ondelete="CASCADE"),
        sa.UniqueConstraint(
            "school_id",
            "student_id",
            "guardian_id",
            name="uq_student_guardians_link",
        ),
    )
    op.create_index("ix_student_guardians_guardian_id", "student_guardians", ["guardian_id"])
    op.create_index("ix_student_guardians_school_id", "student_guardians", ["school_id"])
    op.create_index("ix_student_guardians_student_id", "student_guardians", ["student_id"])

    op.create_table(
        "teacher_assignments",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("school_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("teacher_user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("section_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("subject_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("status", sa.String(length=32), nullable=False),
        create_timestamp_column(),
        sa.ForeignKeyConstraint(["school_id"], ["schools.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["section_id"], ["sections.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["subject_id"], ["subjects.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["teacher_user_id"], ["users.id"], ondelete="CASCADE"),
        sa.UniqueConstraint(
            "school_id",
            "teacher_user_id",
            "section_id",
            "subject_id",
            name="uq_teacher_assignments_school_teacher_section_subject",
        ),
    )
    op.create_index("ix_teacher_assignments_school_id", "teacher_assignments", ["school_id"])
    op.create_index("ix_teacher_assignments_section_id", "teacher_assignments", ["section_id"])
    op.create_index(
        "ix_teacher_assignments_teacher_user_id",
        "teacher_assignments",
        ["teacher_user_id"],
    )

    op.create_table(
        "enrollments",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("school_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("student_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("section_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("starts_on", sa.Date(), nullable=False),
        sa.Column("ends_on", sa.Date(), nullable=True),
        sa.Column("status", sa.String(length=32), nullable=False),
        create_timestamp_column(),
        sa.ForeignKeyConstraint(["school_id"], ["schools.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["section_id"], ["sections.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["student_id"], ["students.id"], ondelete="CASCADE"),
        sa.UniqueConstraint(
            "school_id",
            "student_id",
            "section_id",
            "starts_on",
            name="uq_enrollments_school_student_section_start",
        ),
    )
    op.create_index("ix_enrollments_school_id", "enrollments", ["school_id"])
    op.create_index("ix_enrollments_section_id", "enrollments", ["section_id"])
    op.create_index("ix_enrollments_student_id", "enrollments", ["student_id"])


def downgrade() -> None:
    op.drop_index("ix_enrollments_student_id", table_name="enrollments")
    op.drop_index("ix_enrollments_section_id", table_name="enrollments")
    op.drop_index("ix_enrollments_school_id", table_name="enrollments")
    op.drop_table("enrollments")

    op.drop_index("ix_teacher_assignments_teacher_user_id", table_name="teacher_assignments")
    op.drop_index("ix_teacher_assignments_section_id", table_name="teacher_assignments")
    op.drop_index("ix_teacher_assignments_school_id", table_name="teacher_assignments")
    op.drop_table("teacher_assignments")

    op.drop_index("ix_student_guardians_student_id", table_name="student_guardians")
    op.drop_index("ix_student_guardians_school_id", table_name="student_guardians")
    op.drop_index("ix_student_guardians_guardian_id", table_name="student_guardians")
    op.drop_table("student_guardians")

    op.drop_index("ix_sections_school_id", table_name="sections")
    op.drop_index("ix_sections_grade_level_id", table_name="sections")
    op.drop_index("ix_sections_academic_year_id", table_name="sections")
    op.drop_table("sections")

    op.drop_index("ix_guardians_user_id", table_name="guardians")
    op.drop_index("ix_guardians_school_id", table_name="guardians")
    op.drop_table("guardians")

    op.drop_index("ix_students_school_id", table_name="students")
    op.drop_table("students")

    op.drop_index("ix_subjects_school_id", table_name="subjects")
    op.drop_table("subjects")

    op.drop_index("ix_grade_levels_school_id", table_name="grade_levels")
    op.drop_table("grade_levels")

    op.drop_index("ix_academic_years_school_id", table_name="academic_years")
    op.drop_table("academic_years")
