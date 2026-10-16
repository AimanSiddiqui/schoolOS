from datetime import UTC, date, datetime
from uuid import UUID
from zoneinfo import ZoneInfo

from fastapi import HTTPException
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.db.models import (
    Enrollment,
    School,
    SchoolMembership,
    Section,
    Student,
    TeacherAssignment,
    User,
)
from app.identity.dependencies import SchoolContext


def school_date(school: School) -> date:
    try:
        timezone = ZoneInfo(school.timezone)
    except (KeyError, ValueError):
        timezone = UTC
    return datetime.now(timezone).date()


def require_staff(context: SchoolContext) -> None:
    if context.membership.role not in {"ADMIN", "TEACHER"}:
        raise HTTPException(status_code=403, detail="Action Inbox is available to school staff")


def teacher_student_ids(db: Session, school: School, user_id: UUID) -> set[UUID]:
    today = school_date(school)
    return set(
        db.scalars(
            select(Enrollment.student_id)
            .join(Section, Section.id == Enrollment.section_id)
            .join(TeacherAssignment, TeacherAssignment.section_id == Section.id)
            .where(
                Enrollment.school_id == school.id,
                Enrollment.status == "ACTIVE",
                Enrollment.starts_on <= today,
                or_(Enrollment.ends_on.is_(None), Enrollment.ends_on >= today),
                Section.school_id == school.id,
                Section.status == "ACTIVE",
                TeacherAssignment.school_id == school.id,
                TeacherAssignment.status == "ACTIVE",
                TeacherAssignment.teacher_user_id == user_id,
            )
        )
    )


def visible_student_ids(db: Session, context: SchoolContext) -> set[UUID] | None:
    require_staff(context)
    if context.membership.role == "ADMIN":
        return None
    return teacher_student_ids(db, context.school, context.user.id)


def eligible_assignees(db: Session, school: School, student_id: UUID) -> list[User]:
    today = school_date(school)
    return list(
        db.scalars(
            select(User)
            .join(SchoolMembership, SchoolMembership.user_id == User.id)
            .join(TeacherAssignment, TeacherAssignment.teacher_user_id == User.id)
            .join(Section, Section.id == TeacherAssignment.section_id)
            .join(Enrollment, Enrollment.section_id == Section.id)
            .where(
                User.status == "ACTIVE",
                SchoolMembership.school_id == school.id,
                SchoolMembership.status == "ACTIVE",
                SchoolMembership.role == "TEACHER",
                TeacherAssignment.school_id == school.id,
                TeacherAssignment.status == "ACTIVE",
                Section.school_id == school.id,
                Section.status == "ACTIVE",
                Enrollment.school_id == school.id,
                Enrollment.student_id == student_id,
                Enrollment.status == "ACTIVE",
                Enrollment.starts_on <= today,
                or_(Enrollment.ends_on.is_(None), Enrollment.ends_on >= today),
            )
            .order_by(User.display_name, User.id)
        ).unique()
    )


def require_student_scope(db: Session, context: SchoolContext, student_id: UUID) -> Student:
    allowed = visible_student_ids(db, context)
    student = db.scalar(
        select(Student).where(
            Student.id == student_id,
            Student.school_id == context.school.id,
        )
    )
    if student is None or (allowed is not None and student_id not in allowed):
        raise HTTPException(status_code=404, detail="Student not found")
    return student
