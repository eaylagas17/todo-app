import hashlib
from typing import Annotated

from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError
from fastapi import Depends
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select

from app.db import DbSession, utcnow
from app.errors import AuthRequired
from app.models import User, UserSession

hasher = PasswordHasher()
bearer = HTTPBearer(auto_error=False)


def verify_password(plain: str, hashed: str) -> bool:
    try:
        return hasher.verify(hashed, plain)
    except VerifyMismatchError:
        return False


def hash_token(raw: str) -> str:
    return hashlib.sha256(raw.encode()).hexdigest()


def current_session(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)],
    db: DbSession,
) -> UserSession:
    if credentials is None:
        raise AuthRequired
    user_session = db.scalar(
        select(UserSession).where(
            UserSession.token_hash == hash_token(credentials.credentials),
            UserSession.expires_at > utcnow(),
        )
    )
    if user_session is None:
        raise AuthRequired
    return user_session


def current_user(
    user_session: Annotated[UserSession, Depends(current_session)],
) -> User:
    return user_session.user
