from datetime import UTC, date, datetime, timedelta
from typing import Any
from uuid import UUID, uuid4

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.actions.access import eligible_assignees
from app.db.models import (
    ActionItem,
    AttendancePolicy,
    AttendanceRecord,
    AttendanceSession,
    AuditEntry,
    OutboxEvent,
    School,
    Student,
    TimelineEntry,
)

ATTENDANCE_EVENTS = {"attendance.finalized", "attendance.corrected"}
ACTIVE_STATUSES = {"OPEN", "IN_PROGRESS"}


def lock_school(db: Session, school_id: UUID) -> School:
    return db.scalars(select(School).where(School.id == school_id).with_for_update()).one()


def policy_for_school(db: Session, school_id: UUID) -> AttendancePolicy:
    policy = db.get(AttendancePolicy, school_id)
    if policy is None:
        policy = AttendancePolicy(school_id=school_id, enabled=True, threshold=2, window_days=7)
        db.add(policy)
        db.flush()
    return policy


def action_history(
    db: Session,
    action: ActionItem,
    operation: str,
    summary: str,
    changes: dict[str, Any],
    actor_id: UUID | None = None,
) -> None:
    audit_id = uuid4()
    stamped_at = datetime.now(UTC)
    db.add(
        AuditEntry(
            id=audit_id,
            school_id=action.school_id,
            actor_user_id=actor_id,
            operation=operation,
            target_type="ActionItem",
            target_id=action.id,
            changes=changes,
            occurred_at=stamped_at,
        )
    )
    db.add(
        TimelineEntry(
            school_id=action.school_id,
            student_id=action.student_id,
            source_key=f"action:{audit_id}",
            entry_type=operation,
            visibility="STAFF",
            title={
                "action.created": "Attendance follow-up opened",
                "action.evidence_updated": "Follow-up evidence updated",
                "action.updated": "Follow-up updated",
            }[operation],
            summary=summary,
            details={"action_id": str(action.id), **changes},
            occurred_at=stamped_at,
        )
    )


def evidence_in_window(
    rows: list[tuple[AttendanceRecord, date]], end: date, days: int
) -> list[dict]:
    start = end - timedelta(days=days - 1)
    # A student can have multiple section records on one date. Count the date only once.
    by_date = {
        day: {
            "record_id": str(record.id),
            "section_id": str(record.session.section_id),
            "school_date": day.isoformat(),
        }
        for record, day in rows
        if start <= day <= end
    }
    return [by_date[day] for day in sorted(by_date)]


