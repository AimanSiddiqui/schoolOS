import os
from collections.abc import Generator
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from datetime import date
from threading import Barrier
from uuid import UUID, uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event, select
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool
from sqlalchemy.schema import CreateSchema, DropSchema

from app.db.models import (
    AcademicYear,
    AttendanceRecord,
    AttendanceSession,
    AuditEntry,
    Base,
    Enrollment,
    GradeLevel,
    OutboxEvent,
    School,
    SchoolMembership,
    Section,
    Student,
    Subject,
    TeacherAssignment,
    User,
)
from app.db.session import get_db
from app.identity.security import hash_password
from app.main import app


@pytest.fixture()
def api() -> Generator[tuple[TestClient, sessionmaker[Session]]]:
    database_url = os.environ.get("SCHOOLOS_TEST_DATABASE_URL")
    schema = f"schoolos_test_{uuid4().hex}"
    if database_url:
        engine = create_engine(database_url)
        with engine.begin() as connection:
            connection.execute(CreateSchema(schema))
        engine = engine.execution_options(schema_translate_map={None: schema})
    else:
        engine = create_engine(
            "sqlite+pysqlite:///:memory:",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
    testing_session_local = sessionmaker(
        bind=engine,
        autoflush=False,
        autocommit=False,
        expire_on_commit=False,
    )
    Base.metadata.create_all(bind=engine)

    def override_get_db() -> Generator[Session]:
        db = testing_session_local()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db
    try:
        with TestClient(app) as client:
            yield client, testing_session_local
    finally:
        app.dependency_overrides.clear()
        if database_url:
            with engine.begin() as connection:
                connection.execute(DropSchema(schema, cascade=True))
        engine.dispose()


@contextmanager
def db_session(session_factory: sessionmaker[Session]) -> Generator[Session]:
    db = session_factory()
    try:
        yield db
    finally:
        db.close()


def create_member(
    db: Session,
    *,
    school: School | None,
    email: str,
    role: str,
) -> tuple[School, User]:
    if school is None:
        school = School(
            name="Attendance School",
            timezone="Europe/Berlin",
            language="en",
            working_days={"days": ["MON", "TUE", "WED", "THU", "FRI"]},
        )
        db.add(school)
    user = User(
        email=email,
        display_name=email.split("@")[0].title(),
        password_hash=hash_password("schoolos-password"),
    )
    db.add_all([user, SchoolMembership(school=school, user=user, role=role)])
    db.commit()
    return school, user


def login(client: TestClient, email: str) -> None:
    response = client.post(
        "/api/v1/auth/login",
        json={"email": email, "password": "schoolos-password"},
    )
    assert response.status_code == 200


def create_attendance_fixture(db: Session) -> dict[str, object]:
    school, admin = create_member(db, school=None, email="admin@schoolos.local", role="ADMIN")
    _, teacher = create_member(db, school=school, email="teacher@schoolos.local", role="TEACHER")
    year = AcademicYear(
        school_id=school.id,
        name="2026-2027",
        starts_on=date(2026, 9, 1),
        ends_on=date(2027, 7, 15),
    )
    level = GradeLevel(school_id=school.id, label="Grade 1", sort_order=1)
    subject = Subject(school_id=school.id, name="Homeroom")
    db.add_all([year, level, subject])
    db.flush()
    section = Section(
        school_id=school.id,
        academic_year_id=year.id,
        grade_level_id=level.id,
        label="1A",
    )
    other_section = Section(
        school_id=school.id,
        academic_year_id=year.id,
        grade_level_id=level.id,
        label="1B",
    )
    db.add_all([section, other_section])
    db.flush()
    db.add(
        TeacherAssignment(
            school_id=school.id,
            teacher_user_id=teacher.id,
            section_id=section.id,
            subject_id=subject.id,
        )
    )
    sara = Student(
        school_id=school.id,
        student_number="S-001",
        given_name="Sara",
        family_name="Stone",
    )
    noah = Student(
        school_id=school.id,
        student_number="S-002",
        given_name="Noah",
        family_name="North",
    )
    db.add_all([sara, noah])
    db.flush()
    for student in [sara, noah]:
        db.add(
            Enrollment(
                school_id=school.id,
                student_id=student.id,
                section_id=section.id,
                starts_on=date(2026, 9, 1),
            )
        )
    db.commit()
    return {
        "admin": admin,
        "teacher": teacher,
        "section": section,
        "other_section": other_section,
        "sara": sara,
        "noah": noah,
    }


def test_admin_saves_finalizes_and_corrects_attendance(
    api: tuple[TestClient, sessionmaker[Session]],
) -> None:
    client, session_factory = api
    with db_session(session_factory) as db:
        fixture = create_attendance_fixture(db)
        section = fixture["section"]
        sara = fixture["sara"]
        noah = fixture["noah"]

    login(client, "admin@schoolos.local")

    summaries = client.get("/api/v1/attendance/sections?school_date=2026-10-08")
    assert summaries.status_code == 200
    assert summaries.json()[0]["status"] == "NOT_STARTED"
    assert summaries.json()[0]["total_students"] == 2

    roster = client.get(f"/api/v1/attendance/sections/{section.id}?school_date=2026-10-08")
    assert roster.status_code == 200
    assert roster.json()["status"] == "DRAFT"
    assert [row["student_number"] for row in roster.json()["records"]] == ["S-002", "S-001"]

    early_finalize = client.post(
        f"/api/v1/attendance/sections/{section.id}/finalize?school_date=2026-10-08"
    )
    assert early_finalize.status_code == 422

    draft = client.post(
        f"/api/v1/attendance/sections/{section.id}/draft?school_date=2026-10-08",
        json={
            "records": [
                {"student_id": str(sara.id), "mark": "ABSENT", "note": "No call"},
                {"student_id": str(noah.id), "mark": "PRESENT"},
            ]
        },
    )
    assert draft.status_code == 200
    assert draft.json()["marked_count"] == 2
    assert draft.json()["absent_count"] == 1

    final = client.post(f"/api/v1/attendance/sections/{section.id}/finalize?school_date=2026-10-08")
    assert final.status_code == 200
    assert final.json()["status"] == "FINAL"

    duplicate_final = client.post(
        f"/api/v1/attendance/sections/{section.id}/finalize?school_date=2026-10-08"
    )
    assert duplicate_final.status_code == 200
    assert duplicate_final.json()["status"] == "FINAL"

    absent_record = next(row for row in final.json()["records"] if row["mark"] == "ABSENT")
    correction = client.patch(
        f"/api/v1/attendance/records/{absent_record['record_id']}",
        json={"mark": "EXCUSED", "note": "Doctor note", "reason": "Guardian provided note"},
    )
    assert correction.status_code == 200
    assert correction.json()["absent_count"] == 0
    assert correction.json()["excused_count"] == 1

    repeated = client.patch(
        f"/api/v1/attendance/records/{absent_record['record_id']}",
        json={"mark": "EXCUSED", "note": "Doctor note", "reason": "Guardian provided note"},
    )
    assert repeated.status_code == 200
    history = client.get(
        f"/api/v1/attendance/sections/{section.id}/history?school_date=2026-10-08"
    ).json()
    assert [entry["operation"] for entry in history["entries"]] == [
        "attendance.corrected",
        "attendance.finalized",
        "attendance.draft_saved",
    ]
    assert history["entries"][0]["actor_name"] == "Admin"
    assert history["entries"][0]["changes"] == {
        "record_id": absent_record["record_id"],
        "student_id": str(sara.id),
        "before_mark": "ABSENT",
        "after_mark": "EXCUSED",
        "note_changed": True,
        "reason": "Guardian provided note",
    }
    assert "No call" not in str(history)
    assert "Doctor note" not in str(history)
    with db_session(session_factory) as db:
        events = list(db.scalars(select(OutboxEvent).order_by(OutboxEvent.occurred_at)))
        assert [event.event_type for event in events] == [
            "attendance.finalized",
            "attendance.corrected",
        ]
        assert all(event.school_id == section.school_id for event in events)
        assert all(event.aggregate_id == UUID(final.json()["session_id"]) for event in events)
        assert all(event.schema_version == 1 and event.status == "PROCESSED" for event in events)
        assert len({event.event_id for event in events}) == 2
        assert events[0].payload["section_id"] == str(section.id)
        assert events[0].payload["school_date"] == "2026-10-08"
        assert len(events[0].payload["records"]) == 2
        assert {row["mark"] for row in events[0].payload["records"]} == {"ABSENT", "PRESENT"}
        assert "note" not in str([event.payload for event in events])
        assert "reason" not in str([event.payload for event in events])


def test_teacher_can_only_record_assigned_sections(
    api: tuple[TestClient, sessionmaker[Session]],
) -> None:
    client, session_factory = api
    with db_session(session_factory) as db:
        fixture = create_attendance_fixture(db)
        section = fixture["section"]
        other_section = fixture["other_section"]
        sara = fixture["sara"]

    login(client, "teacher@schoolos.local")

    summaries = client.get("/api/v1/attendance/sections?school_date=2026-10-08")
    assert summaries.status_code == 200
    assert [summary["section_label"] for summary in summaries.json()] == ["1A"]

    assigned = client.post(
        f"/api/v1/attendance/sections/{section.id}/draft?school_date=2026-10-08",
        json={"records": [{"student_id": str(sara.id), "mark": "PRESENT"}]},
    )
    assert assigned.status_code == 200

    unassigned = client.get(
        f"/api/v1/attendance/sections/{other_section.id}?school_date=2026-10-08"
    )
    assert unassigned.status_code == 404


def prepare_finalizable(client: TestClient, factory: sessionmaker[Session]) -> tuple[str, dict]:
    with db_session(factory) as db:
        fixture = create_attendance_fixture(db)
    login(client, "admin@schoolos.local")
    path = f"/api/v1/attendance/sections/{fixture['section'].id}"
    response = client.post(
        f"{path}/draft?school_date=2026-10-08",
        json={
            "records": [
                {"student_id": str(fixture[name].id), "mark": "PRESENT"}
                for name in ("sara", "noah")
            ]
        },
    )
    assert response.status_code == 200
    return path, response.json()


def test_draft_noops_and_missing_marks_do_not_emit_events(api) -> None:
    client, factory = api
    path, draft = prepare_finalizable(client, factory)
    payload = {
        "records": [
            {"student_id": row["student_id"], "mark": row["mark"]} for row in draft["records"]
        ]
    }
    assert client.post(f"{path}/draft?school_date=2026-10-08", json=payload).status_code == 200
    payload["records"][0]["mark"] = None
    assert client.post(f"{path}/draft?school_date=2026-10-08", json=payload).status_code == 200
    assert client.post(f"{path}/finalize?school_date=2026-10-08").status_code == 422
    with db_session(factory) as db:
        assert list(db.scalars(select(OutboxEvent))) == []
        assert len(list(db.scalars(select(AuditEntry)))) == 2
        assert db.scalar(select(AttendanceSession)).status == "DRAFT"


def test_event_failure_rolls_back_finalization_and_audit(api) -> None:
    client, factory = api
    path, _ = prepare_finalizable(client, factory)

    def reject_event(db, *_):
        if any(isinstance(row, OutboxEvent) for row in db.new):
            raise RuntimeError("Simulated event storage failure")

    event.listen(factory.class_, "before_flush", reject_event)
    try:
        with pytest.raises(RuntimeError, match="Simulated event storage failure"):
            client.post(f"{path}/finalize?school_date=2026-10-08")
    finally:
        event.remove(factory.class_, "before_flush", reject_event)
    with db_session(factory) as db:
        session = db.scalar(select(AttendanceSession))
        assert session.status == "DRAFT"
        assert session.finalized_at is None
        assert list(db.scalars(select(OutboxEvent))) == []
        assert [row.operation for row in db.scalars(select(AuditEntry))] == [
            "attendance.draft_saved"
        ]
    assert client.post(f"{path}/finalize?school_date=2026-10-08").status_code == 200


def test_correction_history_retains_every_transition_and_paginates(api) -> None:
    client, factory = api
    path, draft = prepare_finalizable(client, factory)
    client.post(f"{path}/finalize?school_date=2026-10-08")
    record_id = draft["records"][0]["record_id"]
    for mark, reason in [("ABSENT", "Initial review"), ("EXCUSED", "Guardian confirmed")]:
        assert (
            client.patch(
                f"/api/v1/attendance/records/{record_id}",
                json={"mark": mark, "reason": reason},
            ).status_code
            == 200
        )
    page1 = client.get(f"{path}/history?school_date=2026-10-08&limit=2").json()
    assert page1["has_more"] is True
    assert [row["changes"]["before_mark"] for row in page1["entries"]] == ["ABSENT", "PRESENT"]
    page2 = client.get(f"{path}/history?school_date=2026-10-08&limit=2&offset=2").json()
    assert page2["has_more"] is False
    assert [row["operation"] for row in page2["entries"]] == [
        "attendance.finalized",
        "attendance.draft_saved",
    ]
    assert client.get(f"{path}/history?limit=101").status_code == 422
    assert client.get(f"{path}/history?offset=-1").status_code == 422


def test_event_failure_rolls_back_correction_and_history(api) -> None:
    client, factory = api
    path, draft = prepare_finalizable(client, factory)
    client.post(f"{path}/finalize?school_date=2026-10-08")
    record_id = UUID(draft["records"][0]["record_id"])

    def reject_event(db, *_):
        if any(isinstance(row, OutboxEvent) for row in db.new):
            raise RuntimeError("Simulated correction storage failure")

    event.listen(factory.class_, "before_flush", reject_event)
    try:
        with pytest.raises(RuntimeError, match="Simulated correction storage failure"):
            client.patch(
                f"/api/v1/attendance/records/{record_id}",
                json={"mark": "ABSENT", "reason": "Office review"},
            )
    finally:
        event.remove(factory.class_, "before_flush", reject_event)
    with db_session(factory) as db:
        record = db.get(AttendanceRecord, record_id)
        assert record.mark == "PRESENT"
        assert record.corrected_at is None
        assert len(list(db.scalars(select(OutboxEvent)))) == 1
        assert len(list(db.scalars(select(AuditEntry)))) == 2


def test_history_is_scoped_to_school_role_and_teacher_assignment(api) -> None:
    client, factory = api
    path, _ = prepare_finalizable(client, factory)
    with db_session(factory) as db:
        school = db.scalar(select(School))
        create_member(db, school=school, email="guardian@schoolos.local", role="GUARDIAN")
        create_member(db, school=None, email="other@schoolos.local", role="ADMIN")
        other_section = db.scalar(select(Section).where(Section.label == "1B"))
        assignment = db.scalar(select(TeacherAssignment))
        assignment_id = assignment.id
    login(client, "teacher@schoolos.local")
    assert client.get(f"{path}/history?school_date=2026-10-08").status_code == 200
    assert client.get(f"/api/v1/attendance/sections/{other_section.id}/history").status_code == 404
    with db_session(factory) as db:
        db.get(TeacherAssignment, assignment_id).status = "INACTIVE"
        db.commit()
    assert client.get(f"{path}/history").status_code == 404
    login(client, "guardian@schoolos.local")
    assert client.get(f"{path}/history").status_code == 403
    login(client, "other@schoolos.local")
    assert client.get(f"{path}/history").status_code == 404


def test_audit_is_append_only_and_invalid_writes_leave_no_history(api) -> None:
    client, factory = api
    path, draft = prepare_finalizable(client, factory)
    item = {"student_id": draft["records"][0]["student_id"], "mark": "ABSENT"}
    assert (
        client.post(
            f"{path}/draft?school_date=2026-10-08",
            json={"records": [item, item]},
        ).status_code
        == 422
    )
    assert (
        client.post(
            f"{path}/draft?school_date=2026-10-08",
            json={"records": [item, {"student_id": str(uuid4()), "mark": "ABSENT"}]},
        ).status_code
        == 400
    )
    with db_session(factory) as db:
        assert db.get(AttendanceRecord, UUID(draft["records"][0]["record_id"])).mark == "PRESENT"
        assert len(list(db.scalars(select(AuditEntry)))) == 1
        entry = db.scalar(select(AuditEntry))
        entry.operation = "tampered"
        with pytest.raises(ValueError, match="append-only"):
            db.commit()
        db.rollback()
        db.delete(db.scalar(select(AuditEntry)))
        with pytest.raises(ValueError, match="append-only"):
            db.commit()
    client.post(f"{path}/finalize?school_date=2026-10-08")
    assert (
        client.patch(
            f"/api/v1/attendance/records/{draft['records'][0]['record_id']}",
            json={"mark": "ABSENT", "reason": "   "},
        ).status_code
        == 422
    )


@pytest.mark.skipif(not os.environ.get("SCHOOLOS_TEST_DATABASE_URL"), reason="Requires PostgreSQL")
@pytest.mark.parametrize("operation", ["finalize", "draft", "correct"])
def test_concurrent_duplicate_requests_record_one_transition(api, operation: str) -> None:
    client, factory = api
    path, draft = prepare_finalizable(client, factory)
    method, payload = "POST", None
    if operation == "correct":
        assert client.post(f"{path}/finalize?school_date=2026-10-08").status_code == 200
        method = "PATCH"
        target = f"/api/v1/attendance/records/{draft['records'][0]['record_id']}"
        payload = {"mark": "ABSENT", "reason": "Office review"}
    elif operation == "draft":
        target = f"{path}/draft?school_date=2026-10-09"
        payload = {
            "records": [
                {"student_id": row["student_id"], "mark": "PRESENT"} for row in draft["records"]
            ]
        }
    else:
        target = f"{path}/finalize?school_date=2026-10-08"
    with db_session(factory) as db:
        audit_count = len(list(db.scalars(select(AuditEntry))))
        event_count = len(list(db.scalars(select(OutboxEvent))))
    barrier = Barrier(2)

    def mutate():
        with TestClient(app, cookies=client.cookies) as concurrent_client:
            barrier.wait(timeout=10)
            return concurrent_client.request(method, target, json=payload).status_code

    with ThreadPoolExecutor(max_workers=2) as executor:
        results = list(executor.map(lambda _: mutate(), range(2)))
    assert results == [200, 200]
    with db_session(factory) as db:
        assert len(list(db.scalars(select(OutboxEvent)))) == event_count + (operation != "draft")
        assert len(list(db.scalars(select(AuditEntry)))) == audit_count + 1
        assert len(list(db.scalars(select(AttendanceSession)))) == (
            2 if operation == "draft" else 1
        )


def test_history_read_does_not_create_an_empty_register(api) -> None:
    client, factory = api
    with db_session(factory) as db:
        fixture = create_attendance_fixture(db)
        section_id = fixture["section"].id
    login(client, "admin@schoolos.local")
    response = client.get(
        f"/api/v1/attendance/sections/{section_id}/history?school_date=2026-10-08"
    )
    assert response.status_code == 200
    assert response.json() == {"entries": [], "has_more": False}
    with db_session(factory) as db:
        assert list(db.scalars(select(AttendanceSession))) == []
        assert list(db.scalars(select(AuditEntry))) == []
