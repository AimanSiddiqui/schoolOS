from datetime import UTC, datetime
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.actions.access import require_staff
from app.actions.routes import load_action
from app.actions.service import lock_school
from app.communication.schemas import (
    DraftApprove,
    DraftCreate,
    DraftRead,
    DraftWrite,
    MessageWorkspaceRead,
    RevisionPage,
    RevisionRead,
    TemplateRead,
)
from app.communication.service import (
    check_action_revision,
    draft_block,
    eligible_link,
    ensure_manage,
    management_block,
    message_history,
    recipient_link,
    recipients,
    require_recipient,
    serialize_draft,
    template,
    write_revision,
)
from app.db.models import MessageApproval, MessageDraft, MessageRevision, User
from app.db.session import get_db
from app.identity.dependencies import SchoolContext, require_school_context

router = APIRouter(prefix="/api/v1/communication", tags=["communication"])


def load_draft(db: Session, context: SchoolContext, draft_id: UUID):
    require_staff(context)
    draft = db.scalar(
        select(MessageDraft)
        .where(MessageDraft.id == draft_id, MessageDraft.school_id == context.school.id)
        .execution_options(populate_existing=True)
    )
    if draft is None:
        raise HTTPException(status_code=404, detail="Message draft not found")
    return draft, load_action(db, context, draft.action_id)


@router.get("/actions/{action_id}", response_model=MessageWorkspaceRead)
def get_workspace(
    action_id: UUID,
    context: SchoolContext = Depends(require_school_context),
    db: Session = Depends(get_db),
):
    action = load_action(db, context, action_id)
    drafts = db.scalars(
        select(MessageDraft)
        .where(MessageDraft.school_id == context.school.id, MessageDraft.action_id == action.id)
        .order_by(MessageDraft.updated_at.desc(), MessageDraft.id)
    )
    block = management_block(action, context)
    return MessageWorkspaceRead(
        drafts=[serialize_draft(db, draft, action) for draft in drafts],
        recipients=recipients(db, action),
        can_manage=block is None,
        blocking_reason=block,
        current_action_revision=action.revision,
        evidence_dates=[item["school_date"] for item in action.evidence],
    )


@router.get("/actions/{action_id}/template", response_model=TemplateRead)
def preview_template(
    action_id: UUID,
    guardian_link_id: UUID,
    context: SchoolContext = Depends(require_school_context),
    db: Session = Depends(get_db),
):
    action = load_action(db, context, action_id)
    block = management_block(action, context)
    if block:
        raise HTTPException(
            status_code=403
            if context.membership.role == "TEACHER" and action.assignee_user_id != context.user.id
            else 409,
            detail=block,
        )
    link = recipient_link(db, action, guardian_link_id)
    if not eligible_link(link):
        raise HTTPException(status_code=400, detail="Choose an eligible guardian for this student")
    subject, body = template(action, link, context.school)
    return TemplateRead(
        guardian_link_id=link.id,
        recipient_name=link.guardian.display_name,
        recipient_email=link.guardian.email.strip(),
        subject=subject,
        body=body,
        current_action_revision=action.revision,
        evidence_dates=[item["school_date"] for item in action.evidence],
    )


@router.post("/actions/{action_id}/drafts", response_model=DraftRead, status_code=201)
def create_draft(
    action_id: UUID,
    payload: DraftCreate,
    response: Response,
    context: SchoolContext = Depends(require_school_context),
    db: Session = Depends(get_db),
):
    require_staff(context)
    lock_school(db, context.school.id)
    action = load_action(db, context, action_id)
    ensure_manage(db, action, context)
    check_action_revision(action, payload.expected_action_revision)
    link = require_recipient(db, action, payload.guardian_link_id, payload.recipient_email)
    existing = db.scalar(
        select(MessageDraft).where(
            MessageDraft.action_id == action.id,
            MessageDraft.school_id == context.school.id,
            MessageDraft.guardian_link_id == link.id,
        )
    )
    if existing:
        response.status_code = 200
        return serialize_draft(db, existing, action)
    subject, body = template(action, link, context.school)
    stamped_at = datetime.now(UTC)
    draft = MessageDraft(
        id=uuid4(),
        school_id=context.school.id,
        action_id=action.id,
        guardian_link_id=link.id,
        recipient_name=link.guardian.display_name,
        recipient_email=link.guardian.email.strip(),
        subject=subject,
        body=body,
        revision=1,
        action_revision=action.revision,
        created_by_user_id=context.user.id,
        updated_by_user_id=context.user.id,
        created_at=stamped_at,
        updated_at=stamped_at,
    )
    db.add(draft)
    write_revision(db, draft, context, "message.created")
    db.commit()
    return serialize_draft(db, draft, action)


@router.get("/drafts/{draft_id}", response_model=DraftRead)
def get_draft(
    draft_id: UUID,
    context: SchoolContext = Depends(require_school_context),
    db: Session = Depends(get_db),
):
    draft, action = load_draft(db, context, draft_id)
    return serialize_draft(db, draft, action)


