from datetime import UTC, date, datetime
from uuid import UUID, uuid4
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import or_, select
from sqlalchemy.orm import Session, selectinload

from app.attendance.events import record_transition
from app.attendance.schemas import (
    VALID_ATTENDANCE_MARKS,
    AttendanceCorrection,
    AttendanceDraftSave,
    AttendanceHistoryEntry,
    AttendanceHistoryPage,
    AttendanceRosterRecord,
    AttendanceSectionSummary,
    AttendanceSessionRead,
)
from app.db.models import (
    AttendanceRecord,
    AttendanceSession,
    AuditEntry,
    Enrollment,
    Section,
    Student,
    TeacherAssignment,
)
from app.db.session import get_db
from app.identity.dependencies import SchoolContext, require_school_context

router = APIRouter(prefix="/api/v1/attendance", tags=["attendance"])


def school_today(context: SchoolContext) -> date:
    try:
        timezone = ZoneInfo(context.school.timezone)
    except Exception:
        timezone = ZoneInfo("UTC")
    return datetime.now(timezone).date()


def selected_date(context: SchoolContext, school_date: date | None) -> date:
    return school_date if school_date is not None else school_today(context)


def now_utc() -> datetime:
    return datetime.now(UTC)


def ensure_attendance_role(context: SchoolContext) -> None:
    if context.membership.role not in {"ADMIN", "TEACHER"}:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Attendance is available to admins and assigned teachers",
        )


def accessible_sections(db: Session, context: SchoolContext) -> list[Section]:
    ensure_attendance_role(context)
    query = (
        select(Section)
        .where(Section.school_id == context.school.id, Section.status == "ACTIVE")
        .options(selectinload(Section.grade_level))
        .order_by(Section.label)
    )
    if context.membership.role == "TEACHER":
        query = query.join(TeacherAssignment, TeacherAssignment.section_id == Section.id).where(
            TeacherAssignment.teacher_user_id == context.user.id,
            TeacherAssignment.status == "ACTIVE",
        )
    return list(db.scalars(query).unique())


def load_section(db: Session, context: SchoolContext, section_id: UUID) -> Section:
    for section in accessible_sections(db, context):
        if section.id == section_id:
            return section
    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Section not found")


def roster_students(
    db: Session,
    *,
    school_id: UUID,
    section_id: UUID,
    school_date: date,
) -> list[Student]:
    return list(
        db.scalars(
            select(Student)
            .join(Enrollment, Enrollment.student_id == Student.id)
            .where(
                Student.school_id == school_id,
                Student.status == "ACTIVE",
                Enrollment.school_id == school_id,
                Enrollment.section_id == section_id,
                Enrollment.status == "ACTIVE",
                Enrollment.starts_on <= school_date,
                or_(Enrollment.ends_on.is_(None), Enrollment.ends_on >= school_date),
            )
            .order_by(Student.family_name, Student.given_name, Student.student_number)
        )
    )


def load_session(
    db: Session,
    *,
    school_id: UUID,
    section_id: UUID,
    school_date: date,
) -> AttendanceSession | None:
    return db.scalar(
        select(AttendanceSession)
        .where(
            AttendanceSession.school_id == school_id,
            AttendanceSession.section_id == section_id,
            AttendanceSession.school_date == school_date,
        )
        .options(selectinload(AttendanceSession.records))
        .execution_options(populate_existing=True)
    )


def get_or_create_session(
    db: Session,
    *,
    school_id: UUID,
    section_id: UUID,
    school_date: date,
) -> AttendanceSession:
    # Lock the stable parent even when today's session does not exist yet. All
    # attendance mutations take this lock, including corrections and draft saves.
    db.execute(
        select(Section.id)
        .where(Section.id == section_id, Section.school_id == school_id)
        .with_for_update()
    ).scalar_one()
    session = load_session(
        db,
        school_id=school_id,
        section_id=section_id,
        school_date=school_date,
    )
    if session is not None:
        return session
    session = AttendanceSession(
        school_id=school_id,
        section_id=section_id,
        school_date=school_date,
        status="DRAFT",
    )
    db.add(session)
    db.flush()
    return session


def summarize_counts(records: list[AttendanceRecord], total_students: int) -> dict[str, int]:
    return {
        "total_students": total_students,
        "marked_count": sum(1 for record in records if record.mark in VALID_ATTENDANCE_MARKS),
        "absent_count": sum(1 for record in records if record.mark == "ABSENT"),
        "late_count": sum(1 for record in records if record.mark == "LATE"),
        "excused_count": sum(1 for record in records if record.mark == "EXCUSED"),
    }


