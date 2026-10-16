from uuid import uuid4

import pytest
from sqlalchemy import select
from test_attendance import api as api
from test_attendance import create_attendance_fixture, db_session

from app.db.models import SchoolMembership, User
from app.identity.security import hash_password, verify_password
from app.seed import ensure_demo_teacher


def test_existing_demo_teacher_is_idempotent_and_not_reset(api, monkeypatch):
    _, factory = api
    monkeypatch.setattr("app.seed.SessionLocal", factory)
    with db_session(factory) as db:
        fixture = create_attendance_fixture(db)
        school_id = fixture["section"].school_id
        teacher = db.get(User, fixture["teacher"].id)
        teacher.password_hash = hash_password("schoolos-teacher-demo")
        db.commit()
        original_hash = teacher.password_hash
    ensure_demo_teacher(school_id)
    ensure_demo_teacher(school_id)
    with db_session(factory) as db:
        assert db.get(User, fixture["teacher"].id).password_hash == original_hash
        assert len(list(db.scalars(select(SchoolMembership)))) == 2
    with pytest.raises(ValueError, match="does not exist"):
        ensure_demo_teacher(uuid4())


def test_demo_seed_creates_teacher_but_refuses_to_change_existing_identity(api, monkeypatch):
    _, factory = api
    monkeypatch.setattr("app.seed.SessionLocal", factory)
    with db_session(factory) as db:
        fixture = create_attendance_fixture(db)
        school_id = fixture["section"].school_id
        teacher = db.get(User, fixture["teacher"].id)
        teacher.email = "existing-teacher@schoolos.local"
        db.commit()
    ensure_demo_teacher(school_id)
    with db_session(factory) as db:
        created = db.scalar(select(User).where(User.email == "teacher@schoolos.local"))
        assert verify_password("schoolos-teacher-demo", created.password_hash)
        created.password_hash = hash_password("different-existing-password")
        db.commit()
    with pytest.raises(ValueError, match="synthetic demo account"):
        ensure_demo_teacher(school_id)