@router.patch("/drafts/{draft_id}", response_model=DraftRead)
def update_draft(
    draft_id: UUID,
    payload: DraftWrite,
    context: SchoolContext = Depends(require_school_context),
    db: Session = Depends(get_db),
):
    require_staff(context)
    lock_school(db, context.school.id)
    draft, action = load_draft(db, context, draft_id)
    ensure_manage(db, action, context)
    if draft.revision != payload.expected_revision:
        raise HTTPException(
            status_code=409, detail="Message changed. Refresh it before saving again."
        )
    check_action_revision(action, payload.expected_action_revision)
    link = require_recipient(db, action, payload.guardian_link_id, payload.recipient_email)
    fields = {
        "guardian_link_id": link.id,
        "recipient_name": link.guardian.display_name,
        "recipient_email": link.guardian.email.strip(),
        "subject": payload.subject,
        "body": payload.body,
        "action_revision": action.revision,
    }
    # Re-review can replace an approval whose approver has since lost authorization.
    previous = serialize_draft(db, draft, action)
    changed = any(getattr(draft, key) != value for key, value in fields.items())
    if changed or (draft.approved_revision is not None and not previous.approval_effective):
        for key, value in fields.items():
            setattr(draft, key, value)
        draft.revision += 1
        draft.approved_revision = None
        draft.updated_by_user_id = context.user.id
        draft.updated_at = datetime.now(UTC)
        try:
            write_revision(db, draft, context, "message.revised")
            db.commit()
        except IntegrityError as exc:
            db.rollback()
            raise HTTPException(
                status_code=409, detail="This follow-up already has a draft for that guardian."
            ) from exc
    return serialize_draft(db, draft, action)


@router.post("/drafts/{draft_id}/approve", response_model=DraftRead)
def approve_draft(
    draft_id: UUID,
    payload: DraftApprove,
    context: SchoolContext = Depends(require_school_context),
    db: Session = Depends(get_db),
):
    require_staff(context)
    lock_school(db, context.school.id)
    draft, action = load_draft(db, context, draft_id)
    ensure_manage(db, action, context)
    if draft.revision != payload.expected_revision:
        raise HTTPException(
            status_code=409,
            detail="Message changed. Review the latest saved revision before approving.",
        )
    check_action_revision(action, payload.expected_action_revision)
    require_recipient(db, action, draft.guardian_link_id, payload.recipient_email)
    block = draft_block(db, draft, action)
    if block:
        raise HTTPException(status_code=409, detail=block)
    revision = db.get(MessageRevision, (draft.school_id, draft.id, draft.revision))
    if revision is None or any(
        getattr(revision, key) != getattr(draft, key)
        for key in (
            "guardian_link_id",
            "recipient_name",
            "recipient_email",
            "subject",
            "body",
            "action_revision",
        )
    ):
        raise HTTPException(
            status_code=409,
            detail="Stored revision does not match the draft. Approval was not recorded.",
        )
    if draft.approved_revision is not None:
        existing = serialize_draft(db, draft, action)
        if not existing.approval_effective:
            raise HTTPException(
                status_code=409, detail=existing.blocking_reason or "Approval is no longer valid"
            )
        return existing
    db.add(
        MessageApproval(
            school_id=draft.school_id,
            draft_id=draft.id,
            revision=draft.revision,
            approver_user_id=context.user.id,
            approved_at=datetime.now(UTC),
        )
    )
    draft.approved_revision = draft.revision
    message_history(db, draft, context, "message.approved")
    db.commit()
    return serialize_draft(db, draft, action)


@router.get("/drafts/{draft_id}/history", response_model=RevisionPage)
def get_history(
    draft_id: UUID,
    limit: int = Query(default=25, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    context: SchoolContext = Depends(require_school_context),
    db: Session = Depends(get_db),
):
    draft, _ = load_draft(db, context, draft_id)
    history = list(
        db.scalars(
            select(MessageRevision)
            .where(
                MessageRevision.school_id == context.school.id, MessageRevision.draft_id == draft.id
            )
            .order_by(MessageRevision.revision.desc())
            .offset(offset)
            .limit(limit + 1)
        )
    )
    approvals = {
        row.revision: row
        for row in db.scalars(
            select(MessageApproval).where(
                MessageApproval.school_id == context.school.id,
                MessageApproval.draft_id == draft.id,
                MessageApproval.revision.in_([revision.revision for revision in history[:limit]]),
            )
        )
    }
    revisions = []
    for row in history[:limit]:
        author = db.get(User, row.author_user_id) if row.author_user_id else None
        approval = approvals.get(row.revision)
        approver = (
            db.get(User, approval.approver_user_id)
            if approval and approval.approver_user_id
            else None
        )
        revisions.append(
            RevisionRead(
                revision=row.revision,
                recipient_name=row.recipient_name,
                recipient_email=row.recipient_email,
                subject=row.subject,
                body=row.body,
                action_revision=row.action_revision,
                author_name=author.display_name if author else None,
                created_at=row.created_at,
                approved_by_name=approver.display_name if approver else None,
                approved_at=approval.approved_at if approval else None,
            )
        )
    return RevisionPage(revisions=revisions, has_more=len(history) > limit)
