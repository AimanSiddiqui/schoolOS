from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from app.core.config import Settings, get_settings
from app.db.models import School, SchoolMembership, User, UserSession
from app.db.session import get_db
from app.identity.dependencies import (
    AuthContext,
    SchoolContext,
    get_cookie_kwargs,
    get_optional_auth_context,
    require_auth,
    require_school_context,
)
from app.identity.schemas import (
    LoginRequest,
    MembershipSummary,
    OnboardRequest,
    SchoolSummary,
    SelectSchoolRequest,
    SessionResponse,
    UserSummary,
)
from app.identity.security import (
    create_session_token,
    hash_password,
    hash_session_token,
    verify_password,
)

router = APIRouter(prefix="/api/v1/auth", tags=["identity"])


def normalize_email(email: str) -> str:
    return email.strip().lower()


def build_session_response(
    user: User,
    session: UserSession,
    memberships: list[SchoolMembership],
) -> SessionResponse:
    current_membership = next(
        (
            membership
            for membership in memberships
            if membership.school_id == session.current_school_id
        ),
        None,
    )
    return SessionResponse(
        authenticated=True,
        user=UserSummary.model_validate(user),
        memberships=[
            MembershipSummary(
                school=SchoolSummary.model_validate(membership.school),
                role=membership.role,
            )
            for membership in memberships
        ],
        current_school=(
            SchoolSummary.model_validate(current_membership.school) if current_membership else None
        ),
        current_role=current_membership.role if current_membership else None,
    )


def active_memberships(db: Session, user_id: object) -> list[SchoolMembership]:
    return list(
        db.scalars(
            select(SchoolMembership)
            .where(
                SchoolMembership.user_id == user_id,
                SchoolMembership.status == "ACTIVE",
            )
            .options(selectinload(SchoolMembership.school))
            .order_by(SchoolMembership.created_at)
        )
    )


def attach_session_cookie(
    response: Response,
    token: str,
    expires_at: datetime,
    cookie_kwargs: dict[str, object],
) -> None:
    response.set_cookie(
        value=token,
        expires=expires_at,
        **cookie_kwargs,
    )


def create_user_session(
    db: Session,
    user: User,
    current_school_id: object | None,
    settings: Settings,
) -> tuple[str, UserSession]:
    token = create_session_token()
    session = UserSession(
        user_id=user.id,
        token_hash=hash_session_token(token),
        current_school_id=current_school_id,
        expires_at=datetime.now(UTC) + timedelta(days=settings.session_days),
    )
    db.add(session)
    db.flush()
    return token, session


@router.post("/onboard", status_code=status.HTTP_201_CREATED, response_model=SessionResponse)
def onboard(
    payload: OnboardRequest,
    response: Response,
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
    cookie_kwargs: dict[str, object] = Depends(get_cookie_kwargs),
) -> SessionResponse:
    existing_school_count = db.scalar(select(func.count(School.id))) or 0
    if existing_school_count > 0:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Onboarding is only available before the first school exists",
        )

    email = normalize_email(payload.admin_email)
    school = School(
        name=payload.school_name.strip(),
        timezone=payload.timezone.strip(),
        language=payload.language.strip(),
        working_days={"days": ["MON", "TUE", "WED", "THU", "FRI"]},
    )
    user = User(
        email=email,
        display_name=payload.admin_name.strip(),
        password_hash=hash_password(payload.admin_password),
    )
    membership = SchoolMembership(school=school, user=user, role="ADMIN")
    db.add_all([school, user, membership])

    try:
        db.flush()
        token, user_session = create_user_session(db, user, school.id, settings)
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A user with that email already exists",
        ) from exc

    attach_session_cookie(response, token, user_session.expires_at, cookie_kwargs)
    membership.school = school
    return build_session_response(user, user_session, [membership])


@router.post("/login", response_model=SessionResponse)
def login(
    payload: LoginRequest,
    response: Response,
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
    cookie_kwargs: dict[str, object] = Depends(get_cookie_kwargs),
) -> SessionResponse:
    user = db.scalar(select(User).where(User.email == normalize_email(payload.email)))
    valid_password = user is not None and verify_password(payload.password, user.password_hash)
    if user is None or user.status != "ACTIVE" or not valid_password:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password",
        )

    memberships = active_memberships(db, user.id)
    current_school_id = memberships[0].school_id if len(memberships) == 1 else None
    token, user_session = create_user_session(db, user, current_school_id, settings)
    db.commit()

    attach_session_cookie(response, token, user_session.expires_at, cookie_kwargs)
    return build_session_response(user, user_session, memberships)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(
    response: Response,
    context: AuthContext | None = Depends(get_optional_auth_context),
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> Response:
    response.status_code = status.HTTP_204_NO_CONTENT
    if context is not None:
        context.session.revoked_at = datetime.now(UTC)
        db.commit()

    response.delete_cookie(
        key=settings.session_cookie_name,
        path="/",
        samesite="lax",
        secure=settings.secure_cookies,
        httponly=True,
    )
    return response


@router.get("/session", response_model=SessionResponse)
def get_session(
    context: AuthContext | None = Depends(get_optional_auth_context),
    db: Session = Depends(get_db),
) -> SessionResponse:
    if context is None:
        return SessionResponse(authenticated=False)
    return build_session_response(
        context.user,
        context.session,
        active_memberships(db, context.user.id),
    )


@router.post("/select-school", response_model=SessionResponse)
def select_school(
    payload: SelectSchoolRequest,
    context: AuthContext = Depends(require_auth),
    db: Session = Depends(get_db),
) -> SessionResponse:
    memberships = active_memberships(db, context.user.id)
    selected = next(
        (membership for membership in memberships if membership.school_id == payload.school_id),
        None,
    )
    if selected is None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="User is not a member of that school",
        )

    context.session.current_school_id = selected.school_id
    db.commit()
    return build_session_response(context.user, context.session, memberships)


@router.get("/memberships", response_model=list[MembershipSummary])
def get_memberships(
    context: AuthContext = Depends(require_auth),
    db: Session = Depends(get_db),
) -> list[MembershipSummary]:
    return [
        MembershipSummary(school=SchoolSummary.model_validate(item.school), role=item.role)
        for item in active_memberships(db, context.user.id)
    ]


@router.get("/current-school", response_model=MembershipSummary)
def get_current_school(
    context: SchoolContext = Depends(require_school_context),
) -> MembershipSummary:
    return MembershipSummary(
        school=SchoolSummary.model_validate(context.school),
        role=context.membership.role,
    )
