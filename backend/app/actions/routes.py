from datetime import UTC, datetime
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session, selectinload

from app.actions.access import eligible_assignees, require_student_scope, visible_student_ids
from app.actions.schemas import (
    ActionPage,
    ActionRead,
    ActionWrite,
    AssigneeRead,
    PolicyWrite,
    TimelinePage,
    TimelineRead,
)
from app.actions.service import (
    ACTIVE_STATUSES,
    action_history,
    lock_school,
    policy_for_school,
    recompute_student,
)
from app.db.models import ActionItem, AttendancePolicy, AuditEntry, Student, TimelineEntry
from app.db.session import get_db
from app.identity.dependencies import SchoolContext, require_school_context
from app.students.routes import ensure_student_access

router = APIRouter(prefix="/api/v1/actions", tags=["actions"])
timeline_router = APIRouter(prefix="/api/v1/timeline", tags=["timeline"])


def serialize_action(action: ActionItem) -> ActionRead:
    return ActionRead(
        id=action.id,
        student_id=action.student_id,
        student_name=f"{action.student.given_name} {action.student.family_name}",
        student_number=action.student.student_number,
        rule_key=action.rule_key,
        status=action.status,
        assignee_user_id=action.assignee_user_id,
        assignee_name=action.assignee.display_name if action.assignee else None,
        window_end=action.window_end,
        threshold=action.threshold,
        window_days=action.window_days,
        evidence=action.evidence,
        qualifies=action.qualifies,
        revision=action.revision,
        resolution_reason=action.resolution_reason,
        closed_at=action.closed_at,
        created_at=action.created_at,
        updated_at=action.updated_at,
    )


def scoped_actions(db: Session, context: SchoolContext):
    allowed = visible_student_ids(db, context)
    query = select(ActionItem).where(ActionItem.school_id == context.school.id)
    if allowed is not None:
        query = query.where(ActionItem.student_id.in_(allowed))
    return query


def load_action(db: Session, context: SchoolContext, action_id: UUID) -> ActionItem:
    action = db.scalar(
        scoped_actions(db, context)
        .where(ActionItem.id == action_id)
        .options(selectinload(ActionItem.student), selectinload(ActionItem.assignee))
        .execution_options(populate_existing=True)
    )
    if action is None:
        raise HTTPException(status_code=404, detail="Action not found")
    return action


@router.get("/policy", response_model=PolicyWrite)
def get_policy(
    context: SchoolContext = Depends(require_school_context), db: Session = Depends(get_db)
):
    visible_student_ids(db, context)
    policy = db.get(AttendancePolicy, context.school.id)
    return PolicyWrite.model_validate(policy) if policy else PolicyWrite()


@router.put("/policy", response_model=PolicyWrite)
def update_policy(
    payload: PolicyWrite,
    context: SchoolContext = Depends(require_school_context),
    db: Session = Depends(get_db),
):
    if context.membership.role != "ADMIN":
        raise HTTPException(status_code=403, detail="Only admins may change the attendance rule")
    school = lock_school(db, context.school.id)
    policy = policy_for_school(db, school.id)
    before = PolicyWrite.model_validate(policy).model_dump()
    after = payload.model_dump()
    if before != after:
        policy.enabled, policy.threshold, policy.window_days = (
            payload.enabled,
            payload.threshold,
            payload.window_days,
        )
        db.add(
            AuditEntry(
                school_id=school.id,
                actor_user_id=context.user.id,
                operation="attendance_policy.updated",
                target_type="AttendancePolicy",
                target_id=school.id,
                changes={"before": before, "after": after},
                occurred_at=datetime.now(UTC),
            )
        )
        for student in db.scalars(select(Student).where(Student.school_id == school.id)):
            recompute_student(db, school, student, policy, actor_id=context.user.id)
        db.commit()
    return payload


@router.get("/assignees", response_model=list[AssigneeRead])
def list_assignees(
    student_id: UUID,
    context: SchoolContext = Depends(require_school_context),
    db: Session = Depends(get_db),
):
    require_student_scope(db, context, student_id)
    return eligible_assignees(db, context.school, student_id)


