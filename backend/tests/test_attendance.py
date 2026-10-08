from collections.abc import Generator
from contextlib import contextmanager
from datetime import date

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.db.models import (
    AcademicYear,
    Base,
    Enrollment,
    GradeLevel,
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
    with TestClient(app) as client:
        yield client, testing_session_local
    app.dependency_overrides.clear()


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

    final = client.post(
        f"/api/v1/attendance/sections/{section.id}/finalize?school_date=2026-10-08"
    )
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
