from datetime import datetime
from typing import Any
from uuid import uuid4

from sqlalchemy.orm import Session

from app.actions.service import process_attendance_event
from app.db.models import AttendanceSession, AuditEntry, OutboxEvent
from app.identity.dependencies import SchoolContext


def record_transition(
    db: Session,
    *,
    context: SchoolContext,
    session: AttendanceSession,
    operation: str,
    changes: dict[str, Any],
    occurred_at: datetime,
    event_payload: dict[str, Any] | None = None,
) -> None:
    audit_id = uuid4()
    db.add(
        AuditEntry(
            id=audit_id,
            school_id=context.school.id,
            actor_user_id=context.user.id,
            operation=operation,
            target_type="AttendanceSession",
            target_id=session.id,
            changes=changes,
            occurred_at=occurred_at,
        )
    )
    if event_payload is not None:
        # One finalization per session; each real correction has its own immutable identity.
        key = session.id if operation == "attendance.finalized" else audit_id
        event = OutboxEvent(
            school_id=context.school.id,
            event_type=operation,
            schema_version=1,
            occurred_at=occurred_at,
            aggregate_id=session.id,
            idempotency_key=f"{operation}:{key}",
            payload={
                "section_id": str(session.section_id),
                "school_date": session.school_date.isoformat(),
                **event_payload,
            },
        )
        db.add(event)
        process_attendance_event(db, event)