def serialize_session(
    session: AttendanceSession,
    section: Section,
    roster: list[Student],
) -> AttendanceSessionRead:
    records_by_student = {record.student_id: record for record in session.records}
    rows = []
    for student in roster:
        record = records_by_student.get(student.id)
        rows.append(
            AttendanceRosterRecord(
                record_id=record.id if record is not None else None,
                student_id=student.id,
                student_number=student.student_number,
                given_name=student.given_name,
                family_name=student.family_name,
                mark=record.mark if record is not None else None,
                note=record.note if record is not None else None,
                correction_reason=record.correction_reason if record is not None else None,
            )
        )
    counts = summarize_counts(list(records_by_student.values()), len(roster))
    return AttendanceSessionRead(
        session_id=session.id,
        section_id=section.id,
        section_label=section.label,
        grade_label=section.grade_level.label if section.grade_level is not None else None,
        school_date=session.school_date,
        status=session.status,
        finalized_at=session.finalized_at,
        records=rows,
        **counts,
    )


def save_records(
    db: Session,
    *,
    context: SchoolContext,
    session: AttendanceSession,
    roster: list[Student],
    payload: AttendanceDraftSave,
) -> None:
    if session.status == "FINAL":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Finalized attendance requires a correction",
        )

    roster_ids = {student.id for student in roster}
    records_by_student = {record.student_id: record for record in session.records}
    stamped_at = now_utc()
    changes = []
    for item in payload.records:
        if item.student_id not in roster_ids:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Attendance record student is not on the selected roster",
            )
        record = records_by_student.get(item.student_id)
        previous_mark = record.mark if record is not None else None
        previous_note = record.note if record is not None else None
        if (previous_mark, previous_note) == (item.mark, item.note):
            continue
        if record is None:
            record = AttendanceRecord(
                id=uuid4(),
                school_id=context.school.id,
                session_id=session.id,
                student_id=item.student_id,
            )
            db.add(record)
            session.records.append(record)
        changes.append(
            {
                "record_id": str(record.id),
                "student_id": str(item.student_id),
                "before_mark": previous_mark,
                "after_mark": item.mark,
                "note_changed": previous_note != item.note,
            }
        )
        record.mark = item.mark
        record.note = item.note
        record.marked_by_user_id = context.user.id
        record.marked_at = stamped_at
    if changes:
        record_transition(
            db,
            context=context,
            session=session,
            operation="attendance.draft_saved",
            changes={"records": changes},
            occurred_at=stamped_at,
        )


@router.get("/sections", response_model=list[AttendanceSectionSummary])
def list_attendance_sections(
    school_date: date | None = None,
    context: SchoolContext = Depends(require_school_context),
    db: Session = Depends(get_db),
) -> list[AttendanceSectionSummary]:
    attendance_date = selected_date(context, school_date)
    summaries = []
    for section in accessible_sections(db, context):
        roster = roster_students(
            db,
            school_id=context.school.id,
            section_id=section.id,
            school_date=attendance_date,
        )
        session = load_session(
            db,
            school_id=context.school.id,
            section_id=section.id,
            school_date=attendance_date,
        )
        records = list(session.records) if session is not None else []
        summaries.append(
            AttendanceSectionSummary(
                section_id=section.id,
                section_label=section.label,
                grade_label=section.grade_level.label if section.grade_level is not None else None,
                school_date=attendance_date,
                status=session.status if session is not None else "NOT_STARTED",
                **summarize_counts(records, len(roster)),
            )
        )
    return summaries


