from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.academics.schemas import (
    AcademicSetupRead,
    AcademicYearCreate,
    AcademicYearRead,
    AcademicYearUpdate,
    GradeLevelCreate,
    GradeLevelRead,
    GradeLevelUpdate,
    SectionCreate,
    SectionRead,
    SectionUpdate,
    SubjectCreate,
    SubjectRead,
    SubjectUpdate,
    TeacherAssignmentCreate,
    TeacherAssignmentRead,
    TeacherAssignmentUpdate,
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


def normalized_status(value: str) -> str:
    normalized = value.strip().upper()
    if normalized not in {"ACTIVE", "INACTIVE"}:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Status must be ACTIVE or INACTIVE",
        )
    return normalized


def require_teacher_membership(db: Session, school_id: UUID, teacher_user_id: UUID) -> None:
    teacher_membership = db.scalar(
        select(SchoolMembership).where(
            SchoolMembership.school_id == school_id,
            SchoolMembership.user_id == teacher_user_id,
            SchoolMembership.role == "TEACHER",
            SchoolMembership.status == "ACTIVE",
        )
    )
    if teacher_membership is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Teacher must be an active teacher member of the selected school",
        )


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


@router.patch("/academic-years/{academic_year_id}", response_model=AcademicYearRead)
def update_academic_year(
    academic_year_id: UUID,
    payload: AcademicYearUpdate,
    context: SchoolContext = Depends(require_admin),
    db: Session = Depends(get_db),
) -> AcademicYear:
    academic_year = get_school_owned(db, AcademicYear, academic_year_id, context.school.id)
    starts_on = payload.starts_on if payload.starts_on is not None else academic_year.starts_on
    ends_on = payload.ends_on if payload.ends_on is not None else academic_year.ends_on
    if ends_on < starts_on:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Academic year end date must be on or after the start date",
        )
    if payload.name is not None:
        academic_year.name = payload.name.strip()
    academic_year.starts_on = starts_on
    academic_year.ends_on = ends_on
    if payload.status is not None:
        academic_year.status = normalized_status(payload.status)
    commit_or_conflict(db, "Academic year already exists for this school")
    db.refresh(academic_year)
    return academic_year


@router.post("/academic-years/{academic_year_id}/deactivate", response_model=AcademicYearRead)
def deactivate_academic_year(
    academic_year_id: UUID,
    context: SchoolContext = Depends(require_admin),
    db: Session = Depends(get_db),
) -> AcademicYear:
    academic_year = get_school_owned(db, AcademicYear, academic_year_id, context.school.id)
    academic_year.status = "INACTIVE"
    db.commit()
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


@router.patch("/grade-levels/{grade_level_id}", response_model=GradeLevelRead)
def update_grade_level(
    grade_level_id: UUID,
    payload: GradeLevelUpdate,
    context: SchoolContext = Depends(require_admin),
    db: Session = Depends(get_db),
) -> GradeLevel:
    grade_level = get_school_owned(db, GradeLevel, grade_level_id, context.school.id)
    if payload.label is not None:
        grade_level.label = payload.label.strip()
    if payload.sort_order is not None:
        grade_level.sort_order = payload.sort_order
    if payload.status is not None:
        grade_level.status = normalized_status(payload.status)
    commit_or_conflict(db, "Grade level label or order already exists for this school")
    db.refresh(grade_level)
    return grade_level


@router.post("/grade-levels/{grade_level_id}/deactivate", response_model=GradeLevelRead)
def deactivate_grade_level(
    grade_level_id: UUID,
    context: SchoolContext = Depends(require_admin),
    db: Session = Depends(get_db),
) -> GradeLevel:
    grade_level = get_school_owned(db, GradeLevel, grade_level_id, context.school.id)
    grade_level.status = "INACTIVE"
    db.commit()
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


