import uuid
from datetime import date, datetime
from typing import Any

from sqlalchemy import (
    JSON,
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    Uuid,
    event,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column
from sqlalchemy.orm import relationship as orm_relationship

json_type = JSON().with_variant(JSONB, "postgresql")


class Base(DeclarativeBase):
    pass


class AuditEntry(Base):
    __tablename__ = "audit_entries"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    school_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("schools.id", ondelete="CASCADE"), nullable=False, index=True
    )
    actor_user_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    operation: Mapped[str] = mapped_column(String(80), nullable=False)
    target_type: Mapped[str] = mapped_column(String(80), nullable=False)
    target_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), nullable=False, index=True)
    changes: Mapped[dict[str, Any]] = mapped_column(json_type, nullable=False)
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    actor: Mapped["User | None"] = orm_relationship()


@event.listens_for(AuditEntry, "before_update")
@event.listens_for(AuditEntry, "before_delete")
def reject_audit_mutation(*_: Any) -> None:
    raise ValueError("Audit entries are append-only")


class OutboxEvent(Base):
    __tablename__ = "outbox_events"
    __table_args__ = (
        UniqueConstraint("school_id", "idempotency_key", name="uq_outbox_school_idempotency"),
    )

    event_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    school_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("schools.id", ondelete="CASCADE"), nullable=False, index=True
    )
    event_type: Mapped[str] = mapped_column(String(80), nullable=False)
    schema_version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    aggregate_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), nullable=False)
    idempotency_key: Mapped[str] = mapped_column(String(200), nullable=False)
    payload: Mapped[dict[str, Any]] = mapped_column(json_type, nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="PENDING", index=True)


class AttendancePolicy(Base):
    __tablename__ = "attendance_policies"
    __table_args__ = (
        CheckConstraint("threshold >= 1 AND threshold <= window_days", name="ck_policy_threshold"),
        CheckConstraint("window_days >= 1 AND window_days <= 90", name="ck_policy_window"),
    )

    school_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("schools.id", ondelete="CASCADE"), primary_key=True
    )
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    threshold: Mapped[int] = mapped_column(Integer, nullable=False, default=2)
    window_days: Mapped[int] = mapped_column(Integer, nullable=False, default=7)


class ActionItem(Base):
    __tablename__ = "action_items"
    __table_args__ = (
        UniqueConstraint("school_id", "id", name="uq_action_school_id"),
        CheckConstraint(
            "status IN ('OPEN', 'IN_PROGRESS', 'RESOLVED', 'DISMISSED')", name="ck_action_status"
        ),
        Index(
            "uq_action_active_student_rule",
            "school_id",
            "student_id",
            "rule_key",
            unique=True,
            postgresql_where=text("status IN ('OPEN', 'IN_PROGRESS')"),
            sqlite_where=text("status IN ('OPEN', 'IN_PROGRESS')"),
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    school_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("schools.id", ondelete="CASCADE"), nullable=False, index=True
    )
    student_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("students.id", ondelete="CASCADE"), nullable=False, index=True
    )
    rule_key: Mapped[str] = mapped_column(String(80), nullable=False, default="repeated_absence")
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="OPEN")
    assignee_user_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    window_end: Mapped[date] = mapped_column(Date, nullable=False)
    threshold: Mapped[int] = mapped_column(Integer, nullable=False)
    window_days: Mapped[int] = mapped_column(Integer, nullable=False)
    evidence: Mapped[list[dict[str, str]]] = mapped_column(json_type, nullable=False)
    qualifies: Mapped[bool] = mapped_column(Boolean, nullable=False)
    revision: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    resolution_reason: Mapped[str | None] = mapped_column(String(500), nullable=True)
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    student: Mapped["Student"] = orm_relationship()
    assignee: Mapped["User | None"] = orm_relationship()


