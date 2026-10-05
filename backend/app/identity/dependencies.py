from dataclasses import dataclass
from datetime import UTC, datetime

from fastapi import Cookie, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.core.config import Settings, get_settings
from app.db.models import School, SchoolMembership, User, UserSession
from app.db.session import get_db
from app.identity.security import hash_session_token


@dataclass(frozen=True)
class AuthContext:
    user: User
    session: UserSession


@dataclass(frozen=True)
class SchoolContext:
    user: User
    session: UserSession
    school: School
    membership: SchoolMembership


def as_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)


def get_optional_auth_context(
    session_token: str | None = Cookie(default=None, alias="schoolos_session"),
    db: Session = Depends(get_db),
) -> AuthContext | None:
    if not session_token:
        return None

    token_hash = hash_session_token(session_token)
    user_session = db.scalar(
        select(UserSession)
        .where(UserSession.token_hash == token_hash)
        .options(selectinload(UserSession.user))
    )
    if user_session is None:
        return None

    now = datetime.now(UTC)
    is_revoked = user_session.revoked_at is not None and as_utc(user_session.revoked_at) <= now
    if is_revoked or as_utc(user_session.expires_at) <= now:
        return None

    if user_session.user.status != "ACTIVE":
        return None

    return AuthContext(user=user_session.user, session=user_session)


def require_auth(
    context: AuthContext | None = Depends(get_optional_auth_context),
) -> AuthContext:
    if context is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required",
        )
    return context


def require_school_context(
    context: AuthContext = Depends(require_auth),
    db: Session = Depends(get_db),
) -> SchoolContext:
    if context.session.current_school_id is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No school selected",
        )

    membership = db.scalar(
        select(SchoolMembership)
        .where(
            SchoolMembership.user_id == context.user.id,
            SchoolMembership.school_id == context.session.current_school_id,
            SchoolMembership.status == "ACTIVE",
        )
        .options(selectinload(SchoolMembership.school))
    )
    if membership is None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Selected school is not available to this user",
        )

    return SchoolContext(
        user=context.user,
        session=context.session,
        school=membership.school,
        membership=membership,
    )


def get_cookie_kwargs(settings: Settings = Depends(get_settings)) -> dict[str, object]:
    return {
        "key": settings.session_cookie_name,
        "httponly": True,
        "secure": settings.secure_cookies,
        "samesite": "lax",
        "path": "/",
    }
