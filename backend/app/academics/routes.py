from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.academics.schemas import (
    AcademicSetupRead,
    AcademicYearCreate,
    AcademicYearRead,
    GradeLevelCreate,
    GradeLevelRead,
    SectionCreate,
    SectionRead,
    SubjectCreate,
    SubjectRead,
    TeacherAssignmentCreate,
    TeacherAssignmentRead,
)
from app.db.models import (
    AcademicYear,
    GradeLevel,
    SchoolMembership,
    Section,
    Subject,
    TeacherAssignment,
)
from app.db.session import get_db
from app.identity.dependencies import SchoolContext, require_school_context

router = APIRouter(prefix="/api/v1/academics", tags=["academics"])


def require_admin(context: SchoolContext = Depends(require_school_context)) -> SchoolContext:
    if context.membership.role != "ADMIN":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin role required",
        )
    return context


def get_school_owned(db: Session, model: type, item_id: UUID, school_id: UUID):
    item = db.get(model, item_id)
    if item is None or item.school_id != school_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"{model.__name__} does not belong to the selected school",
        )
    return item


def commit_or_conflict(db: Session, detail: str) -> None:
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=detail) from exc


@router.get("/setup", response_model=AcademicSetupRead)
def get_setup(
    context: SchoolContext = Depends(require_school_context),
    db: Session = Depends(get_db),
) -> AcademicSetupRead:
    school_id = context.school.id
    return AcademicSetupRead(
        academic_years=list(
            db.scalars(
                select(AcademicYear)
                .where(AcademicYear.school_id == school_id)
                .order_by(AcademicYear.starts_on)
            )
        ),
        grade_levels=list(
            db.scalars(
                select(GradeLevel)
                .where(GradeLevel.school_id == school_id)
                .order_by(GradeLevel.sort_order)
            )
        ),
        sections=list(
            db.scalars(
                select(Section).where(Section.school_id == school_id).order_by(Section.label)
            )
        ),
        subjects=list(
            db.scalars(
                select(Subject).where(Subject.school_id == school_id).order_by(Subject.name)
            )
        ),
        teacher_assignments=list(
            db.scalars(
                select(TeacherAssignment).where(TeacherAssignment.school_id == school_id)
            )
        ),
    )


@router.post(
    "/academic-years",
    status_code=status.HTTP_201_CREATED,
    response_model=AcademicYearRead,
)
def create_academic_year(
    payload: AcademicYearCreate,
    context: SchoolContext = Depends(require_admin),
    db: Session = Depends(get_db),
) -> AcademicYear:
    academic_year = AcademicYear(
        school_id=context.school.id,
        name=payload.name.strip(),
        starts_on=payload.starts_on,
        ends_on=payload.ends_on,
    )
    db.add(academic_year)
    commit_or_conflict(db, "Academic year already exists for this school")
    db.refresh(academic_year)
    return academic_year


@router.post("/grade-levels", status_code=status.HTTP_201_CREATED, response_model=GradeLevelRead)
def create_grade_level(
    payload: GradeLevelCreate,
    context: SchoolContext = Depends(require_admin),
    db: Session = Depends(get_db),
) -> GradeLevel:
    grade_level = GradeLevel(
        school_id=context.school.id,
        label=payload.label.strip(),
        sort_order=payload.sort_order,
    )
    db.add(grade_level)
    commit_or_conflict(db, "Grade level label or order already exists for this school")
    db.refresh(grade_level)
    return grade_level


@router.post("/sections", status_code=status.HTTP_201_CREATED, response_model=SectionRead)
def create_section(
    payload: SectionCreate,
    context: SchoolContext = Depends(require_admin),
    db: Session = Depends(get_db),
) -> Section:
    get_school_owned(db, AcademicYear, payload.academic_year_id, context.school.id)
    get_school_owned(db, GradeLevel, payload.grade_level_id, context.school.id)
    section = Section(
        school_id=context.school.id,
        academic_year_id=payload.academic_year_id,
        grade_level_id=payload.grade_level_id,
        label=payload.label.strip(),
    )
    db.add(section)
    commit_or_conflict(db, "Section already exists for this year and grade level")
    db.refresh(section)
    return section


@router.post("/subjects", status_code=status.HTTP_201_CREATED, response_model=SubjectRead)
def create_subject(
    payload: SubjectCreate,
    context: SchoolContext = Depends(require_admin),
    db: Session = Depends(get_db),
) -> Subject:
    subject = Subject(school_id=context.school.id, name=payload.name.strip())
    db.add(subject)
    commit_or_conflict(db, "Subject already exists for this school")
    db.refresh(subject)
    return subject


@router.post(
    "/teacher-assignments",
    status_code=status.HTTP_201_CREATED,
    response_model=TeacherAssignmentRead,
)
def create_teacher_assignment(
    payload: TeacherAssignmentCreate,
    context: SchoolContext = Depends(require_admin),
    db: Session = Depends(get_db),
) -> TeacherAssignment:
    get_school_owned(db, Section, payload.section_id, context.school.id)
    if payload.subject_id is not None:
        get_school_owned(db, Subject, payload.subject_id, context.school.id)
    teacher_membership = db.scalar(
        select(SchoolMembership).where(
            SchoolMembership.school_id == context.school.id,
            SchoolMembership.user_id == payload.teacher_user_id,
            SchoolMembership.role == "TEACHER",
            SchoolMembership.status == "ACTIVE",
        )
    )
    if teacher_membership is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Teacher must be an active teacher member of the selected school",
        )

    assignment = TeacherAssignment(
        school_id=context.school.id,
        teacher_user_id=payload.teacher_user_id,
        section_id=payload.section_id,
        subject_id=payload.subject_id,
    )
    db.add(assignment)
    commit_or_conflict(db, "Teacher assignment already exists")
    db.refresh(assignment)
    return assignment
