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


def test_admin_updates_and_deactivates_academic_setup_records(
    api: tuple[TestClient, sessionmaker[Session]],
) -> None:
    client, session_factory = api
    with db_session(session_factory) as db:
        school, teacher = create_member(
            db,
            school_name="Academic Edit School",
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
        year, level, section, subject = create_academic_fixture(db, school)
        assignment = TeacherAssignment(
            school_id=school.id,
            teacher_user_id=teacher.id,
            section_id=section.id,
            subject_id=subject.id,
        )
        db.add(assignment)
        db.commit()
        year_id = str(year.id)
        level_id = str(level.id)
        section_id = str(section.id)
        subject_id = str(subject.id)
        assignment_id = str(assignment.id)

    login(client, "admin@schoolos.local")

    updated_year = client.patch(
        f"/api/v1/academics/academic-years/{year_id}",
        json={"name": "2026-27", "ends_on": "2027-07-20"},
    )
    assert updated_year.status_code == 200
    assert updated_year.json()["name"] == "2026-27"
    assert updated_year.json()["status"] == "ACTIVE"

    updated_level = client.patch(
        f"/api/v1/academics/grade-levels/{level_id}",
        json={"label": "Grade One", "sort_order": 2},
    )
    assert updated_level.status_code == 200
    assert updated_level.json()["label"] == "Grade One"
    deactivated_level = client.post(f"/api/v1/academics/grade-levels/{level_id}/deactivate")
    assert deactivated_level.status_code == 200
    assert deactivated_level.json()["status"] == "INACTIVE"

    updated_section = client.patch(
        f"/api/v1/academics/sections/{section_id}",
        json={"label": "1B"},
    )
    assert updated_section.status_code == 200
    assert updated_section.json()["label"] == "1B"

    updated_subject = client.patch(
        f"/api/v1/academics/subjects/{subject_id}",
        json={"name": "Mathematics"},
    )
    assert updated_subject.status_code == 200
    assert updated_subject.json()["name"] == "Mathematics"
    deactivated_subject = client.post(f"/api/v1/academics/subjects/{subject_id}/deactivate")
    assert deactivated_subject.status_code == 200
    assert deactivated_subject.json()["status"] == "INACTIVE"

    updated_assignment = client.patch(
        f"/api/v1/academics/teacher-assignments/{assignment_id}",
        json={"status": "INACTIVE"},
    )
    assert updated_assignment.status_code == 200
    assert updated_assignment.json()["status"] == "INACTIVE"

    deactivated_section = client.post(f"/api/v1/academics/sections/{section_id}/deactivate")
    assert deactivated_section.status_code == 200
    assert deactivated_section.json()["status"] == "INACTIVE"

    deactivated_year = client.post(f"/api/v1/academics/academic-years/{year_id}/deactivate")
    assert deactivated_year.status_code == 200
    assert deactivated_year.json()["status"] == "INACTIVE"


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


def test_admin_filters_views_updates_and_deactivates_students(
    api: tuple[TestClient, sessionmaker[Session]],
) -> None:
    client, session_factory = api
    with db_session(session_factory) as db:
        school, _admin = create_member(
            db,
            school_name="Directory School",
            email="admin@schoolos.local",
            role="ADMIN",
        )
        _year, level, section, _subject = create_academic_fixture(db, school)
        student_a = Student(
            school_id=school.id,
            student_number="D-001",
            given_name="Mina",
            family_name="Marks",
        )
        student_b = Student(
            school_id=school.id,
            student_number="D-002",
            given_name="Zaid",
            family_name="Zimmer",
        )
        guardian = Guardian(
            school_id=school.id,
            display_name="Mara Marks",
            email="mara@example.test",
        )
        db.add_all([student_a, student_b, guardian])
        db.flush()
        db.add_all(
            [
                Enrollment(
                    school_id=school.id,
                    student_id=student_a.id,
                    section_id=section.id,
                    starts_on=date(2026, 9, 1),
                ),
                StudentGuardian(
                    school_id=school.id,
                    student_id=student_a.id,
                    guardian_id=guardian.id,
                    relationship="Mother",
                    portal_access=True,
                ),
            ]
        )
        db.commit()
        student_a_id = str(student_a.id)
        section_id = str(section.id)
        level_id = str(level.id)

    login(client, "admin@schoolos.local")

    searched = client.get("/api/v1/students", params={"q": "mina"})
    assert searched.status_code == 200
    assert [item["student_number"] for item in searched.json()] == ["D-001"]

    section_filtered = client.get("/api/v1/students", params={"section_id": section_id})
    assert section_filtered.status_code == 200
    assert [item["student_number"] for item in section_filtered.json()] == ["D-001"]

    grade_filtered = client.get("/api/v1/students", params={"grade_level_id": level_id})
    assert grade_filtered.status_code == 200
    assert [item["student_number"] for item in grade_filtered.json()] == ["D-001"]

    profile = client.get(f"/api/v1/students/{student_a_id}")
    assert profile.status_code == 200
    assert profile.json()["enrollments"][0]["section_label"] == "1A"
    assert profile.json()["enrollments"][0]["grade_label"] == "Grade 1"
    assert profile.json()["guardian_links"][0]["guardian_display_name"] == "Mara Marks"
    enrollment_id = profile.json()["enrollments"][0]["id"]
    guardian_link_id = profile.json()["guardian_links"][0]["id"]

    updated_enrollment = client.patch(
        f"/api/v1/students/enrollments/{enrollment_id}",
        json={"ends_on": "2026-12-31", "status": "INACTIVE"},
    )
    assert updated_enrollment.status_code == 200
    assert updated_enrollment.json()["ends_on"] == "2026-12-31"
    assert updated_enrollment.json()["status"] == "INACTIVE"

    updated_link = client.patch(
        f"/api/v1/students/guardian-links/{guardian_link_id}",
        json={"relationship": "Aunt", "portal_access": False, "emergency_contact": True},
    )
    assert updated_link.status_code == 200
    link_payload = updated_link.json()["guardian_links"][0]
    assert link_payload["relationship"] == "Aunt"
    assert link_payload["portal_access"] is False
    assert link_payload["emergency_contact"] is True

    updated = client.patch(
        f"/api/v1/students/{student_a_id}",
        json={"student_number": "D-010", "given_name": "Mina", "family_name": "Miles"},
    )
    assert updated.status_code == 200
    assert updated.json()["student_number"] == "D-010"
    assert updated.json()["family_name"] == "Miles"

    deactivated = client.post(f"/api/v1/students/{student_a_id}/deactivate")
    assert deactivated.status_code == 200
    assert deactivated.json()["status"] == "INACTIVE"
    assert deactivated.json()["enrollments"][0]["status"] == "INACTIVE"

    active_only = client.get("/api/v1/students", params={"status_filter": "ACTIVE"})
    assert active_only.status_code == 200
    assert [item["student_number"] for item in active_only.json()] == ["D-002"]