def recompute_student(
    db: Session,
    school: School,
    student: Student,
    policy: AttendancePolicy,
    actor_id: UUID | None = None,
    preferred_assignee: UUID | None = None,
) -> None:
    actions = list(
        db.scalars(
            select(ActionItem).where(
                ActionItem.school_id == school.id,
                ActionItem.student_id == student.id,
                ActionItem.rule_key == "repeated_absence",
            )
        )
    )
    active = next((action for action in actions if action.status in ACTIVE_STATUSES), None)
    closed_dates = [action.window_end for action in actions if action.status not in ACTIVE_STATUSES]
    cutoff = max(closed_dates) if closed_dates else date.min
    rows = list(
        db.execute(
            select(AttendanceRecord, AttendanceSession.school_date)
            .join(AttendanceSession, AttendanceSession.id == AttendanceRecord.session_id)
            .where(
                AttendanceRecord.school_id == school.id,
                AttendanceRecord.student_id == student.id,
                AttendanceSession.school_id == school.id,
                AttendanceSession.status == "FINAL",
                AttendanceRecord.mark == "ABSENT",
            )
            .options(selectinload(AttendanceRecord.session))
            .order_by(AttendanceSession.school_date, AttendanceRecord.id)
        ).all()
    )
    candidate_end = (
        next(
            (
                end
                for end in sorted({day for _, day in rows}, reverse=True)
                if end > cutoff
                and len(evidence_in_window(rows, end, policy.window_days)) >= policy.threshold
            ),
            None,
        )
        if policy.enabled
        else None
    )
    if active is None:
        if candidate_end is None or student.status != "ACTIVE":
            return
        assignees = eligible_assignees(db, school, student.id)
        assignee = (
            preferred_assignee if any(user.id == preferred_assignee for user in assignees) else None
        )
        stamped_at = datetime.now(UTC)
        active = ActionItem(
            id=uuid4(),
            school_id=school.id,
            student_id=student.id,
            rule_key="repeated_absence",
            status="OPEN",
            assignee_user_id=assignee,
            window_end=candidate_end,
            threshold=policy.threshold,
            window_days=policy.window_days,
            evidence=evidence_in_window(rows, candidate_end, policy.window_days),
            qualifies=True,
            revision=1,
            created_at=stamped_at,
            updated_at=stamped_at,
        )
        db.add(active)
        action_history(
            db,
            active,
            "action.created",
            "Repeated unexcused absences need review.",
            {
                "evidence": active.evidence,
                "threshold": policy.threshold,
                "window_days": policy.window_days,
                "assignee_user_id": str(assignee) if assignee else None,
            },
            actor_id,
        )
        return
    end = max(active.window_end, candidate_end) if candidate_end else active.window_end
    evidence = evidence_in_window(rows, end, policy.window_days)
    qualifies = policy.enabled and len(evidence) >= policy.threshold
    before = {
        "evidence": active.evidence,
        "qualifies": active.qualifies,
        "threshold": active.threshold,
        "window_days": active.window_days,
        "window_end": active.window_end.isoformat(),
    }
    after = {
        "evidence": evidence,
        "qualifies": qualifies,
        "threshold": policy.threshold,
        "window_days": policy.window_days,
        "window_end": end.isoformat(),
    }
    if before == after:
        return
    active.evidence, active.qualifies, active.window_end = evidence, qualifies, end
    active.threshold, active.window_days = policy.threshold, policy.window_days
    active.revision += 1
    active.updated_at = datetime.now(UTC)
    action_history(
        db,
        active,
        "action.evidence_updated",
        "Attendance evidence changed."
        if qualifies
        else "Evidence no longer meets the rule; review remains open.",
        {"before": before, "after": after},
        actor_id,
    )


def process_attendance_event(db: Session, event: OutboxEvent) -> bool:
    db.flush()
    school = lock_school(db, event.school_id)
    db.refresh(event)
    if event.status == "PROCESSED":
        return False
    if event.event_type not in ATTENDANCE_EVENTS or event.schema_version != 1:
        raise ValueError("Unsupported attendance event")
    session = db.scalar(
        select(AttendanceSession)
        .where(
            AttendanceSession.id == event.aggregate_id,
            AttendanceSession.school_id == school.id,
        )
        .options(selectinload(AttendanceSession.records))
    )
    if session is None or session.status != "FINAL":
        raise ValueError("Event does not reference finalized attendance in its school")
    records = list(session.records)
    if event.event_type == "attendance.corrected":
        records = [record for record in records if str(record.id) == event.payload.get("record_id")]
        if not records or str(records[0].student_id) != event.payload.get("student_id"):
            raise ValueError("Correction event record does not belong to the register")
    policy = policy_for_school(db, school.id)
    snapshots = {item["record_id"]: item.get("mark") for item in event.payload.get("records", [])}
    for record in records:
        student = db.scalar(
            select(Student).where(
                Student.id == record.student_id,
                Student.school_id == school.id,
            )
        )
        if student is None:
            raise ValueError("Attendance student does not belong to event school")
        mark = (
            snapshots.get(str(record.id))
            if event.event_type == "attendance.finalized"
            else event.payload.get("mark")
        )
        summary = (
            f"{session.school_date.isoformat()}: {mark.lower()}"
            if mark
            else f"Attendance updated for {session.school_date.isoformat()}."
        )
        details = {"school_date": session.school_date.isoformat()}
        if mark is not None:
            details["mark"] = mark
        db.add(
            TimelineEntry(
                school_id=school.id,
                student_id=student.id,
                source_key=f"attendance:{event.event_id}:{record.id}",
                entry_type=event.event_type,
                visibility="GUARDIAN",
                title="Attendance recorded"
                if event.event_type == "attendance.finalized"
                else "Attendance corrected",
                summary=summary,
                details=details,
                occurred_at=event.occurred_at,
            )
        )
        recompute_student(
            db, school, student, policy, preferred_assignee=session.finalized_by_user_id
        )
    event.status = "PROCESSED"
    return True
