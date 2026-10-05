from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from app.academics.routes import get_school_owned, require_admin
from app.db.models import (
    Enrollment,
    Guardian,
    SchoolMembership,
    Section,
    Student,
    StudentGuardian,
    TeacherAssignment,
    User,
)
from app.db.session import get_db
from app.identity.dependencies import SchoolContext, require_school_context
from app.students.schemas import (
    EnrollmentCreate,
    EnrollmentRead,
    GuardianCreate,
    GuardianRead,
    StudentCreate,
    StudentGuardianCreate,
    StudentRead,
)

router = APIRouter(prefix="/api/v1/students", tags=["students"])


def commit_or_conflict(db: Session, detail: str) -> None:
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=detail) from exc


def normalize_email(email: str) -> str:
    return email.strip().lower()


def load_student_for_school(db: Session, student_id: UUID, school_id: UUID) -> Student:
    student = db.scalar(
        select(Student)
        .where(Student.id == student_id, Student.school_id == school_id)
        .options(
            selectinload(Student.enrollments),
            selectinload(Student.guardian_links),
        )
        .execution_options(populate_existing=True)
    )
    if student is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Student not found")
    return student


def accessible_student_ids(db: Session, context: SchoolContext) -> set[UUID] | None:
    role = context.membership.role
    school_id = context.school.id
    if role == "ADMIN":
        return None
    if role == "TEACHER":
        return set(
            db.scalars(
                select(Enrollment.student_id)
                .join(Section, Section.id == Enrollment.section_id)
                .join(TeacherAssignment, TeacherAssignment.section_id == Section.id)
                .where(
                    TeacherAssignment.school_id == school_id,
                    TeacherAssignment.teacher_user_id == context.user.id,
                    TeacherAssignment.status == "ACTIVE",
                    Enrollment.school_id == school_id,
                    Enrollment.status == "ACTIVE",
                )
            )
        )
    if role == "GUARDIAN":
        return set(
            db.scalars(
                select(StudentGuardian.student_id)
                .join(Guardian, Guardian.id == StudentGuardian.guardian_id)
                .where(
                    StudentGuardian.school_id == school_id,
                    StudentGuardian.portal_access.is_(True),
                    Guardian.user_id == context.user.id,
                )
            )
        )
    return set()


def ensure_student_access(db: Session, context: SchoolContext, student_id: UUID) -> Student:
    student = load_student_for_school(db, student_id, context.school.id)
    allowed_ids = accessible_student_ids(db, context)
    if allowed_ids is not None and student.id not in allowed_ids:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Student access denied")
    return student


@router.get("", response_model=list[StudentRead])
def list_students(
    context: SchoolContext = Depends(require_school_context),
    db: Session = Depends(get_db),
) -> list[Student]:
    allowed_ids = accessible_student_ids(db, context)
    query = (
        select(Student)
        .where(Student.school_id == context.school.id)
        .options(selectinload(Student.enrollments), selectinload(Student.guardian_links))
        .order_by(Student.family_name, Student.given_name)
    )
    if allowed_ids is not None:
        if not allowed_ids:
            return []
        query = query.where(Student.id.in_(allowed_ids))
    return list(db.scalars(query))


@router.post("", status_code=status.HTTP_201_CREATED, response_model=StudentRead)
def create_student(
    payload: StudentCreate,
    context: SchoolContext = Depends(require_admin),
    db: Session = Depends(get_db),
) -> Student:
    student = Student(
        school_id=context.school.id,
        student_number=payload.student_number.strip(),
        given_name=payload.given_name.strip(),
        family_name=payload.family_name.strip(),
    )
    db.add(student)
    commit_or_conflict(db, "Student number already exists for this school")
    db.refresh(student)
    return load_student_for_school(db, student.id, context.school.id)


@router.get("/users/teachers", response_model=list[dict[str, str]])
def list_teacher_users(
    context: SchoolContext = Depends(require_admin),
    db: Session = Depends(get_db),
) -> list[dict[str, str]]:
    rows = db.execute(
        select(User.id, User.display_name, User.email)
        .join(SchoolMembership, SchoolMembership.user_id == User.id)
        .where(
            SchoolMembership.school_id == context.school.id,
            SchoolMembership.role == "TEACHER",
            SchoolMembership.status == "ACTIVE",
        )
        .order_by(User.display_name)
    )
    return [
        {"id": str(user_id), "display_name": display_name, "email": email}
        for user_id, display_name, email in rows
    ]


@router.get("/{student_id}", response_model=StudentRead)
def get_student(
    student_id: UUID,
    context: SchoolContext = Depends(require_school_context),
    db: Session = Depends(get_db),
) -> Student:
    return ensure_student_access(db, context, student_id)


@router.post("/guardians", status_code=status.HTTP_201_CREATED, response_model=GuardianRead)
def create_guardian(
    payload: GuardianCreate,
    context: SchoolContext = Depends(require_admin),
    db: Session = Depends(get_db),
) -> Guardian:
    if payload.user_id is not None:
        membership = db.scalar(
            select(SchoolMembership).where(
                SchoolMembership.school_id == context.school.id,
                SchoolMembership.user_id == payload.user_id,
                SchoolMembership.role == "GUARDIAN",
                SchoolMembership.status == "ACTIVE",
            )
        )
        if membership is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Guardian user must be an active guardian member of the selected school",
            )
    guardian = Guardian(
        school_id=context.school.id,
        user_id=payload.user_id,
        display_name=payload.display_name.strip(),
        email=normalize_email(payload.email),
        phone=payload.phone.strip() if payload.phone else None,
    )
    db.add(guardian)
    commit_or_conflict(db, "Guardian email already exists for this school")
    db.refresh(guardian)
    return guardian


@router.post(
    "/{student_id}/guardians",
    status_code=status.HTTP_201_CREATED,
    response_model=StudentRead,
)
def link_guardian(
    student_id: UUID,
    payload: StudentGuardianCreate,
    context: SchoolContext = Depends(require_admin),
    db: Session = Depends(get_db),
) -> Student:
    student = load_student_for_school(db, student_id, context.school.id)
    guardian = get_school_owned(db, Guardian, payload.guardian_id, context.school.id)
    link = StudentGuardian(
        school_id=context.school.id,
        student_id=student.id,
        guardian_id=guardian.id,
        relationship=payload.relationship.strip(),
        portal_access=payload.portal_access,
        can_receive_notifications=payload.can_receive_notifications,
        emergency_contact=payload.emergency_contact,
    )
    db.add(link)
    commit_or_conflict(db, "Guardian is already linked to this student")
    return load_student_for_school(db, student.id, context.school.id)


@router.post("/enrollments", status_code=status.HTTP_201_CREATED, response_model=EnrollmentRead)
def create_enrollment(
    payload: EnrollmentCreate,
    context: SchoolContext = Depends(require_admin),
    db: Session = Depends(get_db),
) -> Enrollment:
    load_student_for_school(db, payload.student_id, context.school.id)
    get_school_owned(db, Section, payload.section_id, context.school.id)
    enrollment = Enrollment(
        school_id=context.school.id,
        student_id=payload.student_id,
        section_id=payload.section_id,
        starts_on=payload.starts_on,
        ends_on=payload.ends_on,
    )
    db.add(enrollment)
    commit_or_conflict(db, "Enrollment already exists for this student, section, and start date")
    db.refresh(enrollment)
    return enrollment
