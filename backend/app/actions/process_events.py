"""Catch up local attendance rules without sending messages or consuming other event types."""

import json

from sqlalchemy import select

from app.actions.service import ATTENDANCE_EVENTS, process_attendance_event
from app.db.models import OutboxEvent, School
from app.db.session import SessionLocal


def main() -> None:
    processed = 0
    with SessionLocal() as db:
        school_ids = list(db.scalars(select(School.id).order_by(School.id)))
    for school_id in school_ids:
        while True:
            with SessionLocal.begin() as db:
                events = list(
                    db.scalars(
                        select(OutboxEvent)
                        .where(
                            OutboxEvent.school_id == school_id,
                            OutboxEvent.status == "PENDING",
                            OutboxEvent.event_type.in_(ATTENDANCE_EVENTS),
                        )
                        .order_by(OutboxEvent.occurred_at, OutboxEvent.event_id)
                        .limit(100)
                    )
                )
                if not events:
                    break
                for event in events:
                    processed += process_attendance_event(db, event)
    print(json.dumps({"processed_attendance_events": processed}))


if __name__ == "__main__":
    main()
