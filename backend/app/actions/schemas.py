from datetime import date, datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator

ActionStatus = Literal["OPEN", "IN_PROGRESS", "RESOLVED", "DISMISSED"]


class PolicyWrite(BaseModel):
    enabled: bool = True
    threshold: int = Field(default=2, ge=1, le=30)
    window_days: int = Field(default=7, ge=1, le=90)

    @model_validator(mode="after")
    def validate_window(self) -> "PolicyWrite":
        if self.threshold > self.window_days:
            raise ValueError("Threshold cannot exceed the number of calendar days in the window")
        return self

    model_config = ConfigDict(from_attributes=True)


class ActionWrite(BaseModel):
    expected_revision: int = Field(ge=1)
    status: ActionStatus | None = None
    assignee_user_id: UUID | None = None
    reason: str | None = Field(default=None, max_length=500)

    @model_validator(mode="after")
    def validate_reason(self) -> "ActionWrite":
        if self.reason is not None:
            self.reason = self.reason.strip() or None
        if self.status in {"RESOLVED", "DISMISSED"} and len(self.reason or "") < 3:
            raise ValueError("Closing an action requires a reason of at least 3 characters")
        return self


class EvidenceRead(BaseModel):
    record_id: UUID
    section_id: UUID
    school_date: date


class ActionRead(BaseModel):
    id: UUID
    student_id: UUID
    student_name: str
    student_number: str
    rule_key: str
    status: ActionStatus
    assignee_user_id: UUID | None
    assignee_name: str | None
    window_end: date
    threshold: int
    window_days: int
    evidence: list[EvidenceRead]
    qualifies: bool
    revision: int
    resolution_reason: str | None
    closed_at: datetime | None
    created_at: datetime
    updated_at: datetime


class ActionPage(BaseModel):
    items: list[ActionRead]
    total: int
    counts: dict[str, int]
    has_more: bool


class AssigneeRead(BaseModel):
    id: UUID
    display_name: str

    model_config = ConfigDict(from_attributes=True)


class TimelineRead(BaseModel):
    id: UUID
    entry_type: str
    visibility: str
    title: str
    summary: str
    details: dict[str, Any]
    occurred_at: datetime

    model_config = ConfigDict(from_attributes=True)


class TimelinePage(BaseModel):
    entries: list[TimelineRead]
    has_more: bool
