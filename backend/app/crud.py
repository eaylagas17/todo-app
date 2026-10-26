import secrets
from datetime import timedelta

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.db import utcnow
from app.errors import EmailTaken, InvalidCredentials
from app.models import User, UserSession
from app.security import hash_password, hash_token, verify_password

SESSION_LIFETIME = timedelta(days=7)
# Checking a password against this costs the same as a real check, so an unknown email takes
# as long to reject as a wrong password and response times don't reveal who has an account.
DUMMY_HASH = hash_password(secrets.token_urlsafe())


def create_user(db: Session, email: str, password: str) -> User:
    user = User(email=email, password_hash=hash_password(password))
    db.add(user)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise EmailTaken from None
    return user


def authenticate(db: Session, email: str, password: str) -> User:
    user = db.scalar(select(User).where(User.email == email))
    password_ok = verify_password(password, user.password_hash if user else DUMMY_HASH)
    if user is None or not password_ok:
        raise InvalidCredentials
    return user


def create_session(db: Session, user: User) -> str:
    token = secrets.token_urlsafe(32)
    expires_at = utcnow() + SESSION_LIFETIME
    db.add(
        UserSession(
            token_hash=hash_token(token), user_id=user.id, expires_at=expires_at
        )
    )
    db.commit()
    return token


def delete_session(db: Session, user_session: UserSession) -> None:
    db.delete(user_session)
    db.commit()
