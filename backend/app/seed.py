import argparse
import uuid

from sqlalchemy import select

from app.core.config import get_settings
from app.db.models import School, SchoolMembership, User
from app.db.session import SessionLocal
from app.identity.security import hash_password, verify_password

SCHOOL_ID = uuid.UUID("11111111-1111-4111-8111-111111111111")
ADMIN_ID = uuid.UUID("22222222-2222-4222-8222-222222222222")
TEACHER_ID = uuid.UUID("33333333-3333-4333-8333-333333333333")


def upsert_seed_data() -> None:
    with SessionLocal() as db:
        school = db.get(School, SCHOOL_ID)
        if school is None:
            school = School(
                id=SCHOOL_ID,
                name="Local Demo School",
                timezone="Europe/Berlin",
                language="en",
                working_days={"days": ["MON", "TUE", "WED", "THU", "FRI"]},
            )
            db.add(school)

        users = [
            User(
                id=ADMIN_ID,
                email="admin@schoolos.local",
                display_name="Amina Admin",
                password_hash=hash_password("schoolos-admin-demo"),
            ),
            User(
                id=TEACHER_ID,
                email="teacher@schoolos.local",
                display_name="Tariq Teacher",
                password_hash=hash_password("schoolos-teacher-demo"),
            ),
        ]

        for user in users:
            if db.get(User, user.id) is None:
                db.add(user)

        db.flush()

        memberships = [
            (ADMIN_ID, "ADMIN"),
            (TEACHER_ID, "TEACHER"),
        ]
        for user_id, role in memberships:
            existing = db.scalar(
                select(SchoolMembership).where(
                    SchoolMembership.user_id == user_id,
                    SchoolMembership.school_id == SCHOOL_ID,
                )
            )
            if existing is None:
                db.add(SchoolMembership(school_id=SCHOOL_ID, user_id=user_id, role=role))

        db.commit()


def ensure_demo_teacher(school_id: uuid.UUID) -> None:
    if get_settings().environment != "local":
        raise ValueError("Demo teachers can only be seeded in the local environment")
    with SessionLocal.begin() as db:
        if db.get(School, school_id) is None:
            raise ValueError("Selected demo school does not exist")
        teacher = db.scalar(select(User).where(User.email == "teacher@schoolos.local"))
        if teacher is None:
            teacher = User(
                email="teacher@schoolos.local",
                display_name="Tariq Teacher",
                password_hash=hash_password("schoolos-teacher-demo"),
            )
            db.add(teacher)
            db.flush()
        elif teacher.status != "ACTIVE" or not verify_password(
            "schoolos-teacher-demo", teacher.password_hash
        ):
            raise ValueError("Existing teacher account is not the active synthetic demo account")
        membership = db.scalar(
            select(SchoolMembership).where(
                SchoolMembership.school_id == school_id,
                SchoolMembership.user_id == teacher.id,
            )
        )
        if membership is None:
            db.add(SchoolMembership(school_id=school_id, user_id=teacher.id, role="TEACHER"))
        elif membership.status != "ACTIVE" or membership.role != "TEACHER":
            raise ValueError("Existing membership will not be changed by the demo seed")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Seed synthetic local demo accounts.")
    parser.add_argument(
        "--teacher-school",
        type=uuid.UUID,
        help="Add only the demo teacher to an existing local school UUID",
    )
    args = parser.parse_args()
    if args.teacher_school:
        ensure_demo_teacher(args.teacher_school)
        print("Ensured synthetic demo teacher membership; existing accounts were not reset.")
    else:
        upsert_seed_data()
        print("Seeded Local Demo School with admin and teacher memberships.")
