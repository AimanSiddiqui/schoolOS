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
    StudentUpdate,
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


def serialize_student(student: Student) -> dict[str, object]:
    enrollments = []
    for enrollment in sorted(student.enrollments, key=lambda item: item.starts_on, reverse=True):
        section = enrollment.section
        grade_level = section.grade_level if section is not None else None
        academic_year = section.academic_year if section is not None else None
        enrollments.append(
            {
                "id": enrollment.id,
                "section_id": enrollment.section_id,
                "section_label": section.label if section is not None else None,
                "grade_level_id": section.grade_level_id if section is not None else None,
                "grade_label": grade_level.label if grade_level is not None else None,
                "academic_year_id": section.academic_year_id if section is not None else None,
                "academic_year_name": academic_year.name if academic_year is not None else None,
                "starts_on": enrollment.starts_on,
                "ends_on": enrollment.ends_on,
                "status": enrollment.status,
            }
        )

    guardian_links = []
    for link in sorted(student.guardian_links, key=lambda item: item.created_at):
        guardian = link.guardian
        guardian_links.append(
            {
                "id": link.id,
                "guardian_id": link.guardian_id,
                "guardian_display_name": guardian.display_name if guardian is not None else None,
                "guardian_email": guardian.email if guardian is not None else None,
                "guardian_phone": guardian.phone if guardian is not None else None,
                "relationship": link.relationship,
                "portal_access": link.portal_access,
                "can_receive_notifications": link.can_receive_notifications,
                "emergency_contact": link.emergency_contact,
            }
        )

    return {
        "id": student.id,
        "student_number": student.student_number,
        "given_name": student.given_name,
        "family_name": student.family_name,
        "status": student.status,
        "enrollments": enrollments,
        "guardian_links": guardian_links,
    }


def load_student_for_school(db: Session, student_id: UUID, school_id: UUID) -> Student:
    student = db.scalar(
        select(Student)
        .where(Student.id == student_id, Student.school_id == school_id)
        .options(
            selectinload(Student.enrollments)
            .selectinload(Enrollment.section)
            .selectinload(Section.grade_level),
            selectinload(Student.enrollments)
            .selectinload(Enrollment.section)
            .selectinload(Section.academic_year),
            selectinload(Student.guardian_links).selectinload(StudentGuardian.guardian),
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
    q: str | None = None,
    section_id: UUID | None = None,
    grade_level_id: UUID | None = None,
    status_filter: str | None = None,
    context: SchoolContext = Depends(require_school_context),
    db: Session = Depends(get_db),
) -> list[dict[str, object]]:
    allowed_ids = accessible_student_ids(db, context)
    query = (
        select(Student)
        .where(Student.school_id == context.school.id)
        .options(
            selectinload(Student.enrollments)
            .selectinload(Enrollment.section)
            .selectinload(Section.grade_level),
            selectinload(Student.enrollments)
            .selectinload(Enrollment.section)
            .selectinload(Section.academic_year),
            selectinload(Student.guardian_links).selectinload(StudentGuardian.guardian),
        )
        .order_by(Student.family_name, Student.given_name)
    )
    if q:
        search = f"%{q.strip().lower()}%"
        query = query.where(
            Student.student_number.ilike(search)
            | Student.given_name.ilike(search)
            | Student.family_name.ilike(search)
        )
    if status_filter:
        query = query.where(Student.status == status_filter.strip().upper())
    if section_id is not None:
        query = query.where(
            Student.id.in_(
                select(Enrollment.student_id).where(
                    Enrollment.school_id == context.school.id,
                    Enrollment.section_id == section_id,
                )
            )
        )
    if grade_level_id is not None:
        query = query.where(
            Student.id.in_(
                select(Enrollment.student_id)
                .join(Section, Section.id == Enrollment.section_id)
                .where(
                    Enrollment.school_id == context.school.id,
                    Section.grade_level_id == grade_level_id,
                )
            )
        )
    if allowed_ids is not None:
        if not allowed_ids:
            return []
        query = query.where(Student.id.in_(allowed_ids))
    return [serialize_student(student) for student in db.scalars(query)]


@router.post("", status_code=status.HTTP_201_CREATED, response_model=StudentRead)
def create_student(
    payload: StudentCreate,
    context: SchoolContext = Depends(require_admin),
    db: Session = Depends(get_db),
) -> dict[str, object]:
    student = Student(
        school_id=context.school.id,
        student_number=payload.student_number.strip(),
        given_name=payload.given_name.strip(),
        family_name=payload.family_name.strip(),
    )
    db.add(student)
    commit_or_conflict(db, "Student number already exists for this school")
    db.refresh(student)
    return serialize_student(load_student_for_school(db, student.id, context.school.id))


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


@router.get("/guardians", response_model=list[GuardianRead])
def list_guardians(
    context: SchoolContext = Depends(require_admin),
    db: Session = Depends(get_db),
) -> list[Guardian]:
    return list(
        db.scalars(
            select(Guardian)
            .where(Guardian.school_id == context.school.id)
            .order_by(Guardian.display_name)
        )
    )


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


@router.get("/{student_id}", response_model=StudentRead)
def get_student(
    student_id: UUID,
    context: SchoolContext = Depends(require_school_context),
    db: Session = Depends(get_db),
) -> dict[str, object]:
    return serialize_student(ensure_student_access(db, context, student_id))


@router.patch("/{student_id}", response_model=StudentRead)
def update_student(
    student_id: UUID,
    payload: StudentUpdate,
    context: SchoolContext = Depends(require_admin),
    db: Session = Depends(get_db),
) -> dict[str, object]:
    student = load_student_for_school(db, student_id, context.school.id)
    if payload.student_number is not None:
        student.student_number = payload.student_number.strip()
    if payload.given_name is not None:
        student.given_name = payload.given_name.strip()
    if payload.family_name is not None:
        student.family_name = payload.family_name.strip()
    if payload.status is not None:
        status_value = payload.status.strip().upper()
        if status_value not in {"ACTIVE", "INACTIVE"}:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Student status must be ACTIVE or INACTIVE",
            )
        student.status = status_value
    commit_or_conflict(db, "Student number already exists for this school")
    return serialize_student(load_student_for_school(db, student.id, context.school.id))


@router.post("/{student_id}/deactivate", response_model=StudentRead)
def deactivate_student(
    student_id: UUID,
    context: SchoolContext = Depends(require_admin),
    db: Session = Depends(get_db),
) -> dict[str, object]:
    student = load_student_for_school(db, student_id, context.school.id)
    student.status = "INACTIVE"
    for enrollment in student.enrollments:
        if enrollment.status == "ACTIVE":
            enrollment.status = "INACTIVE"
    db.commit()
    return serialize_student(load_student_for_school(db, student.id, context.school.id))


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
) -> dict[str, object]:
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
    return serialize_student(load_student_for_school(db, student.id, context.school.id))


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
