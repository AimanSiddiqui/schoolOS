from datetime import date, datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator

VALID_ATTENDANCE_MARKS = {"PRESENT", "ABSENT", "LATE", "EXCUSED"}


class AttendanceRecordWrite(BaseModel):
    student_id: UUID
    mark: str | None = Field(default=None, max_length=32)
    note: str | None = Field(default=None, max_length=500)

    @model_validator(mode="after")
    def validate_mark(self) -> "AttendanceRecordWrite":
        if self.mark is not None:
            self.mark = self.mark.strip().upper()
            if self.mark not in VALID_ATTENDANCE_MARKS:
                raise ValueError("Attendance mark must be PRESENT, ABSENT, LATE, or EXCUSED")
        if self.note is not None:
            self.note = self.note.strip() or None
        return self


class AttendanceDraftSave(BaseModel):
    records: list[AttendanceRecordWrite] = Field(min_length=1)


class AttendanceCorrection(BaseModel):
    mark: str = Field(min_length=1, max_length=32)
    note: str | None = Field(default=None, max_length=500)
    reason: str = Field(min_length=3, max_length=500)

    @model_validator(mode="after")
    def validate_mark(self) -> "AttendanceCorrection":
        self.mark = self.mark.strip().upper()
        if self.mark not in VALID_ATTENDANCE_MARKS:
            raise ValueError("Attendance mark must be PRESENT, ABSENT, LATE, or EXCUSED")
        if self.note is not None:
            self.note = self.note.strip() or None
        self.reason = self.reason.strip()
        return self


class AttendanceRosterRecord(BaseModel):
    record_id: UUID | None
    student_id: UUID
    student_number: str
    given_name: str
    family_name: str
    mark: str | None
    note: str | None
    correction_reason: str | None = None


class AttendanceSessionRead(BaseModel):
    session_id: UUID
    section_id: UUID
    section_label: str
    grade_label: str | None
    school_date: date
    status: str
    finalized_at: datetime | None
    total_students: int
    marked_count: int
    absent_count: int
    late_count: int
    excused_count: int
    records: list[AttendanceRosterRecord]


class AttendanceSectionSummary(BaseModel):
    section_id: UUID
    section_label: str
    grade_label: str | None
    school_date: date
    status: str
    total_students: int
    marked_count: int
    absent_count: int
    late_count: int
    excused_count: int

    model_config = ConfigDict(from_attributes=True)