@router.get("/sections/{section_id}/history", response_model=AttendanceHistoryPage)
def get_attendance_history(
    section_id: UUID,
    school_date: date | None = None,
    limit: int = Query(default=25, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    context: SchoolContext = Depends(require_school_context),
    db: Session = Depends(get_db),
) -> AttendanceHistoryPage:
    section = load_section(db, context, section_id)
    session = load_session(
        db,
        school_id=context.school.id,
        section_id=section.id,
        school_date=selected_date(context, school_date),
    )
    if session is None:
        return AttendanceHistoryPage(entries=[], has_more=False)
    entries = list(
        db.scalars(
            select(AuditEntry)
            .where(
                AuditEntry.school_id == context.school.id,
                AuditEntry.target_type == "AttendanceSession",
                AuditEntry.target_id == session.id,
            )
            .options(selectinload(AuditEntry.actor))
            .order_by(AuditEntry.occurred_at.desc(), AuditEntry.id.desc())
            .offset(offset)
            .limit(limit + 1)
        )
    )
    return AttendanceHistoryPage(
        entries=[
            AttendanceHistoryEntry(
                id=entry.id,
                operation=entry.operation,
                actor_name=entry.actor.display_name if entry.actor else None,
                occurred_at=entry.occurred_at.replace(tzinfo=UTC)
                if entry.occurred_at.tzinfo is None
                else entry.occurred_at,
                changes=entry.changes,
            )
            for entry in entries[:limit]
        ],
        has_more=len(entries) > limit,
    )


@router.get("/sections/{section_id}", response_model=AttendanceSessionRead)
def get_attendance_session(
    section_id: UUID,
    school_date: date | None = None,
    context: SchoolContext = Depends(require_school_context),
    db: Session = Depends(get_db),
) -> AttendanceSessionRead:
    attendance_date = selected_date(context, school_date)
    section = load_section(db, context, section_id)
    roster = roster_students(
        db,
        school_id=context.school.id,
        section_id=section.id,
        school_date=attendance_date,
    )
    session = get_or_create_session(
        db,
        school_id=context.school.id,
        section_id=section.id,
        school_date=attendance_date,
    )
    db.commit()
    db.refresh(session)
    return serialize_session(session, section, roster)


@router.post("/sections/{section_id}/draft", response_model=AttendanceSessionRead)
def save_attendance_draft(
    section_id: UUID,
    payload: AttendanceDraftSave,
    school_date: date | None = None,
    context: SchoolContext = Depends(require_school_context),
    db: Session = Depends(get_db),
) -> AttendanceSessionRead:
    attendance_date = selected_date(context, school_date)
    section = load_section(db, context, section_id)
    roster = roster_students(
        db,
        school_id=context.school.id,
        section_id=section.id,
        school_date=attendance_date,
    )
    session = get_or_create_session(
        db,
        school_id=context.school.id,
        section_id=section.id,
        school_date=attendance_date,
    )
    save_records(db, context=context, session=session, roster=roster, payload=payload)
    db.commit()
    db.refresh(session)
    return serialize_session(session, section, roster)


@router.post("/sections/{section_id}/finalize", response_model=AttendanceSessionRead)
def finalize_attendance(
    section_id: UUID,
    school_date: date | None = None,
    context: SchoolContext = Depends(require_school_context),
    db: Session = Depends(get_db),
) -> AttendanceSessionRead:
    attendance_date = selected_date(context, school_date)
    section = load_section(db, context, section_id)
    roster = roster_students(
        db,
        school_id=context.school.id,
        section_id=section.id,
        school_date=attendance_date,
    )
    session = get_or_create_session(
        db,
        school_id=context.school.id,
        section_id=section.id,
        school_date=attendance_date,
    )
    if session.status == "FINAL":
        return serialize_session(session, section, roster)

    marked_student_ids = {
        record.student_id for record in session.records if record.mark in VALID_ATTENDANCE_MARKS
    }
    missing = [student for student in roster if student.id not in marked_student_ids]
    if missing:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="All roster students must be marked before finalizing attendance",
        )

    session.status = "FINAL"
    session.finalized_by_user_id = context.user.id
    session.finalized_at = now_utc()
    record_transition(
        db,
        context=context,
        session=session,
        operation="attendance.finalized",
        changes={"before_status": "DRAFT", "after_status": "FINAL"},
        occurred_at=session.finalized_at,
        event_payload={
            "records": [
                {
                    "record_id": str(record.id),
                    "student_id": str(record.student_id),
                    "mark": record.mark,
                }
                for record in session.records
            ]
        },
    )
    db.commit()
    db.refresh(session)
    return serialize_session(session, section, roster)


@router.patch("/records/{record_id}", response_model=AttendanceSessionRead)
def correct_attendance_record(
    record_id: UUID,
    payload: AttendanceCorrection,
    context: SchoolContext = Depends(require_school_context),
    db: Session = Depends(get_db),
) -> AttendanceSessionRead:
    ensure_attendance_role(context)
    record = db.scalar(
        select(AttendanceRecord)
        .where(AttendanceRecord.id == record_id, AttendanceRecord.school_id == context.school.id)
        .options(selectinload(AttendanceRecord.session).selectinload(AttendanceSession.section))
    )
    if record is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Attendance record not found",
        )
    section = load_section(db, context, record.session.section_id)
    session = get_or_create_session(
        db,
        school_id=context.school.id,
        section_id=section.id,
        school_date=record.session.school_date,
    )
    if session.status != "FINAL":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Corrections are available after attendance is finalized",
        )
    roster = roster_students(
        db,
        school_id=context.school.id,
        section_id=section.id,
        school_date=session.school_date,
    )
    if (record.mark, record.note) == (payload.mark, payload.note):
        return serialize_session(session, section, roster)
    previous_mark, previous_note = record.mark, record.note
    record.mark = payload.mark
    record.note = payload.note
    record.correction_reason = payload.reason
    record.corrected_by_user_id = context.user.id
    record.corrected_at = now_utc()
    record_transition(
        db,
        context=context,
        session=session,
        operation="attendance.corrected",
        changes={
            "record_id": str(record.id),
            "student_id": str(record.student_id),
            "before_mark": previous_mark,
            "after_mark": record.mark,
            "note_changed": previous_note != record.note,
            "reason": payload.reason,
        },
        occurred_at=record.corrected_at,
        event_payload={
            "record_id": str(record.id),
            "student_id": str(record.student_id),
            "mark": record.mark,
        },
    )
    db.commit()
    db.refresh(record.session)
    return serialize_session(record.session, section, roster)