@router.get("", response_model=ActionPage)
def list_actions(
    status_filter: Literal[
        "ACTIVE", "OPEN", "IN_PROGRESS", "RESOLVED", "DISMISSED", "CLOSED", "ALL"
    ] = "ACTIVE",
    owner: Literal["ALL", "ME", "UNASSIGNED"] = "ALL",
    q: str = Query(default="", max_length=200),
    limit: int = Query(default=25, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    context: SchoolContext = Depends(require_school_context),
    db: Session = Depends(get_db),
) -> ActionPage:
    base = scoped_actions(db, context)
    counts = {key: 0 for key in ("OPEN", "IN_PROGRESS", "RESOLVED", "DISMISSED")}
    count_source = base.subquery()
    counts.update(
        dict(
            db.execute(
                select(count_source.c.status, func.count()).group_by(count_source.c.status)
            ).all()
        )
    )
    query = base.join(Student, Student.id == ActionItem.student_id)
    if status_filter == "ACTIVE":
        query = query.where(ActionItem.status.in_(ACTIVE_STATUSES))
    elif status_filter == "CLOSED":
        query = query.where(ActionItem.status.in_({"RESOLVED", "DISMISSED"}))
    elif status_filter != "ALL":
        query = query.where(ActionItem.status == status_filter)
    if owner == "ME":
        query = query.where(ActionItem.assignee_user_id == context.user.id)
    elif owner == "UNASSIGNED":
        query = query.where(ActionItem.assignee_user_id.is_(None))
    if q.strip():
        search = f"%{q.strip()}%"
        query = query.where(
            or_(
                Student.given_name.ilike(search),
                Student.family_name.ilike(search),
                Student.student_number.ilike(search),
            )
        )
    total = db.scalar(select(func.count()).select_from(query.subquery())) or 0
    items = list(
        db.scalars(
            query.options(selectinload(ActionItem.student), selectinload(ActionItem.assignee))
            .order_by(ActionItem.updated_at.desc(), ActionItem.id.desc())
            .offset(offset)
            .limit(limit)
        )
    )
    return ActionPage(
        items=[serialize_action(item) for item in items],
        total=total,
        counts=counts,
        has_more=offset + len(items) < total,
    )


@router.get("/{action_id}", response_model=ActionRead)
def get_action(
    action_id: UUID,
    context: SchoolContext = Depends(require_school_context),
    db: Session = Depends(get_db),
):
    return serialize_action(load_action(db, context, action_id))


@router.patch("/{action_id}", response_model=ActionRead)
def update_action(
    action_id: UUID,
    payload: ActionWrite,
    context: SchoolContext = Depends(require_school_context),
    db: Session = Depends(get_db),
):
    visible_student_ids(db, context)
    lock_school(db, context.school.id)
    action = load_action(db, context, action_id)
    if action.revision != payload.expected_revision:
        raise HTTPException(
            status_code=409, detail="Action changed. Refresh it before saving again."
        )
    if action.status not in ACTIVE_STATUSES:
        raise HTTPException(status_code=409, detail="Closed actions cannot be changed")
    assignee = (
        payload.assignee_user_id
        if "assignee_user_id" in payload.model_fields_set
        else action.assignee_user_id
    )
    if context.membership.role == "TEACHER":
        if action.assignee_user_id not in {None, context.user.id} or assignee != context.user.id:
            raise HTTPException(
                status_code=403,
                detail="Teachers may claim unassigned actions or update their own actions",
            )
    if assignee is not None and assignee != action.assignee_user_id:
        if not any(
            user.id == assignee
            for user in eligible_assignees(db, context.school, action.student_id)
        ):
            raise HTTPException(
                status_code=400, detail="Assignee must be an active teacher for this student"
            )
    before = {
        "status": action.status,
        "assignee_user_id": str(action.assignee_user_id) if action.assignee_user_id else None,
    }
    next_status = payload.status or action.status
    after = {"status": next_status, "assignee_user_id": str(assignee) if assignee else None}
    if before != after:
        action.status, action.assignee_user_id = next_status, assignee
        action.revision += 1
        action.updated_at = datetime.now(UTC)
        if next_status in {"RESOLVED", "DISMISSED"}:
            action.closed_at, action.resolution_reason = action.updated_at, payload.reason
        action_history(
            db,
            action,
            "action.updated",
            f"Follow-up is now {next_status.lower().replace('_', ' ')}.",
            {"before": before, "after": after, "reason": payload.reason},
            context.user.id,
        )
        db.commit()
    return serialize_action(load_action(db, context, action_id))


@timeline_router.get("/students/{student_id}", response_model=TimelinePage)
def get_timeline(
    student_id: UUID,
    limit: int = Query(default=25, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    context: SchoolContext = Depends(require_school_context),
    db: Session = Depends(get_db),
):
    if context.membership.role == "GUARDIAN":
        ensure_student_access(db, context, student_id)
        visibility = {"GUARDIAN"}
    else:
        require_student_scope(db, context, student_id)
        visibility = (
            {"GUARDIAN", "STAFF", "INTERNAL"}
            if context.membership.role == "ADMIN"
            else {"GUARDIAN", "STAFF"}
        )
    entries = list(
        db.scalars(
            select(TimelineEntry)
            .where(
                TimelineEntry.school_id == context.school.id,
                TimelineEntry.student_id == student_id,
                TimelineEntry.visibility.in_(visibility),
            )
            .order_by(TimelineEntry.occurred_at.desc(), TimelineEntry.id.desc())
            .offset(offset)
            .limit(limit + 1)
        )
    )
    return TimelinePage(
        entries=[TimelineRead.model_validate(entry) for entry in entries[:limit]],
        has_more=len(entries) > limit,
    )