@router.patch("/sections/{section_id}", response_model=SectionRead)
def update_section(
    section_id: UUID,
    payload: SectionUpdate,
    context: SchoolContext = Depends(require_admin),
    db: Session = Depends(get_db),
) -> Section:
    section = get_school_owned(db, Section, section_id, context.school.id)
    if payload.academic_year_id is not None:
        get_school_owned(db, AcademicYear, payload.academic_year_id, context.school.id)
        section.academic_year_id = payload.academic_year_id
    if payload.grade_level_id is not None:
        get_school_owned(db, GradeLevel, payload.grade_level_id, context.school.id)
        section.grade_level_id = payload.grade_level_id
    if payload.label is not None:
        section.label = payload.label.strip()
    if payload.status is not None:
        section.status = normalized_status(payload.status)
    commit_or_conflict(db, "Section already exists for this year and grade level")
    db.refresh(section)
    return section


@router.post("/sections/{section_id}/deactivate", response_model=SectionRead)
def deactivate_section(
    section_id: UUID,
    context: SchoolContext = Depends(require_admin),
    db: Session = Depends(get_db),
) -> Section:
    section = get_school_owned(db, Section, section_id, context.school.id)
    section.status = "INACTIVE"
    for assignment in section.teacher_assignments:
        if assignment.status == "ACTIVE":
            assignment.status = "INACTIVE"
    for enrollment in section.enrollments:
        if enrollment.status == "ACTIVE":
            enrollment.status = "INACTIVE"
    db.commit()
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


@router.patch("/subjects/{subject_id}", response_model=SubjectRead)
def update_subject(
    subject_id: UUID,
    payload: SubjectUpdate,
    context: SchoolContext = Depends(require_admin),
    db: Session = Depends(get_db),
) -> Subject:
    subject = get_school_owned(db, Subject, subject_id, context.school.id)
    if payload.name is not None:
        subject.name = payload.name.strip()
    if payload.status is not None:
        subject.status = normalized_status(payload.status)
    commit_or_conflict(db, "Subject already exists for this school")
    db.refresh(subject)
    return subject


@router.post("/subjects/{subject_id}/deactivate", response_model=SubjectRead)
def deactivate_subject(
    subject_id: UUID,
    context: SchoolContext = Depends(require_admin),
    db: Session = Depends(get_db),
) -> Subject:
    subject = get_school_owned(db, Subject, subject_id, context.school.id)
    subject.status = "INACTIVE"
    for assignment in subject.teacher_assignments:
        if assignment.status == "ACTIVE":
            assignment.status = "INACTIVE"
    db.commit()
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
    require_teacher_membership(db, context.school.id, payload.teacher_user_id)

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


@router.patch("/teacher-assignments/{assignment_id}", response_model=TeacherAssignmentRead)
def update_teacher_assignment(
    assignment_id: UUID,
    payload: TeacherAssignmentUpdate,
    context: SchoolContext = Depends(require_admin),
    db: Session = Depends(get_db),
) -> TeacherAssignment:
    assignment = get_school_owned(db, TeacherAssignment, assignment_id, context.school.id)
    if payload.teacher_user_id is not None:
        require_teacher_membership(db, context.school.id, payload.teacher_user_id)
        assignment.teacher_user_id = payload.teacher_user_id
    if payload.section_id is not None:
        get_school_owned(db, Section, payload.section_id, context.school.id)
        assignment.section_id = payload.section_id
    if payload.subject_id is not None:
        get_school_owned(db, Subject, payload.subject_id, context.school.id)
        assignment.subject_id = payload.subject_id
    if payload.status is not None:
        assignment.status = normalized_status(payload.status)
    commit_or_conflict(db, "Teacher assignment already exists")
    db.refresh(assignment)
    return assignment


@router.post(
    "/teacher-assignments/{assignment_id}/deactivate",
    response_model=TeacherAssignmentRead,
)
def deactivate_teacher_assignment(
    assignment_id: UUID,
    context: SchoolContext = Depends(require_admin),
    db: Session = Depends(get_db),
) -> TeacherAssignment:
    assignment = get_school_owned(db, TeacherAssignment, assignment_id, context.school.id)
    assignment.status = "INACTIVE"
    db.commit()
    db.refresh(assignment)
    return assignment