class MessageDraft(Base):
    __tablename__ = "message_drafts"
    __table_args__ = (
        UniqueConstraint("school_id", "id", name="uq_message_draft_school_id"),
        UniqueConstraint("action_id", "guardian_link_id", name="uq_message_action_recipient"),
        ForeignKeyConstraint(
            ["school_id", "action_id"],
            ["action_items.school_id", "action_items.id"],
            ondelete="CASCADE",
        ),
        ForeignKeyConstraint(
            ["school_id", "guardian_link_id"],
            ["student_guardians.school_id", "student_guardians.id"],
            ondelete="RESTRICT",
        ),
        CheckConstraint("revision >= 1 AND action_revision >= 1", name="ck_message_revision"),
        CheckConstraint(
            "approved_revision IS NULL OR approved_revision = revision",
            name="ck_message_approval_revision",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    school_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("schools.id", ondelete="CASCADE"), nullable=False, index=True
    )
    action_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), nullable=False, index=True)
    guardian_link_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), nullable=False)
    recipient_name: Mapped[str] = mapped_column(String(200), nullable=False)
    recipient_email: Mapped[str] = mapped_column(String(320), nullable=False)
    subject: Mapped[str] = mapped_column(String(200), nullable=False)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    revision: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    action_revision: Mapped[int] = mapped_column(Integer, nullable=False)
    approved_revision: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    updated_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class MessageRevision(Base):
    __tablename__ = "message_revisions"
    __table_args__ = (
        ForeignKeyConstraint(
            ["school_id", "draft_id"],
            ["message_drafts.school_id", "message_drafts.id"],
            ondelete="CASCADE",
        ),
    )

    school_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True)
    draft_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True)
    revision: Mapped[int] = mapped_column(Integer, primary_key=True)
    guardian_link_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), nullable=False)
    recipient_name: Mapped[str] = mapped_column(String(200), nullable=False)
    recipient_email: Mapped[str] = mapped_column(String(320), nullable=False)
    subject: Mapped[str] = mapped_column(String(200), nullable=False)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    action_revision: Mapped[int] = mapped_column(Integer, nullable=False)
    author_user_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class MessageApproval(Base):
    __tablename__ = "message_approvals"
    __table_args__ = (
        ForeignKeyConstraint(
            ["school_id", "draft_id", "revision"],
            [
                "message_revisions.school_id",
                "message_revisions.draft_id",
                "message_revisions.revision",
            ],
            ondelete="CASCADE",
        ),
        UniqueConstraint("school_id", "draft_id", "revision", name="uq_message_approval_revision"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    school_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), nullable=False)
    draft_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), nullable=False)
    revision: Mapped[int] = mapped_column(Integer, nullable=False)
    approver_user_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    approved_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


@event.listens_for(MessageRevision, "before_update")
@event.listens_for(MessageRevision, "before_delete")
@event.listens_for(MessageApproval, "before_update")
@event.listens_for(MessageApproval, "before_delete")
def reject_message_history_mutation(*_: Any) -> None:
    raise ValueError("Message revisions and approvals are append-only")


class TimelineEntry(Base):
    __tablename__ = "timeline_entries"
    __table_args__ = (
        UniqueConstraint("school_id", "source_key", name="uq_timeline_school_source"),
        CheckConstraint(
            "visibility IN ('INTERNAL', 'STAFF', 'GUARDIAN')", name="ck_timeline_visibility"
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    school_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("schools.id", ondelete="CASCADE"), nullable=False, index=True
    )
    student_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("students.id", ondelete="CASCADE"), nullable=False, index=True
    )
    source_key: Mapped[str] = mapped_column(String(200), nullable=False)
    entry_type: Mapped[str] = mapped_column(String(80), nullable=False)
    visibility: Mapped[str] = mapped_column(String(32), nullable=False)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    summary: Mapped[str] = mapped_column(String(1000), nullable=False)
    details: Mapped[dict[str, Any]] = mapped_column(json_type, nullable=False)
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class School(Base):
    __tablename__ = "schools"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    timezone: Mapped[str] = mapped_column(String(80), nullable=False, default="Europe/Berlin")
    language: Mapped[str] = mapped_column(String(16), nullable=False, default="en")
    working_days: Mapped[dict[str, Any]] = mapped_column(
        json_type,
        nullable=False,
        default=lambda: {"days": ["MON", "TUE", "WED", "THU", "FRI"]},
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )

    memberships: Mapped[list["SchoolMembership"]] = orm_relationship(back_populates="school")


