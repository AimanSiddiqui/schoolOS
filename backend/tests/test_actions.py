import os
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, date, datetime
from threading import Barrier

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import event, select
from test_attendance import api as api
from test_attendance import create_attendance_fixture, create_member, db_session, login

from app.actions.service import process_attendance_event
from app.db.models import (
    ActionItem,
    AttendanceRecord,
    AttendanceSession,
    AuditEntry,
    Enrollment,
    Guardian,
    OutboxEvent,
    School,
    StudentGuardian,
    TeacherAssignment,
    TimelineEntry,
)
from app.main import app


@pytest.fixture(autouse=True)
def fixed_school_today(monkeypatch):
    monkeypatch.setattr("app.actions.access.school_date", lambda _: date(2026, 10, 8))


def setup(api, teacher=False):
    client, factory = api
    with db_session(factory) as db:
        fixture = create_attendance_fixture(db)
    login(client, "teacher@schoolos.local" if teacher else "admin@schoolos.local")
    return client, factory, fixture


def draft(client, fixture, day, mark="ABSENT", section=None):
    section = section or fixture["section"]
    path = f"/api/v1/attendance/sections/{section.id}"
    response = client.post(
        f"{path}/draft?school_date={day}",
        json={
            "records": [
                {
                    "student_id": str(fixture["sara"].id),
                    "mark": mark,
                    "note": "Private synthetic note",
                },
                {"student_id": str(fixture["noah"].id), "mark": "PRESENT"},
            ]
        },
    )
    assert response.status_code == 200, response.text
    return path, response.json()


def finalize(client, fixture, day, mark="ABSENT"):
    path, _ = draft(client, fixture, day, mark)
    response = client.post(f"{path}/finalize?school_date={day}")
    assert response.status_code == 200, response.text
    return response.json()


def inbox(client, query=""):
    response = client.get(f"/api/v1/actions{query}")
    assert response.status_code == 200, response.text
    return response.json()


def test_two_absences_create_one_owned_action_and_idempotent_timeline(api):
    client, factory, fixture = setup(api, teacher=True)
    finalize(client, fixture, "2026-10-01")
    assert inbox(client)["items"] == []
    finalize(client, fixture, "2026-10-07")
    page = inbox(client)
    assert page["total"] == 1
    action = page["items"][0]
    assert action["student_id"] == str(fixture["sara"].id)
    assert action["assignee_user_id"] == str(fixture["teacher"].id)
    assert [row["school_date"] for row in action["evidence"]] == ["2026-10-01", "2026-10-07"]
    assert action["qualifies"] is True
    with db_session(factory) as db:
        before = len(list(db.scalars(select(TimelineEntry))))
        for row in db.scalars(select(OutboxEvent)):
            assert process_attendance_event(db, row) is False
        db.commit()
        assert len(list(db.scalars(select(ActionItem)))) == 1
        assert len(list(db.scalars(select(TimelineEntry)))) == before
    assert inbox(client, "?owner=ME")["total"] == 1
    assert inbox(client, "?q=Stone")["total"] == 1
    assert inbox(client, "?q=Noah")["total"] == 0


@pytest.mark.parametrize(
    "second_day,mark,expected",
    [
        ("2026-10-07", "ABSENT", 1),
        ("2026-10-08", "ABSENT", 0),
        ("2026-10-07", "EXCUSED", 0),
        ("2026-10-07", "LATE", 0),
        ("2026-10-07", "PRESENT", 0),
    ],
)
def test_inclusive_window_and_only_unexcused_absences_count(api, second_day, mark, expected):
    client, _, fixture = setup(api)
    finalize(client, fixture, "2026-10-01")
    finalize(client, fixture, second_day, mark)
    assert inbox(client)["total"] == expected


