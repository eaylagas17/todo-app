from typing import Annotated

from fastapi import APIRouter, Depends, status
from sqlalchemy.orm import Session

from app import crud
from app.db import DbSession
from app.models import User, UserSession
from app.schemas import AuthOut, Credentials, UserOut
from app.security import current_session

router = APIRouter(prefix="/api")


def signed_in(db: Session, user: User) -> AuthOut:
    return AuthOut(
        user=UserOut.model_validate(user), token=crud.create_session(db, user)
    )


@router.post("/users", status_code=status.HTTP_201_CREATED)
def register(credentials: Credentials, db: DbSession) -> AuthOut:
    return signed_in(db, crud.create_user(db, credentials.email, credentials.password))


@router.post("/sessions", status_code=status.HTTP_201_CREATED)
def sign_in(credentials: Credentials, db: DbSession) -> AuthOut:
    return signed_in(db, crud.authenticate(db, credentials.email, credentials.password))


@router.delete("/sessions/current", status_code=status.HTTP_204_NO_CONTENT)
def sign_out(
    user_session: Annotated[UserSession, Depends(current_session)], db: DbSession
) -> None:
    crud.delete_session(db, user_session)
