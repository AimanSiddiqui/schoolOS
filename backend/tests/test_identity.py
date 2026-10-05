import uuid
from collections.abc import Generator

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.db.models import Base, School, SchoolMembership, User
from app.db.session import get_db
from app.identity.security import hash_password
from app.main import app


@pytest.fixture()
def client() -> Generator[TestClient]:
    engine = create_engine(
        "sqlite+pysqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    TestingSessionLocal = sessionmaker(
        bind=engine,
        autoflush=False,
        autocommit=False,
        expire_on_commit=False,
    )
    Base.metadata.create_all(bind=engine)

    def override_get_db() -> Generator[Session]:
        db = TestingSessionLocal()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()


def create_school_user_membership(
    db: Session,
    *,
    school_name: str,
    email: str,
    password: str,
    role: str = "ADMIN",
) -> tuple[School, User]:
    school = School(
        name=school_name,
        timezone="Europe/Berlin",
        language="en",
        working_days={"days": ["MON", "TUE", "WED", "THU", "FRI"]},
    )
    user = User(
        email=email,
        display_name=email.split("@")[0].title(),
        password_hash=hash_password(password),
    )
    db.add_all([school, user, SchoolMembership(school=school, user=user, role=role)])
    db.commit()
    return school, user


def test_onboarding_creates_admin_session_and_selected_school(client: TestClient) -> None:
    response = client.post(
        "/api/v1/auth/onboard",
        json={
            "school_name": "Demo School",
            "timezone": "Europe/Berlin",
            "language": "en",
            "admin_name": "Amina Admin",
            "admin_email": "Admin@SchoolOS.Local",
            "admin_password": "strong-local-password",
        },
    )

    assert response.status_code == 201
    payload = response.json()
    assert payload["authenticated"] is True
    assert payload["user"]["email"] == "admin@schoolos.local"
    assert payload["current_role"] == "ADMIN"
    assert payload["current_school"]["name"] == "Demo School"

    session_response = client.get("/api/v1/auth/session")

    assert session_response.status_code == 200
    assert session_response.json()["authenticated"] is True


def test_onboarding_is_available_only_for_first_school(client: TestClient) -> None:
    first = client.post(
        "/api/v1/auth/onboard",
        json={
            "school_name": "First School",
            "admin_name": "First Admin",
            "admin_email": "first@schoolos.local",
            "admin_password": "first-password-ok",
        },
    )
    second = client.post(
        "/api/v1/auth/onboard",
        json={
            "school_name": "Second School",
            "admin_name": "Second Admin",
            "admin_email": "second@schoolos.local",
            "admin_password": "second-password-ok",
        },
    )

    assert first.status_code == 201
    assert second.status_code == 409


def test_multiple_memberships_require_school_selection(client: TestClient) -> None:
    with next(app.dependency_overrides[get_db]()) as db:
        school_a, user = create_school_user_membership(
            db,
            school_name="North School",
            email="multi@schoolos.local",
            password="multi-password-ok",
        )
        school_b = School(
            name="South School",
            timezone="Europe/Berlin",
            language="en",
            working_days={"days": ["MON", "TUE", "WED", "THU", "FRI"]},
        )
        db.add_all([school_b, SchoolMembership(school=school_b, user=user, role="TEACHER")])
        db.commit()

    login = client.post(
        "/api/v1/auth/login",
        json={"email": "multi@schoolos.local", "password": "multi-password-ok"},
    )

    assert login.status_code == 200
    assert login.json()["current_school"] is None
    assert len(login.json()["memberships"]) == 2

    missing_context = client.get("/api/v1/auth/current-school")
    assert missing_context.status_code == 400

    selected = client.post("/api/v1/auth/select-school", json={"school_id": str(school_a.id)})

    assert selected.status_code == 200
    assert selected.json()["current_school"]["id"] == str(school_a.id)

    current = client.get("/api/v1/auth/current-school")
    assert current.status_code == 200
    assert current.json()["school"]["name"] == "North School"


def test_user_cannot_select_school_without_membership(client: TestClient) -> None:
    with next(app.dependency_overrides[get_db]()) as db:
        create_school_user_membership(
            db,
            school_name="Allowed School",
            email="allowed@schoolos.local",
            password="allowed-password-ok",
        )
        forbidden_school = School(
            name="Forbidden School",
            timezone="Europe/Berlin",
            language="en",
            working_days={"days": ["MON", "TUE", "WED", "THU", "FRI"]},
        )
        db.add(forbidden_school)
        db.commit()

    client.post(
        "/api/v1/auth/login",
        json={"email": "allowed@schoolos.local", "password": "allowed-password-ok"},
    )

    response = client.post(
        "/api/v1/auth/select-school",
        json={"school_id": str(forbidden_school.id)},
    )

    assert response.status_code == 403


def test_logout_revokes_session(client: TestClient) -> None:
    with next(app.dependency_overrides[get_db]()) as db:
        create_school_user_membership(
            db,
            school_name="Logout School",
            email="logout@schoolos.local",
            password="logout-password-ok",
        )

    login = client.post(
        "/api/v1/auth/login",
        json={"email": "logout@schoolos.local", "password": "logout-password-ok"},
    )
    assert login.status_code == 200

    logout = client.post("/api/v1/auth/logout")
    assert logout.status_code == 204

    session = client.get("/api/v1/auth/session")
    assert session.status_code == 200
    assert session.json()["authenticated"] is False


def test_random_school_id_is_rejected(client: TestClient) -> None:
    with next(app.dependency_overrides[get_db]()) as db:
        create_school_user_membership(
            db,
            school_name="Scoped School",
            email="scoped@schoolos.local",
            password="scoped-password-ok",
        )

    client.post(
        "/api/v1/auth/login",
        json={"email": "scoped@schoolos.local", "password": "scoped-password-ok"},
    )

    response = client.post(
        "/api/v1/auth/select-school",
        json={"school_id": str(uuid.uuid4())},
    )

    assert response.status_code == 403