def test_draft_absence_does_not_trigger_rules_and_duplicate_dates_count_once(api):
    client, factory, fixture = setup(api)
    finalize(client, fixture, "2026-10-01")
    draft(client, fixture, "2026-10-02")
    assert inbox(client)["total"] == 0
    with db_session(factory) as db:
        for name in ("sara", "noah"):
            db.add(
                Enrollment(
                    school_id=fixture["section"].school_id,
                    student_id=fixture[name].id,
                    section_id=fixture["other_section"].id,
                    starts_on=date(2026, 9, 1),
                )
            )
        db.commit()
    path, _ = draft(client, fixture, "2026-10-01", section=fixture["other_section"])
    assert client.post(f"{path}/finalize?school_date=2026-10-01").status_code == 200
    assert inbox(client)["total"] == 0


def test_correction_recomputes_evidence_without_erasing_action_or_timeline(api):
    client, _, fixture = setup(api)
    finalize(client, fixture, "2026-10-01")
    second = finalize(client, fixture, "2026-10-02")
    action = inbox(client)["items"][0]
    record = next(row for row in second["records"] if row["student_id"] == str(fixture["sara"].id))
    response = client.patch(
        f"/api/v1/attendance/records/{record['record_id']}",
        json={"mark": "EXCUSED", "reason": "Private office correction"},
    )
    assert response.status_code == 200
    revised = inbox(client)["items"][0]
    assert revised["id"] == action["id"]
    assert revised["revision"] == action["revision"] + 1
    assert revised["qualifies"] is False and revised["status"] == "OPEN"
    assert len(revised["evidence"]) == 1
    timeline = client.get(f"/api/v1/timeline/students/{fixture['sara'].id}").json()["entries"]
    evidence_entry = next(row for row in timeline if row["entry_type"] == "action.evidence_updated")
    assert len(evidence_entry["details"]["before"]["evidence"]) == 2
    assert len(evidence_entry["details"]["after"]["evidence"]) == 1
    assert "Private synthetic note" not in str(timeline)
    assert any(row["summary"] == "2026-10-02: absent" for row in timeline)
    assert any(row["summary"] == "2026-10-02: excused" for row in timeline)
    assert (
        client.patch(
            f"/api/v1/actions/{action['id']}",
            json={
                "expected_revision": action["revision"],
                "status": "RESOLVED",
                "reason": "Reviewed",
            },
        ).status_code
        == 409
    )


def test_closure_requires_reason_and_new_evidence_creates_new_action(api):
    client, _, fixture = setup(api, teacher=True)
    finalize(client, fixture, "2026-10-01")
    finalize(client, fixture, "2026-10-02")
    action = inbox(client)["items"][0]
    path = f"/api/v1/actions/{action['id']}"
    assert (
        client.patch(
            path, json={"expected_revision": 1, "status": "RESOLVED", "reason": "  "}
        ).status_code
        == 422
    )
    progressed = client.patch(path, json={"expected_revision": 1, "status": "IN_PROGRESS"})
    assert progressed.status_code == 200
    closed = client.patch(
        path,
        json={"expected_revision": 2, "status": "RESOLVED", "reason": "Reviewed with guardian"},
    )
    assert closed.status_code == 200
    assert closed.json()["closed_at"] is not None
    assert inbox(client)["total"] == 0
    assert (
        client.post(
            f"/api/v1/attendance/sections/{fixture['section'].id}/finalize?school_date=2026-10-02"
        ).status_code
        == 200
    )
    assert inbox(client)["total"] == 0
    assert client.patch(path, json={"expected_revision": 3, "status": "OPEN"}).status_code == 409
    finalize(client, fixture, "2026-10-03")
    active = inbox(client)["items"][0]
    assert active["id"] != action["id"]
    assert inbox(client, "?status_filter=CLOSED")["total"] == 1
    assert inbox(client, "?status_filter=ALL&limit=1")["has_more"] is True
    assert inbox(client, "?status_filter=ALL&limit=1&offset=1")["has_more"] is False


