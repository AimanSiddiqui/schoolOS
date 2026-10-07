from datetime import date
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator


class StudentCreate(BaseModel):
    student_number: str = Field(min_length=1, max_length=80)
    given_name: str = Field(min_length=1, max_length=120)
    family_name: str = Field(min_length=1, max_length=120)


class StudentUpdate(BaseModel):
    student_number: str | None = Field(default=None, min_length=1, max_length=80)
    given_name: str | None = Field(default=None, min_length=1, max_length=120)
    family_name: str | None = Field(default=None, min_length=1, max_length=120)
    status: str | None = Field(default=None, min_length=1, max_length=32)


class EnrollmentRead(BaseModel):
    id: UUID
    section_id: UUID
    section_label: str | None = None
    grade_level_id: UUID | None = None
    grade_label: str | None = None
    academic_year_id: UUID | None = None
    academic_year_name: str | None = None
    starts_on: date
    ends_on: date | None
    status: str

    model_config = ConfigDict(from_attributes=True)


class GuardianLinkRead(BaseModel):
    id: UUID
    guardian_id: UUID
    guardian_display_name: str | None = None
    guardian_email: str | None = None
    guardian_phone: str | None = None
    relationship: str
    portal_access: bool
    can_receive_notifications: bool
    emergency_contact: bool

    model_config = ConfigDict(from_attributes=True)


class StudentRead(BaseModel):
    id: UUID
    student_number: str
    given_name: str
    family_name: str
    status: str
    enrollments: list[EnrollmentRead] = []
    guardian_links: list[GuardianLinkRead] = []

    model_config = ConfigDict(from_attributes=True)


class GuardianCreate(BaseModel):
    display_name: str = Field(min_length=1, max_length=200)
    email: str = Field(min_length=3, max_length=320)
    phone: str | None = Field(default=None, max_length=80)
    user_id: UUID | None = None


class GuardianRead(BaseModel):
    id: UUID
    display_name: str
    email: str
    phone: str | None
    user_id: UUID | None

    model_config = ConfigDict(from_attributes=True)


class StudentGuardianCreate(BaseModel):
    guardian_id: UUID
    relationship: str = Field(min_length=1, max_length=80)
    portal_access: bool = False
    can_receive_notifications: bool = True
    emergency_contact: bool = False


class EnrollmentCreate(BaseModel):
    student_id: UUID
    section_id: UUID
    starts_on: date
    ends_on: date | None = None

    @model_validator(mode="after")
    def validate_dates(self) -> "EnrollmentCreate":
        if self.ends_on is not None and self.ends_on < self.starts_on:
            raise ValueError("Enrollment end date must be on or after the start date")
        return self