class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    email: Mapped[str] = mapped_column(String(320), nullable=False, unique=True)
    display_name: Mapped[str] = mapped_column(String(200), nullable=False)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="ACTIVE")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )

    memberships: Mapped[list["SchoolMembership"]] = orm_relationship(back_populates="user")
    sessions: Mapped[list["UserSession"]] = orm_relationship(back_populates="user")


class SchoolMembership(Base):
    __tablename__ = "school_memberships"
    __table_args__ = (
        UniqueConstraint("user_id", "school_id", name="uq_school_memberships_user_school"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    school_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("schools.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    role: Mapped[str] = mapped_column(String(32), nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="ACTIVE")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )

    school: Mapped[School] = orm_relationship(back_populates="memberships")
    user: Mapped[User] = orm_relationship(back_populates="memberships")


class UserSession(Base):
    __tablename__ = "user_sessions"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    token_hash: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    current_school_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("schools.id", ondelete="SET NULL"),
        nullable=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    user: Mapped[User] = orm_relationship(back_populates="sessions")
    current_school: Mapped[School | None] = orm_relationship()


class AcademicYear(Base):
    __tablename__ = "academic_years"
    __table_args__ = (UniqueConstraint("school_id", "name", name="uq_academic_years_school_name"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    school_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("schools.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    starts_on: Mapped[date] = mapped_column(Date, nullable=False)
    ends_on: Mapped[date] = mapped_column(Date, nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="ACTIVE")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )

    school: Mapped[School] = orm_relationship()
    sections: Mapped[list["Section"]] = orm_relationship(back_populates="academic_year")


class GradeLevel(Base):
    __tablename__ = "grade_levels"
    __table_args__ = (
        UniqueConstraint("school_id", "label", name="uq_grade_levels_school_label"),
        UniqueConstraint("school_id", "sort_order", name="uq_grade_levels_school_sort_order"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    school_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("schools.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    label: Mapped[str] = mapped_column(String(80), nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="ACTIVE")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )

    school: Mapped[School] = orm_relationship()
    sections: Mapped[list["Section"]] = orm_relationship(back_populates="grade_level")


class Section(Base):
    __tablename__ = "sections"
    __table_args__ = (
        UniqueConstraint(
            "school_id",
            "academic_year_id",
            "grade_level_id",
            "label",
            name="uq_sections_school_year_level_label",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    school_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("schools.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    academic_year_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("academic_years.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    grade_level_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("grade_levels.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    label: Mapped[str] = mapped_column(String(80), nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="ACTIVE")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )

    school: Mapped[School] = orm_relationship()
    academic_year: Mapped[AcademicYear] = orm_relationship(back_populates="sections")
    grade_level: Mapped[GradeLevel] = orm_relationship(back_populates="sections")
    teacher_assignments: Mapped[list["TeacherAssignment"]] = orm_relationship(
        back_populates="section"
    )
    enrollments: Mapped[list["Enrollment"]] = orm_relationship(back_populates="section")
    attendance_sessions: Mapped[list["AttendanceSession"]] = orm_relationship(
        back_populates="section"
    )


class Subject(Base):
    __tablename__ = "subjects"
    __table_args__ = (UniqueConstraint("school_id", "name", name="uq_subjects_school_name"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    school_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("schools.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="ACTIVE")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )

    school: Mapped[School] = orm_relationship()
    teacher_assignments: Mapped[list["TeacherAssignment"]] = orm_relationship(
        back_populates="subject"
    )


class TeacherAssignment(Base):
    __tablename__ = "teacher_assignments"
    __table_args__ = (
        UniqueConstraint(
            "school_id",
            "teacher_user_id",
            "section_id",
            "subject_id",
            name="uq_teacher_assignments_school_teacher_section_subject",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    school_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("schools.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    teacher_user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    section_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("sections.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    subject_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("subjects.id", ondelete="SET NULL"),
        nullable=True,
    )
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="ACTIVE")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )

    school: Mapped[School] = orm_relationship()
    teacher: Mapped[User] = orm_relationship()
    section: Mapped[Section] = orm_relationship(back_populates="teacher_assignments")
    subject: Mapped[Subject | None] = orm_relationship(back_populates="teacher_assignments")


class Student(Base):
    __tablename__ = "students"
    __table_args__ = (
        UniqueConstraint("school_id", "student_number", name="uq_students_school_number"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    school_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("schools.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    student_number: Mapped[str] = mapped_column(String(80), nullable=False)
    given_name: Mapped[str] = mapped_column(String(120), nullable=False)
    family_name: Mapped[str] = mapped_column(String(120), nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="ACTIVE")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )

    school: Mapped[School] = orm_relationship()
    enrollments: Mapped[list["Enrollment"]] = orm_relationship(back_populates="student")
    guardian_links: Mapped[list["StudentGuardian"]] = orm_relationship(back_populates="student")
    attendance_records: Mapped[list["AttendanceRecord"]] = orm_relationship(
        back_populates="student"
    )


class Guardian(Base):
    __tablename__ = "guardians"
    __table_args__ = (UniqueConstraint("school_id", "email", name="uq_guardians_school_email"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    school_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("schools.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    display_name: Mapped[str] = mapped_column(String(200), nullable=False)
    email: Mapped[str] = mapped_column(String(320), nullable=False)
    phone: Mapped[str | None] = mapped_column(String(80), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )

    school: Mapped[School] = orm_relationship()
    user: Mapped[User | None] = orm_relationship()
    student_links: Mapped[list["StudentGuardian"]] = orm_relationship(back_populates="guardian")


class StudentGuardian(Base):
    __tablename__ = "student_guardians"
    __table_args__ = (
        UniqueConstraint("school_id", "id", name="uq_student_guardian_school_id"),
        UniqueConstraint(
            "school_id",
            "student_id",
            "guardian_id",
            name="uq_student_guardians_link",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    school_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("schools.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    student_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("students.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    guardian_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("guardians.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    relationship: Mapped[str] = mapped_column(String(80), nullable=False)
    portal_access: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    can_receive_notifications: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    emergency_contact: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )

    school: Mapped[School] = orm_relationship()
    student: Mapped[Student] = orm_relationship(back_populates="guardian_links")
    guardian: Mapped[Guardian] = orm_relationship(back_populates="student_links")


class Enrollment(Base):
    __tablename__ = "enrollments"
    __table_args__ = (
        UniqueConstraint(
            "school_id",
            "student_id",
            "section_id",
            "starts_on",
            name="uq_enrollments_school_student_section_start",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    school_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("schools.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    student_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("students.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    section_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("sections.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    starts_on: Mapped[date] = mapped_column(Date, nullable=False)
    ends_on: Mapped[date | None] = mapped_column(Date, nullable=True)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="ACTIVE")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )

    school: Mapped[School] = orm_relationship()
    student: Mapped[Student] = orm_relationship(back_populates="enrollments")
    section: Mapped[Section] = orm_relationship(back_populates="enrollments")


class AttendanceSession(Base):
    __tablename__ = "attendance_sessions"
    __table_args__ = (
        UniqueConstraint(
            "school_id",
            "section_id",
            "school_date",
            name="uq_attendance_sessions_school_section_date",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    school_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("schools.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    section_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("sections.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    school_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="DRAFT")
    finalized_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    finalized_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )

    school: Mapped[School] = orm_relationship()
    section: Mapped[Section] = orm_relationship(back_populates="attendance_sessions")
    finalized_by: Mapped[User | None] = orm_relationship()
    records: Mapped[list["AttendanceRecord"]] = orm_relationship(back_populates="session")


class AttendanceRecord(Base):
    __tablename__ = "attendance_records"
    __table_args__ = (
        UniqueConstraint("session_id", "student_id", name="uq_attendance_records_session_student"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    school_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("schools.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    session_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("attendance_sessions.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    student_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("students.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    mark: Mapped[str | None] = mapped_column(String(32), nullable=True)
    note: Mapped[str | None] = mapped_column(String(500), nullable=True)
    marked_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    marked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    correction_reason: Mapped[str | None] = mapped_column(String(500), nullable=True)
    corrected_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    corrected_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )

    school: Mapped[School] = orm_relationship()
    session: Mapped[AttendanceSession] = orm_relationship(back_populates="records")
    student: Mapped[Student] = orm_relationship(back_populates="attendance_records")
    marked_by: Mapped[User | None] = orm_relationship(foreign_keys=[marked_by_user_id])
    corrected_by: Mapped[User | None] = orm_relationship(foreign_keys=[corrected_by_user_id])
