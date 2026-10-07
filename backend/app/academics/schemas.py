from datetime import date
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator


class AcademicYearCreate(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    starts_on: date
    ends_on: date

    @model_validator(mode="after")
    def validate_dates(self) -> "AcademicYearCreate":
        if self.ends_on < self.starts_on:
            raise ValueError("Academic year end date must be on or after the start date")
        return self


class AcademicYearRead(BaseModel):
    id: UUID
    name: str
    starts_on: date
    ends_on: date
    status: str

    model_config = ConfigDict(from_attributes=True)


class AcademicYearUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=2, max_length=120)
    starts_on: date | None = None
    ends_on: date | None = None
    status: str | None = Field(default=None, min_length=1, max_length=32)

    @model_validator(mode="after")
    def validate_dates(self) -> "AcademicYearUpdate":
        has_both_dates = self.starts_on is not None and self.ends_on is not None
        if has_both_dates and self.ends_on < self.starts_on:
            raise ValueError("Academic year end date must be on or after the start date")
        return self


class GradeLevelCreate(BaseModel):
    label: str = Field(min_length=1, max_length=80)
    sort_order: int = Field(ge=0, le=1000)


class GradeLevelRead(BaseModel):
    id: UUID
    label: str
    sort_order: int
    status: str

    model_config = ConfigDict(from_attributes=True)


class GradeLevelUpdate(BaseModel):
    label: str | None = Field(default=None, min_length=1, max_length=80)
    sort_order: int | None = Field(default=None, ge=0, le=1000)
    status: str | None = Field(default=None, min_length=1, max_length=32)


class SectionCreate(BaseModel):
    academic_year_id: UUID
    grade_level_id: UUID
    label: str = Field(min_length=1, max_length=80)


class SectionRead(BaseModel):
    id: UUID
    academic_year_id: UUID
    grade_level_id: UUID
    label: str
    status: str

    model_config = ConfigDict(from_attributes=True)


class SectionUpdate(BaseModel):
    academic_year_id: UUID | None = None
    grade_level_id: UUID | None = None
    label: str | None = Field(default=None, min_length=1, max_length=80)
    status: str | None = Field(default=None, min_length=1, max_length=32)


class SubjectCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)


class SubjectRead(BaseModel):
    id: UUID
    name: str
    status: str

    model_config = ConfigDict(from_attributes=True)


class SubjectUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    status: str | None = Field(default=None, min_length=1, max_length=32)


class TeacherAssignmentCreate(BaseModel):
    teacher_user_id: UUID
    section_id: UUID
    subject_id: UUID | None = None


class TeacherAssignmentRead(BaseModel):
    id: UUID
    teacher_user_id: UUID
    section_id: UUID
    subject_id: UUID | None
    status: str

    model_config = ConfigDict(from_attributes=True)


class TeacherAssignmentUpdate(BaseModel):
    teacher_user_id: UUID | None = None
    section_id: UUID | None = None
    subject_id: UUID | None = None
    status: str | None = Field(default=None, min_length=1, max_length=32)


class AcademicSetupRead(BaseModel):
    academic_years: list[AcademicYearRead]
    grade_levels: list[GradeLevelRead]
    sections: list[SectionRead]
    subjects: list[SubjectRead]
    teacher_assignments: list[TeacherAssignmentRead]
