from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class OnboardRequest(BaseModel):
    school_name: str = Field(min_length=2, max_length=200)
    timezone: str = Field(default="Europe/Berlin", min_length=2, max_length=80)
    language: str = Field(default="en", min_length=2, max_length=16)
    admin_name: str = Field(min_length=2, max_length=200)
    admin_email: str = Field(min_length=3, max_length=320)
    admin_password: str = Field(min_length=10, max_length=256)


class LoginRequest(BaseModel):
    email: str = Field(min_length=3, max_length=320)
    password: str = Field(min_length=1, max_length=256)


class SelectSchoolRequest(BaseModel):
    school_id: UUID


class SchoolSummary(BaseModel):
    id: UUID
    name: str
    timezone: str
    language: str

    model_config = ConfigDict(from_attributes=True)


class MembershipSummary(BaseModel):
    school: SchoolSummary
    role: str


class UserSummary(BaseModel):
    id: UUID
    email: str
    display_name: str

    model_config = ConfigDict(from_attributes=True)


class SessionResponse(BaseModel):
    authenticated: bool
    user: UserSummary | None = None
    memberships: list[MembershipSummary] = []
    current_school: SchoolSummary | None = None
    current_role: str | None = None

