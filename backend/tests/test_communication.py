import os
from concurrent.futures import ThreadPoolExecutor
from datetime import date
from threading import Barrier
from uuid import UUID, uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import event, select
from sqlalchemy.exc import IntegrityError
from test_actions import finalize, setup
from test_attendance import api as api
from test_attendance import create_member, db_session, login

from app.db.models import (
    AuditEntry,
    Guardian,
    MessageApproval,
    MessageDraft,
    MessageRevision,
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


def message_fixture(api, teacher=True):
    client, factory, fixture = setup(api, teacher=teacher)
    finalize(client, fixture, "2026-10-01")
    finalize(client, fixture, "2026-10-02")
    action = client.get("/api/v1/actions").json()["items"][0]
    with db_session(factory) as db:
        guardian = Guardian(
            school_id=fixture["section"].school_id,
            display_name="Synthetic Parent",
            email="parent@example.test",
        )
        db.add(guardian)
        db.flush()
        link = StudentGuardian(
            school_id=guardian.school_id,
            student_id=fixture["sara"].id,
            guardian_id=guardian.id,
            relationship="Parent",
            portal_access=False,
            can_receive_notifications=True,
        )
        db.add(link)
        db.commit()
        fixture["guardian_id"], fixture["link_id"] = guardian.id, link.id
    return client, factory, fixture, action


def create(client, action, fixture):
    response = client.post(
        f"/api/v1/communication/actions/{action['id']}/drafts",
        json={
            "guardian_link_id": str(fixture["link_id"]),
            "recipient_email": "parent@example.test",
            "expected_action_revision": action["revision"],
        },
    )
    assert response.status_code in {200, 201}, response.text
    return response.json()


def approval_payload(draft):
    return {
        "expected_revision": draft["revision"],
        "expected_action_revision": draft["current_action_revision"],
        "recipient_email": draft["recipient_email"],
    }


def edit_payload(draft, **overrides):
    return {
        **approval_payload(draft),
        "guardian_link_id": draft["guardian_link_id"],
        "subject": draft["subject"],
        "body": draft["body"],
        **overrides,
    }


def test_template_is_editable_and_contains_no_internal_notes_or_delivery_work(api):
    client, factory, fixture, action = message_fixture(api)
    workspace = client.get(f"/api/v1/communication/actions/{action['id']}").json()
    assert workspace["can_manage"] is True
    assert workspace["recipients"][0]["email"] == "parent@example.test"
    with db_session(factory) as db:
        event_count = len(list(db.scalars(select(OutboxEvent))))
    draft = create(client, action, fixture)
    assert draft["status"] == "DRAFT" and draft["approval_effective"] is False
    assert "Sara Stone" in draft["body"]
    assert "2026-10-01, 2026-10-02" in draft["body"]
    assert "Private synthetic note" not in str(draft)
    assert create(client, action, fixture)["id"] == draft["id"]
    updated = client.patch(
        f"/api/v1/communication/drafts/{draft['id']}",
        json=edit_payload(draft, body="Please contact the school about attendance."),
    )
    assert updated.status_code == 200
    assert updated.json()["revision"] == 2
    with db_session(factory) as db:
        assert len(list(db.scalars(select(MessageDraft)))) == 1
        assert len(list(db.scalars(select(MessageRevision)))) == 2
        assert list(db.scalars(select(MessageApproval))) == []
        assert len(list(db.scalars(select(OutboxEvent)))) == event_count
        entries = list(
            db.scalars(select(TimelineEntry).where(TimelineEntry.entry_type.like("message.%")))
        )
        assert all(row.visibility == "STAFF" for row in entries)
        assert "parent@example.test" not in str([row.details for row in entries])
    assert client.post(f"/api/v1/communication/drafts/{draft['id']}/send").status_code == 404


def test_approval_binds_saved_revision_and_edit_invalidates_it_without_erasing_history(api):
    client, factory, fixture, action = message_fixture(api)
    draft = create(client, action, fixture)
    path = f"/api/v1/communication/drafts/{draft['id']}"
    approved = client.post(f"{path}/approve", json=approval_payload(draft))
    assert approved.status_code == 200, approved.text
    assert approved.json()["approval_effective"] is True
    assert approved.json()["approved_revision"] == 1
    duplicate = client.post(f"{path}/approve", json=approval_payload(draft))
    assert duplicate.status_code == 200
    assert duplicate.json()["approved_at"] == approved.json()["approved_at"]
    noop = client.patch(path, json=edit_payload(draft))
    assert noop.status_code == 200 and noop.json()["approval_effective"] is True
    revised = client.patch(path, json=edit_payload(draft, subject="Please review attendance"))
    assert revised.status_code == 200
    data = revised.json()
    assert data["revision"] == 2 and data["status"] == "DRAFT"
    assert data["approved_revision"] is None and data["approved_at"] is None
    assert client.post(f"{path}/approve", json=approval_payload(draft)).status_code == 409
    assert (
        client.post(f"{path}/approve", json=approval_payload(data)).json()["approval_effective"]
        is True
    )
    history = client.get(f"{path}/history?limit=1").json()
    assert history["has_more"] is True and history["revisions"][0]["revision"] == 2
    older = client.get(f"{path}/history?limit=1&offset=1").json()
    assert older["has_more"] is False
    assert older["revisions"][0]["subject"] == draft["subject"]
    assert older["revisions"][0]["approved_by_name"] == "Teacher"
    with db_session(factory) as db:
        assert len(list(db.scalars(select(MessageApproval)))) == 2
        assert (
            len(
                list(
                    db.scalars(select(AuditEntry).where(AuditEntry.operation == "message.approved"))
                )
            )
            == 2
        )
        row = db.scalar(select(MessageRevision))
        row.body = "tampered"
        with pytest.raises(ValueError, match="append-only"):
            db.commit()
        db.rollback()
        db.delete(db.scalar(select(MessageApproval)))
        with pytest.raises(ValueError, match="append-only"):
            db.commit()


@pytest.mark.parametrize(
    "field,value",
    [
        ("subject", "  "),
        ("body", "\t \n"),
        ("subject", "Hello\r\nBcc: x@example.test"),
        ("body", "Null\x00byte"),
    ],
)
def test_invalid_content_is_rejected_without_creating_a_revision(api, field, value):
    client, factory, fixture, action = message_fixture(api)
    draft = create(client, action, fixture)
    response = client.patch(
        f"/api/v1/communication/drafts/{draft['id']}", json=edit_payload(draft, **{field: value})
    )
    assert response.status_code == 422
    with db_session(factory) as db:
        assert len(list(db.scalars(select(MessageRevision)))) == 1


def test_attendance_change_requires_review_and_template_refresh(api):
    client, _, fixture, action = message_fixture(api)
    final = finalize(client, fixture, "2026-10-03")
    action = client.get(f"/api/v1/actions/{action['id']}").json()
    draft = create(client, action, fixture)
    path = f"/api/v1/communication/drafts/{draft['id']}"
    assert (
        client.post(f"{path}/approve", json=approval_payload(draft)).json()["approval_effective"]
        is True
    )
    record = next(row for row in final["records"] if row["student_id"] == str(fixture["sara"].id))
    assert (
        client.patch(
            f"/api/v1/attendance/records/{record['record_id']}",
            json={"mark": "EXCUSED", "reason": "Internal correction reason"},
        ).status_code
        == 200
    )
    stale = client.get(path).json()
    assert stale["approval_effective"] is False
    assert "changed" in stale["blocking_reason"]
    assert client.post(f"{path}/approve", json=approval_payload(draft)).status_code == 409
    preview = client.get(
        f"/api/v1/communication/actions/{action['id']}/template?guardian_link_id={fixture['link_id']}"
    )
    assert preview.status_code == 200
    assert "2026-10-03" not in preview.json()["body"]
    assert "Internal correction reason" not in preview.text
    saved = client.patch(path, json=edit_payload(stale, body=preview.json()["body"]))
    assert saved.status_code == 200
    assert saved.json()["revision"] == 2
    assert (
        client.post(f"{path}/approve", json=approval_payload(saved.json())).json()[
            "approval_effective"
        ]
        is True
    )


def test_recipient_permission_and_contact_are_checked_again_at_approval(api):
    client, factory, fixture, action = message_fixture(api)
    draft = create(client, action, fixture)
    path = f"/api/v1/communication/drafts/{draft['id']}"
    assert client.post(f"{path}/approve", json=approval_payload(draft)).status_code == 200
    with db_session(factory) as db:
        db.get(StudentGuardian, fixture["link_id"]).can_receive_notifications = False
        db.commit()
    assert client.get(path).json()["approval_effective"] is False
    assert client.post(f"{path}/approve", json=approval_payload(draft)).status_code == 400
    assert client.get(f"/api/v1/communication/actions/{action['id']}").json()["recipients"] == []
    with db_session(factory) as db:
        db.get(StudentGuardian, fixture["link_id"]).can_receive_notifications = True
        db.get(Guardian, fixture["guardian_id"]).email = "new-parent@example.test"
        db.commit()
    assert client.post(f"{path}/approve", json=approval_payload(draft)).status_code == 409
    saved = client.patch(path, json=edit_payload(draft, recipient_email="new-parent@example.test"))
    assert saved.status_code == 200
    assert saved.json()["revision"] == 2 and saved.json()["approved_revision"] is None
    assert (
        client.post(f"{path}/approve", json=approval_payload(saved.json())).json()[
            "approval_effective"
        ]
        is True
    )
    history = client.get(f"{path}/history").json()["revisions"]
    assert [row["recipient_email"] for row in history] == [
        "new-parent@example.test",
        "parent@example.test",
    ]


@pytest.mark.parametrize(
    "email",
    [
        "not-an-address",
        "bad@@example.test",
        "a@example.test\r\nBcc: other@example.test",
        "a@\t example.test",
        "a@exam\x7fple.test",
    ],
)
def test_malformed_contacts_are_not_eligible_recipients(api, email):
    client, factory, fixture, action = message_fixture(api)
    with db_session(factory) as db:
        db.get(Guardian, fixture["guardian_id"]).email = email
        db.commit()
    response = client.get(f"/api/v1/communication/actions/{action['id']}")
    assert response.status_code == 200
    assert response.json()["recipients"] == []


def test_guardian_other_school_and_unassigned_teacher_cannot_manage_messages(api):
    client, factory, fixture, action = message_fixture(api, teacher=False)
    draft = create(client, action, fixture)
    path = f"/api/v1/communication/drafts/{draft['id']}"
    with db_session(factory) as db:
        school = db.get(School, fixture["section"].school_id)
        create_member(db, school=school, email="guardian@schoolos.local", role="GUARDIAN")
        create_member(db, school=None, email="outsider@schoolos.local", role="ADMIN")
    login(client, "teacher@schoolos.local")
    assert client.get(path).status_code == 200
    assert client.get(f"/api/v1/communication/actions/{action['id']}").json()["can_manage"] is False
    assert client.patch(path, json=edit_payload(draft)).status_code == 403
    assert client.post(f"{path}/approve", json=approval_payload(draft)).status_code == 403
    login(client, "guardian@schoolos.local")
    assert client.get(path).status_code == 403
    assert client.get(f"{path}/history").status_code == 403
    assert client.post(f"{path}/approve", json=approval_payload(draft)).status_code == 403
    login(client, "outsider@schoolos.local")
    assert client.get(path).status_code == 404
    assert client.get(f"{path}/history").status_code == 404
    assert client.post(f"{path}/approve", json=approval_payload(draft)).status_code == 404


def test_recipient_must_belong_to_the_action_student_and_remain_unique(api):
    client, factory, fixture, action = message_fixture(api)
    draft = create(client, action, fixture)
    with db_session(factory) as db:
        second = Guardian(
            school_id=fixture["section"].school_id,
            display_name="Second Parent",
            email="second@example.test",
        )
        db.add(second)
        db.flush()
        noah_link = StudentGuardian(
            school_id=second.school_id,
            student_id=fixture["noah"].id,
            guardian_id=second.id,
            relationship="Parent",
        )
        sara_link = StudentGuardian(
            school_id=second.school_id,
            student_id=fixture["sara"].id,
            guardian_id=second.id,
            relationship="Parent",
        )
        db.add_all([noah_link, sara_link])
        db.commit()
        noah_id, sara_id = noah_link.id, sara_link.id
    payload = {
        "guardian_link_id": str(noah_id),
        "recipient_email": "second@example.test",
        "expected_action_revision": action["revision"],
    }
    path = f"/api/v1/communication/actions/{action['id']}/drafts"
    assert client.post(path, json=payload).status_code == 400
    payload["guardian_link_id"] = str(sara_id)
    assert client.post(path, json=payload).status_code == 201
    assert (
        client.patch(
            f"/api/v1/communication/drafts/{draft['id']}",
            json=edit_payload(
                draft, guardian_link_id=str(sara_id), recipient_email="second@example.test"
            ),
        ).status_code
        == 409
    )
    assert client.get(f"/api/v1/communication/drafts/{draft['id']}").json()["revision"] == 1


def test_closed_action_and_revoked_approver_make_approval_ineffective(api):
    client, factory, fixture, action = message_fixture(api)
    draft = create(client, action, fixture)
    path = f"/api/v1/communication/drafts/{draft['id']}"
    assert client.post(f"{path}/approve", json=approval_payload(draft)).status_code == 200
    with db_session(factory) as db:
        assignment = db.scalar(
            select(TeacherAssignment).where(
                TeacherAssignment.teacher_user_id == fixture["teacher"].id
            )
        )
        assignment.status = "INACTIVE"
        db.commit()
    login(client, "admin@schoolos.local")
    stale = client.get(path).json()
    assert stale["approval_effective"] is False
    saved = client.patch(path, json=edit_payload(stale))
    assert saved.status_code == 200 and saved.json()["revision"] == 2
    assert (
        client.post(f"{path}/approve", json=approval_payload(saved.json())).json()[
            "approval_effective"
        ]
        is True
    )
    assert (
        client.patch(
            f"/api/v1/actions/{action['id']}",
            json={
                "expected_revision": action["revision"],
                "status": "RESOLVED",
                "reason": "Reviewed internally",
            },
        ).status_code
        == 200
    )
    assert client.get(path).json()["approval_effective"] is False
    assert client.post(f"{path}/approve", json=approval_payload(saved.json())).status_code == 409


def test_approval_failure_rolls_back_stamp_audit_and_timeline(api):
    client, factory, fixture, action = message_fixture(api)
    draft = create(client, action, fixture)
    with db_session(factory) as db:
        before = {
            model: len(list(db.scalars(select(model)))) for model in (AuditEntry, TimelineEntry)
        }

    def reject_approval(db, *_):
        if any(isinstance(row, MessageApproval) for row in db.new):
            raise RuntimeError("Simulated approval persistence failure")

    event.listen(factory.class_, "before_flush", reject_approval)
    try:
        with pytest.raises(RuntimeError, match="Simulated approval persistence failure"):
            client.post(
                f"/api/v1/communication/drafts/{draft['id']}/approve", json=approval_payload(draft)
            )
    finally:
        event.remove(factory.class_, "before_flush", reject_approval)
    with db_session(factory) as db:
        assert db.get(MessageDraft, UUID(draft["id"])).approved_revision is None
        assert list(db.scalars(select(MessageApproval))) == []
        for model, count in before.items():
            assert len(list(db.scalars(select(model)))) == count


@pytest.mark.skipif(not os.environ.get("SCHOOLOS_TEST_DATABASE_URL"), reason="Requires PostgreSQL")
@pytest.mark.parametrize("operation", ["approve_twice", "approve_and_edit"])
def test_concurrent_approval_is_revision_bound(api, operation):
    client, factory, fixture, action = message_fixture(api)
    draft = create(client, action, fixture)
    barrier = Barrier(2)
    path = f"/api/v1/communication/drafts/{draft['id']}"

    def change(index):
        with TestClient(app, cookies=client.cookies) as concurrent_client:
            barrier.wait(timeout=10)
            if index == 1 and operation == "approve_and_edit":
                return concurrent_client.patch(
                    path, json=edit_payload(draft, subject="Updated subject")
                ).status_code
            return concurrent_client.post(
                f"{path}/approve", json=approval_payload(draft)
            ).status_code

    with ThreadPoolExecutor(max_workers=2) as executor:
        result = list(executor.map(change, range(2)))
    with db_session(factory) as db:
        approvals = list(db.scalars(select(MessageApproval)))
        stored = db.get(MessageDraft, UUID(draft["id"]))
        if operation == "approve_twice":
            assert result == [200, 200]
            assert len(approvals) == 1 and stored.approved_revision == 1
        else:
            assert result[0] in {200, 409} and result[1] == 200
            assert stored.revision == 2 and stored.approved_revision is None
            assert len(approvals) <= 1


@pytest.mark.skipif(not os.environ.get("SCHOOLOS_TEST_DATABASE_URL"), reason="Requires PostgreSQL")
def test_database_rejects_cross_school_message_parent(api):
    client, factory, fixture, action = message_fixture(api)
    draft = create(client, action, fixture)
    with db_session(factory) as db:
        other, _ = create_member(db, school=None, email="other@schoolos.local", role="ADMIN")
        forged = MessageDraft(
            id=uuid4(),
            school_id=other.id,
            action_id=UUID(action["id"]),
            guardian_link_id=fixture["link_id"],
            recipient_name="Parent",
            recipient_email="parent@example.test",
            subject="Invalid",
            body="Invalid tenant",
            revision=1,
            action_revision=1,
            created_at=db.get(MessageDraft, UUID(draft["id"])).created_at,
            updated_at=db.get(MessageDraft, UUID(draft["id"])).updated_at,
        )
        db.add(forged)
        with pytest.raises(IntegrityError):
            db.flush()