def test_teacher_can_claim_but_cannot_modify_another_teachers_action(api):
    client, factory, fixture = setup(api)
    finalize(client, fixture, "2026-10-01")
    finalize(client, fixture, "2026-10-02")
    action = inbox(client)["items"][0]
    assert action["assignee_user_id"] is None
    login(client, "teacher@schoolos.local")
    path = f"/api/v1/actions/{action['id']}"
    assert (
        client.patch(path, json={"expected_revision": 1, "status": "IN_PROGRESS"}).status_code
        == 403
    )
    claimed = client.patch(
        path,
        json={
            "expected_revision": 1,
            "assignee_user_id": str(fixture["teacher"].id),
            "status": "IN_PROGRESS",
        },
    )
    assert claimed.status_code == 200
    with db_session(factory) as db:
        school = db.get(School, fixture["section"].school_id)
        _, peer = create_member(db, school=school, email="peer@schoolos.local", role="TEACHER")
        db.add(
            TeacherAssignment(
                school_id=school.id, teacher_user_id=peer.id, section_id=fixture["section"].id
            )
        )
        db.commit()
    login(client, "peer@schoolos.local")
    assert client.get(path).status_code == 200
    assert (
        client.patch(
            path, json={"expected_revision": 2, "status": "RESOLVED", "reason": "Reviewed"}
        ).status_code
        == 403
    )
    login(client, "admin@schoolos.local")
    assert (
        client.patch(
            path, json={"expected_revision": 2, "assignee_user_id": str(fixture["admin"].id)}
        ).status_code
        == 400
    )
    assert (
        client.patch(
            path, json={"expected_revision": 2, "assignee_user_id": str(peer.id)}
        ).status_code
        == 200
    )


def test_policy_settings_are_admin_only_and_recompute_existing_evidence(api):
    client, _, fixture = setup(api)
    finalize(client, fixture, "2026-10-01")
    finalize(client, fixture, "2026-10-02")
    response = client.put(
        "/api/v1/actions/policy", json={"enabled": True, "threshold": 3, "window_days": 7}
    )
    assert response.status_code == 200
    assert inbox(client)["items"][0]["qualifies"] is False
    finalize(client, fixture, "2026-10-03")
    assert inbox(client)["items"][0]["qualifies"] is True
    assert (
        client.put(
            "/api/v1/actions/policy", json={"enabled": False, "threshold": 3, "window_days": 7}
        ).status_code
        == 200
    )
    assert inbox(client)["items"][0]["qualifies"] is False
    assert (
        client.put("/api/v1/actions/policy", json={"threshold": 8, "window_days": 7}).status_code
        == 422
    )
    login(client, "teacher@schoolos.local")
    assert client.get("/api/v1/actions/policy").json()["enabled"] is False
    assert (
        client.put("/api/v1/actions/policy", json={"threshold": 2, "window_days": 7}).status_code
        == 403
    )


def test_cross_school_teacher_and_guardian_isolation(api):
    client, factory, fixture = setup(api)
    finalize(client, fixture, "2026-10-01")
    finalize(client, fixture, "2026-10-02")
    action = inbox(client)["items"][0]
    action_path = f"/api/v1/actions/{action['id']}"
    timeline_path = f"/api/v1/timeline/students/{fixture['sara'].id}"
    client.patch(
        action_path,
        json={"expected_revision": 1, "status": "DISMISSED", "reason": "Internal synthetic review"},
    )
    with db_session(factory) as db:
        school = db.get(School, fixture["section"].school_id)
        _, guardian_user = create_member(
            db, school=school, email="guardian@schoolos.local", role="GUARDIAN"
        )
        guardian = Guardian(
            school_id=school.id,
            user_id=guardian_user.id,
            display_name="Demo Guardian",
            email="guardian@schoolos.local",
        )
        db.add(guardian)
        db.flush()
        link = StudentGuardian(
            school_id=school.id,
            student_id=fixture["sara"].id,
            guardian_id=guardian.id,
            relationship="Parent",
            portal_access=True,
        )
        db.add(link)
        db.commit()
        link_id = link.id
        create_member(db, school=school, email="unassigned@schoolos.local", role="TEACHER")
        create_member(db, school=None, email="other@schoolos.local", role="ADMIN")
    login(client, "guardian@schoolos.local")
    assert client.get("/api/v1/actions").status_code == 403
    assert client.get(action_path).status_code == 403
    timeline = client.get(timeline_path)
    assert timeline.status_code == 200
    assert all(row["visibility"] == "GUARDIAN" for row in timeline.json()["entries"])
    assert "Internal synthetic review" not in timeline.text
    assert "Private synthetic note" not in timeline.text
    assert client.get(f"/api/v1/timeline/students/{fixture['noah'].id}").status_code == 403
    with db_session(factory) as db:
        db.get(StudentGuardian, link_id).portal_access = False
        db.commit()
    assert client.get(timeline_path).status_code == 403
    login(client, "unassigned@schoolos.local")
    assert inbox(client)["total"] == 0
    assert client.get(action_path).status_code == 404
    assert client.get(timeline_path).status_code == 404
    login(client, "other@schoolos.local")
    assert inbox(client)["total"] == 0
    assert client.get(action_path).status_code == 404
    assert client.get(timeline_path).status_code == 404


