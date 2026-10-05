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
    Guardian,
    School,
    SchoolMembership,
    Section,
    Student,
    StudentGuardian,
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
    school: School | None = None,
    school_name: str = "Demo School",
    email: str,
    role: str,
) -> tuple[School, User]:
    if school is None:
        school = School(
            name=school_name,
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


def create_academic_fixture(
    db: Session,
    school: School,
) -> tuple[AcademicYear, GradeLevel, Section, Subject]:
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
    db.add(section)
    db.commit()
    return year, level, section, subject


def test_admin_creates_academic_structure_student_guardian_and_enrollment(
    api: tuple[TestClient, sessionmaker[Session]],
) -> None:
    client, session_factory = api
    with db_session(session_factory) as db:
        school, teacher = create_member(
            db,
            school_name="Admin School",
            email="teacher@schoolos.local",
            role="TEACHER",
        )
        admin = User(
            email="admin@schoolos.local",
            display_name="Admin",
            password_hash=hash_password("schoolos-password"),
        )
        db.add_all([admin, SchoolMembership(school=school, user=admin, role="ADMIN")])
        db.commit()
        teacher_id = str(teacher.id)

    login(client, "admin@schoolos.local")

    year = client.post(
        "/api/v1/academics/academic-years",
        json={"name": "2026-2027", "starts_on": "2026-09-01", "ends_on": "2027-07-15"},
    )
    assert year.status_code == 201
    level = client.post(
        "/api/v1/academics/grade-levels",
        json={"label": "Grade 1", "sort_order": 1},
    )
    assert level.status_code == 201
    section = client.post(
        "/api/v1/academics/sections",
        json={
            "academic_year_id": year.json()["id"],
            "grade_level_id": level.json()["id"],
            "label": "1A",
        },
    )
    assert section.status_code == 201
    subject = client.post("/api/v1/academics/subjects", json={"name": "Homeroom"})
    assert subject.status_code == 201
    assignment = client.post(
        "/api/v1/academics/teacher-assignments",
        json={
            "teacher_user_id": teacher_id,
            "section_id": section.json()["id"],
            "subject_id": subject.json()["id"],
        },
    )
    assert assignment.status_code == 201

    student = client.post(
        "/api/v1/students",
        json={"student_number": "S-001", "given_name": "Sara", "family_name": "Stone"},
    )
    assert student.status_code == 201
    guardian = client.post(
        "/api/v1/students/guardians",
        json={"display_name": "Nadia Stone", "email": "nadia@example.test"},
    )
    assert guardian.status_code == 201
    linked = client.post(
        f"/api/v1/students/{student.json()['id']}/guardians",
        json={
            "guardian_id": guardian.json()["id"],
            "relationship": "Mother",
            "portal_access": True,
        },
    )
    assert linked.status_code == 201
    assert linked.json()["guardian_links"][0]["portal_access"] is True

    enrollment = client.post(
        "/api/v1/students/enrollments",
        json={
            "student_id": student.json()["id"],
            "section_id": section.json()["id"],
            "starts_on": "2026-09-01",
        },
    )
    assert enrollment.status_code == 201

    directory = client.get("/api/v1/students")
    assert directory.status_code == 200
    assert [item["student_number"] for item in directory.json()] == ["S-001"]


def test_cross_school_references_are_rejected(
    api: tuple[TestClient, sessionmaker[Session]],
) -> None:
    client, session_factory = api
    with db_session(session_factory) as db:
        school_a, _admin = create_member(
            db,
            school_name="School A",
            email="admin-a@schoolos.local",
            role="ADMIN",
        )
        school_b, _other_admin = create_member(
            db,
            school_name="School B",
            email="admin-b@schoolos.local",
            role="ADMIN",
        )
        year_a, _level_a, _section_a, _subject_a = create_academic_fixture(db, school_a)
        _year_b, level_b, section_b, _subject_b = create_academic_fixture(db, school_b)

    login(client, "admin-a@schoolos.local")

    cross_section = client.post(
        "/api/v1/academics/sections",
        json={
            "academic_year_id": str(year_a.id),
            "grade_level_id": str(level_b.id),
            "label": "Mixed",
        },
    )
    assert cross_section.status_code == 400

    student = client.post(
        "/api/v1/students",
        json={"student_number": "A-001", "given_name": "Ari", "family_name": "Able"},
    )
    assert student.status_code == 201
    cross_enrollment = client.post(
        "/api/v1/students/enrollments",
        json={
            "student_id": student.json()["id"],
            "section_id": str(section_b.id),
            "starts_on": "2026-09-01",
        },
    )
    assert cross_enrollment.status_code == 400


def test_teacher_sees_only_assigned_students(api: tuple[TestClient, sessionmaker[Session]]) -> None:
    client, session_factory = api
    with db_session(session_factory) as db:
        school, teacher = create_member(
            db,
            school_name="Teacher School",
            email="teacher@schoolos.local",
            role="TEACHER",
        )
        _year, _level, section, _subject = create_academic_fixture(db, school)
        student_a = Student(
            school_id=school.id,
            student_number="T-001",
            given_name="Talia",
            family_name="Assigned",
        )
        student_b = Student(
            school_id=school.id,
            student_number="T-002",
            given_name="Omar",
            family_name="Unassigned",
        )
        db.add_all([student_a, student_b])
        db.flush()
        db.add_all(
            [
                TeacherAssignment(
                    school_id=school.id,
                    teacher_user_id=teacher.id,
                    section_id=section.id,
                ),
                Enrollment(
                    school_id=school.id,
                    student_id=student_a.id,
                    section_id=section.id,
                    starts_on=date(2026, 9, 1),
                ),
            ]
        )
        db.commit()

    login(client, "teacher@schoolos.local")

    directory = client.get("/api/v1/students")
    assert directory.status_code == 200
    assert [item["student_number"] for item in directory.json()] == ["T-001"]


def test_guardian_sees_only_linked_portal_students(
    api: tuple[TestClient, sessionmaker[Session]],
) -> None:
    client, session_factory = api
    with db_session(session_factory) as db:
        school, guardian_user = create_member(
            db,
            school_name="Guardian School",
            email="guardian@schoolos.local",
            role="GUARDIAN",
        )
        student_visible = Student(
            school_id=school.id,
            student_number="G-001",
            given_name="Lina",
            family_name="Visible",
        )
        student_hidden = Student(
            school_id=school.id,
            student_number="G-002",
            given_name="Noor",
            family_name="Hidden",
        )
        guardian = Guardian(
            school_id=school.id,
            user_id=guardian_user.id,
            display_name="Guardian User",
            email="guardian@schoolos.local",
        )
        db.add_all([student_visible, student_hidden, guardian])
        db.flush()
        db.add(
            StudentGuardian(
                school_id=school.id,
                student_id=student_visible.id,
                guardian_id=guardian.id,
                relationship="Father",
                portal_access=True,
            )
        )
        db.commit()

    login(client, "guardian@schoolos.local")

    directory = client.get("/api/v1/students")
    assert directory.status_code == 200
    assert [item["student_number"] for item in directory.json()] == ["G-001"]
    forbidden = client.get(f"/api/v1/students/{student_hidden.id}")
    assert forbidden.status_code == 403
