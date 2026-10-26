import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Response, status
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app import crud
from app.db import DbSession
from app.errors import ServiceUnavailable
from app.models import Task, User, UserSession
from app.schemas import AuthOut, Credentials, TaskCreate, TaskOut, TaskUpdate, UserOut
from app.security import current_session, current_user

router = APIRouter(prefix="/api")
SignedInUser = Annotated[User, Depends(current_user)]


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


def owned_task(task_id: uuid.UUID, user: SignedInUser, db: DbSession) -> Task:
    return crud.get_task(db, user, task_id)


OwnedTask = Annotated[Task, Depends(owned_task)]


@router.get("/tasks", response_model=list[TaskOut])
def list_tasks(user: SignedInUser, db: DbSession) -> list[Task]:
    return crud.list_tasks(db, user)


@router.post("/tasks", status_code=status.HTTP_201_CREATED, response_model=TaskOut)
def create_task(
    new: TaskCreate, user: SignedInUser, db: DbSession, response: Response
) -> Task:
    task = crud.create_task(db, user, new.description)
    response.headers["Location"] = f"{router.prefix}/tasks/{task.id}"
    return task


@router.get("/tasks/{task_id}", response_model=TaskOut)
def get_task(task: OwnedTask) -> Task:
    return task


@router.patch("/tasks/{task_id}", response_model=TaskOut)
def update_task(changes: TaskUpdate, task: OwnedTask, db: DbSession) -> Task:
    return crud.update_task(db, task, changes.model_dump(exclude_unset=True))


@router.delete("/tasks/{task_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_task(task: OwnedTask, db: DbSession) -> None:
    crud.delete_task(db, task)


@router.get("/health")
def health(db: DbSession) -> dict[str, str]:
    try:
        db.execute(text("SELECT 1"))
    except SQLAlchemyError:
        raise ServiceUnavailable from None
    return {"status": "ok"}