def test_rule_failure_rolls_back_attendance_event_action_and_timeline(api):
    client, factory, fixture = setup(api)
    finalize(client, fixture, "2026-10-01")
    path, _ = draft(client, fixture, "2026-10-02")
    with db_session(factory) as db:
        before = {
            model: len(list(db.scalars(select(model))))
            for model in (OutboxEvent, TimelineEntry, AuditEntry)
        }

    def reject_action(db, *_):
        if any(isinstance(row, ActionItem) for row in db.new):
            raise RuntimeError("Simulated rule persistence failure")

    event.listen(factory.class_, "before_flush", reject_action)
    try:
        with pytest.raises(RuntimeError, match="Simulated rule persistence failure"):
            client.post(f"{path}/finalize?school_date=2026-10-02")
    finally:
        event.remove(factory.class_, "before_flush", reject_action)
    with db_session(factory) as db:
        assert list(db.scalars(select(ActionItem))) == []
        for model, count in before.items():
            assert len(list(db.scalars(select(model)))) == count
        assert (
            db.scalar(
                select(AttendanceSession).where(AttendanceSession.school_date == date(2026, 10, 2))
            ).status
            == "DRAFT"
        )


def test_legacy_queued_event_does_not_invent_historical_marks(api):
    _, factory, fixture = setup(api)
    with db_session(factory) as db:
        session = AttendanceSession(
            school_id=fixture["section"].school_id,
            section_id=fixture["section"].id,
            school_date=date(2026, 10, 1),
            status="FINAL",
        )
        db.add(session)
        db.flush()
        db.add(
            AttendanceRecord(
                school_id=session.school_id,
                session_id=session.id,
                student_id=fixture["sara"].id,
                mark="ABSENT",
            )
        )
        queued = OutboxEvent(
            school_id=session.school_id,
            aggregate_id=session.id,
            event_type="attendance.finalized",
            schema_version=1,
            occurred_at=datetime.now(UTC),
            idempotency_key=f"attendance.finalized:{session.id}",
            payload={"section_id": str(session.section_id), "school_date": "2026-10-01"},
        )
        db.add(queued)
        assert process_attendance_event(db, queued) is True
        db.commit()
        entry = db.scalar(select(TimelineEntry))
        assert entry.details == {"school_date": "2026-10-01"}
        assert "absent" not in entry.summary
        assert process_attendance_event(db, queued) is False
        db.commit()
        assert len(list(db.scalars(select(TimelineEntry)))) == 1


@pytest.mark.skipif(not os.environ.get("SCHOOLOS_TEST_DATABASE_URL"), reason="Requires PostgreSQL")
def test_concurrent_finalizations_create_one_action(api):
    client, factory, fixture = setup(api)
    finalize(client, fixture, "2026-10-01")
    path, _ = draft(client, fixture, "2026-10-02")
    draft(client, fixture, "2026-10-03")
    barrier = Barrier(2)

    def finish(day):
        with TestClient(app, cookies=client.cookies) as concurrent_client:
            barrier.wait(timeout=10)
            return concurrent_client.post(f"{path}/finalize?school_date={day}").status_code

    with ThreadPoolExecutor(max_workers=2) as executor:
        assert list(executor.map(finish, ["2026-10-02", "2026-10-03"])) == [200, 200]
    with db_session(factory) as db:
        actions = list(db.scalars(select(ActionItem)))
        assert len(actions) == 1
        assert len(actions[0].evidence) == 3
