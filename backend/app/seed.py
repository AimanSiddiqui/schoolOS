import uuid

from sqlalchemy import select

from app.db.models import School, SchoolMembership, User
from app.db.session import SessionLocal
from app.identity.security import hash_password

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


if __name__ == "__main__":
    upsert_seed_data()
    print("Seeded Local Demo School with admin and teacher memberships.")
