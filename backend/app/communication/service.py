from datetime import UTC, datetime
from email.errors import MessageError
from email.headerregistry import Address
from uuid import UUID, uuid4

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.actions.access import teacher_student_ids
from app.actions.service import ACTIVE_STATUSES
from app.communication.schemas import DraftRead, RecipientRead
from app.db.models import (
    ActionItem,
    AuditEntry,
    Guardian,
    MessageApproval,
    MessageDraft,
    MessageRevision,
    School,
    SchoolMembership,
    Student,
    StudentGuardian,
    TimelineEntry,
    User,
)
from app.identity.dependencies import SchoolContext


def valid_email(value: str) -> bool:
    if any(char.isspace() or ord(char) < 32 or ord(char) == 127 for char in value):
        return False
    try:
        address = Address(addr_spec=value)
        return bool(address.username and address.domain and value.isascii())
    except (MessageError, ValueError, TypeError, IndexError):
        return False


def action_block(action: ActionItem) -> str | None:
    if action.status not in ACTIVE_STATUSES:
        return "Closed follow-ups cannot approve guardian messages."
    if action.student.status != "ACTIVE":
        return "Messages are unavailable for inactive students."
    if not action.qualifies:
        return "Attendance evidence no longer meets the rule. Review the follow-up first."
    return None


def management_block(action: ActionItem, context: SchoolContext) -> str | None:
    if context.membership.role == "TEACHER" and action.assignee_user_id != context.user.id:
        return "Claim this follow-up before drafting or approving messages."
    return action_block(action)


def ensure_manage(db: Session, action: ActionItem, context: SchoolContext) -> None:
    db.execute(select(Student.id).where(Student.id == action.student_id).with_for_update())
    db.refresh(action.student)
    reason = management_block(action, context)
    if reason:
        denied_owner = (
            context.membership.role == "TEACHER" and action.assignee_user_id != context.user.id
        )
        raise HTTPException(status_code=403 if denied_owner else 409, detail=reason)


def recipient_link(
    db: Session, action: ActionItem, link_id: UUID, lock: bool = False
) -> StudentGuardian | None:
    query = (
        select(StudentGuardian)
        .join(Guardian, Guardian.id == StudentGuardian.guardian_id)
        .where(
            StudentGuardian.id == link_id,
            StudentGuardian.school_id == action.school_id,
            StudentGuardian.student_id == action.student_id,
            Guardian.school_id == action.school_id,
        )
        .options(selectinload(StudentGuardian.guardian))
        .execution_options(populate_existing=True)
    )
    if lock:
        query = query.with_for_update(of=[StudentGuardian, Guardian])
    return db.scalar(query)


def eligible_link(link: StudentGuardian | None) -> bool:
    return bool(
        link and link.can_receive_notifications and valid_email(link.guardian.email.strip())
    )


def require_recipient(
    db: Session, action: ActionItem, link_id: UUID, expected_email: str
) -> StudentGuardian:
    link = recipient_link(db, action, link_id, lock=True)
    if not eligible_link(link):
        raise HTTPException(
            status_code=400,
            detail="Choose a linked guardian with notification permission and a valid email",
        )
    if link.guardian.email.strip() != expected_email.strip():
        raise HTTPException(
            status_code=409,
            detail="Recipient contact changed. Refresh it before saving or approving.",
        )
    return link


def recipients(db: Session, action: ActionItem) -> list[RecipientRead]:
    links = db.scalars(
        select(StudentGuardian)
        .join(Guardian, Guardian.id == StudentGuardian.guardian_id)
        .where(
            StudentGuardian.school_id == action.school_id,
            StudentGuardian.student_id == action.student_id,
            Guardian.school_id == action.school_id,
            StudentGuardian.can_receive_notifications.is_(True),
        )
        .options(selectinload(StudentGuardian.guardian))
        .order_by(Guardian.display_name, StudentGuardian.id)
    )
    return [
        RecipientRead(
            guardian_link_id=link.id,
            name=link.guardian.display_name,
            email=link.guardian.email.strip(),
        )
        for link in links
        if eligible_link(link)
    ]


def check_action_revision(action: ActionItem, expected: int) -> None:
    if action.revision != expected:
        raise HTTPException(
            status_code=409,
            detail="Follow-up changed. Refresh the evidence before reviewing this message.",
        )


def template(action: ActionItem, link: StudentGuardian, school: School) -> tuple[str, str]:
    name = f"{action.student.given_name} {action.student.family_name}"
    dates = ", ".join(item["school_date"] for item in action.evidence)
    return f"Attendance follow-up: {name}"[:200], (
        f"Hello {link.guardian.display_name},\n\n"
        f"We are following up about {name}'s attendance. Our register records unexcused "
        f"absences on {dates}.\n\n"
        f"Please contact {school.name} to confirm the reason for these absences and let us "
        f"know how we can help.\n\nThank you,\n{school.name}"
    )


