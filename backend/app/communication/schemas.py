from datetime import date, datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator


class RecipientRead(BaseModel):
    guardian_link_id: UUID
    name: str
    email: str


class DraftCreate(BaseModel):
    guardian_link_id: UUID
    recipient_email: str = Field(min_length=3, max_length=320)
    expected_action_revision: int = Field(ge=1)


class DraftWrite(DraftCreate):
    expected_revision: int = Field(ge=1)
    subject: str = Field(min_length=1, max_length=200)
    body: str = Field(min_length=1, max_length=5000)

    @model_validator(mode="after")
    def validate_content(self) -> "DraftWrite":
        self.subject = self.subject.strip()
        self.body = self.body.replace("\r\n", "\n").replace("\r", "\n").strip()
        if not self.subject or not self.body:
            raise ValueError("Subject and message cannot be blank")
        if any(ord(char) < 32 or ord(char) == 127 for char in self.subject):
            raise ValueError("Subject cannot contain newlines or control characters")
        if any((ord(char) < 32 and char not in "\n\t") or ord(char) == 127 for char in self.body):
            raise ValueError("Message cannot contain control characters")
        return self


class DraftApprove(BaseModel):
    expected_revision: int = Field(ge=1)
    expected_action_revision: int = Field(ge=1)
    recipient_email: str = Field(min_length=3, max_length=320)


class DraftRead(BaseModel):
    id: UUID
    action_id: UUID
    guardian_link_id: UUID
    recipient_name: str
    recipient_email: str
    subject: str
    body: str
    revision: int
    action_revision: int
    current_action_revision: int
    status: str
    approved_revision: int | None
    approved_by_name: str | None
    approved_at: datetime | None
    approval_effective: bool
    blocking_reason: str | None
    created_at: datetime
    updated_at: datetime


class MessageWorkspaceRead(BaseModel):
    drafts: list[DraftRead]
    recipients: list[RecipientRead]
    can_manage: bool
    blocking_reason: str | None
    current_action_revision: int
    evidence_dates: list[date]


class TemplateRead(BaseModel):
    guardian_link_id: UUID
    recipient_name: str
    recipient_email: str
    subject: str
    body: str
    current_action_revision: int
    evidence_dates: list[date]


class RevisionRead(BaseModel):
    revision: int
    recipient_name: str
    recipient_email: str
    subject: str
    body: str
    action_revision: int
    author_name: str | None
    created_at: datetime
    approved_by_name: str | None
    approved_at: datetime | None

    model_config = ConfigDict(from_attributes=True)


class RevisionPage(BaseModel):
    revisions: list[RevisionRead]
    has_more: bool