def write_revision(
    db: Session, draft: MessageDraft, context: SchoolContext, operation: str
) -> None:
    db.flush()
    db.add(
        MessageRevision(
            school_id=draft.school_id,
            draft_id=draft.id,
            revision=draft.revision,
            guardian_link_id=draft.guardian_link_id,
            recipient_name=draft.recipient_name,
            recipient_email=draft.recipient_email,
            subject=draft.subject,
            body=draft.body,
            action_revision=draft.action_revision,
            author_user_id=context.user.id,
            created_at=draft.updated_at,
        )
    )
    message_history(db, draft, context, operation)


def message_history(
    db: Session, draft: MessageDraft, context: SchoolContext, operation: str
) -> None:
    audit_id = uuid4()
    stamped_at = datetime.now(UTC)
    changes = {
        "revision": draft.revision,
        "action_id": str(draft.action_id),
        "action_revision": draft.action_revision,
        "guardian_link_id": str(draft.guardian_link_id),
    }
    db.add(
        AuditEntry(
            id=audit_id,
            school_id=draft.school_id,
            actor_user_id=context.user.id,
            operation=operation,
            target_type="MessageDraft",
            target_id=draft.id,
            changes=changes,
            occurred_at=stamped_at,
        )
    )
    action = db.get(ActionItem, draft.action_id)
    db.add(
        TimelineEntry(
            school_id=draft.school_id,
            student_id=action.student_id,
            source_key=f"message:{audit_id}",
            entry_type=operation,
            visibility="STAFF",
            title={
                "message.created": "Guardian message drafted",
                "message.revised": "Guardian message revised",
                "message.approved": "Guardian message approved",
            }[operation],
            summary=f"Revision {draft.revision}. No message has been sent.",
            details={"draft_id": str(draft.id), "revision": draft.revision},
            occurred_at=stamped_at,
        )
    )


def draft_block(db: Session, draft: MessageDraft, action: ActionItem) -> str | None:
    reason = action_block(action)
    if reason:
        return reason
    if draft.action_revision != action.revision:
        return "Follow-up evidence or ownership changed. Review and save a new message revision."
    link = recipient_link(db, action, draft.guardian_link_id)
    if not eligible_link(link):
        return "Recipient is no longer eligible for notifications."
    if (draft.recipient_email, draft.recipient_name) != (
        link.guardian.email.strip(),
        link.guardian.display_name,
    ):
        return "Recipient contact changed. Review and save a new message revision."
    return None


def approval_for(db: Session, draft: MessageDraft) -> MessageApproval | None:
    if draft.approved_revision is None:
        return None
    return db.scalar(
        select(MessageApproval).where(
            MessageApproval.school_id == draft.school_id,
            MessageApproval.draft_id == draft.id,
            MessageApproval.revision == draft.approved_revision,
        )
    )


def approver_valid(
    db: Session, draft: MessageDraft, action: ActionItem, approval: MessageApproval
) -> bool:
    user = db.get(User, approval.approver_user_id) if approval.approver_user_id else None
    if user is None or user.status != "ACTIVE":
        return False
    membership = db.scalar(
        select(SchoolMembership).where(
            SchoolMembership.school_id == draft.school_id,
            SchoolMembership.user_id == user.id,
            SchoolMembership.status == "ACTIVE",
        )
    )
    if membership is None:
        return False
    if membership.role == "ADMIN":
        return True
    return (
        membership.role == "TEACHER"
        and action.assignee_user_id == user.id
        and action.student_id in teacher_student_ids(db, db.get(School, draft.school_id), user.id)
    )


def serialize_draft(db: Session, draft: MessageDraft, action: ActionItem) -> DraftRead:
    approval = approval_for(db, draft)
    reason = draft_block(db, draft, action)
    if approval and not reason and not approver_valid(db, draft, action, approval):
        reason = "The approver is no longer authorized. Save a new revision for review."
    approver = (
        db.get(User, approval.approver_user_id) if approval and approval.approver_user_id else None
    )
    return DraftRead(
        id=draft.id,
        action_id=draft.action_id,
        guardian_link_id=draft.guardian_link_id,
        recipient_name=draft.recipient_name,
        recipient_email=draft.recipient_email,
        subject=draft.subject,
        body=draft.body,
        revision=draft.revision,
        action_revision=draft.action_revision,
        current_action_revision=action.revision,
        status="APPROVED" if draft.approved_revision else "DRAFT",
        approved_revision=draft.approved_revision,
        approved_by_name=approver.display_name if approver else None,
        approved_at=approval.approved_at if approval else None,
        approval_effective=bool(
            approval and not reason and draft.approved_revision == draft.revision
        ),
        blocking_reason=reason,
        created_at=draft.created_at,
        updated_at=draft.updated_at,
    )
