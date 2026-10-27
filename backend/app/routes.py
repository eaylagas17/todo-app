import uuid
from http import HTTPStatus
from typing import Annotated

import httpx
from fastapi import APIRouter, Depends, Response, status
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app import ai, crud, seed
from app.db import DbSession
from app.errors import ServiceUnavailable
from app.models import Category, Subtask, Task, User, UserSession
from app.schemas import (
    AuthOut,
    CategoryIn,
    CategoryOut,
    Credentials,
    ErrorOut,
    LinkIn,
    OrderIn,
    StatusOut,
    SubtaskCreate,
    SubtaskOut,
    SubtaskUpdate,
    TaskCreate,
    TaskOut,
    TaskUpdate,
    UserOut,
)
from app.security import current_session, current_user
from app.status import current_status

router = APIRouter(prefix="/api")
SignedInUser = Annotated[User, Depends(current_user)]


def errors(*codes: int) -> dict:
    """The error responses an endpoint can return, for the generated docs."""
    return {
        code: {"model": ErrorOut, "description": HTTPStatus(code).phrase}
        for code in codes
    }


def signed_in(db: Session, user: User) -> AuthOut:
    return AuthOut(
        user=UserOut.model_validate(user), token=crud.create_session(db, user)
    )


@router.post("/users", status_code=status.HTTP_201_CREATED, responses=errors(400, 409))
def register(credentials: Credentials, db: DbSession) -> AuthOut:
    return signed_in(db, crud.create_user(db, credentials.email, credentials.password))


@router.post(
    "/sessions", status_code=status.HTTP_201_CREATED, responses=errors(400, 401)
)
def sign_in(credentials: Credentials, db: DbSession) -> AuthOut:
    return signed_in(db, crud.authenticate(db, credentials.email, credentials.password))


@router.delete(
    "/sessions/current", status_code=status.HTTP_204_NO_CONTENT, responses=errors(401)
)
def sign_out(
    user_session: Annotated[UserSession, Depends(current_session)], db: DbSession
) -> None:
    crud.delete(db, user_session)


def owned_task(task_id: uuid.UUID, user: SignedInUser, db: DbSession) -> Task:
    return crud.get_task(db, user, task_id)


OwnedTask = Annotated[Task, Depends(owned_task)]


@router.get("/tasks", response_model=list[TaskOut], responses=errors(401))
def list_tasks(user: SignedInUser, db: DbSession) -> list[Task]:
    return crud.list_tasks(db, user)


@router.post(
    "/tasks",
    status_code=status.HTTP_201_CREATED,
    response_model=TaskOut,
    responses=errors(400, 401),
)
def create_task(
    new: TaskCreate, user: SignedInUser, db: DbSession, response: Response
) -> Task:
    task = crud.create_task(db, user, new.title, new.description)
    response.headers["Location"] = f"{router.prefix}/tasks/{task.id}"
    return task


@router.get("/tasks/{task_id}", response_model=TaskOut, responses=errors(400, 401, 404))
def get_task(task: OwnedTask) -> Task:
    return task


@router.patch(
    "/tasks/{task_id}", response_model=TaskOut, responses=errors(400, 401, 404)
)
def update_task(changes: TaskUpdate, task: OwnedTask, db: DbSession) -> Task:
    return crud.update_task(db, task, changes.model_dump(exclude_unset=True))


@router.delete(
    "/tasks/{task_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    responses=errors(400, 401, 404),
)
def delete_task(task: OwnedTask, db: DbSession) -> None:
    crud.delete(db, task)


@router.post(
    "/tasks/{task_id}/subtasks",
    status_code=status.HTTP_201_CREATED,
    response_model=SubtaskOut,
    responses=errors(400, 401, 404),
)
def add_subtask(new: SubtaskCreate, task: OwnedTask, db: DbSession) -> Subtask:
    return crud.add_subtask(db, task, new.title)


def owned_subtask(subtask_id: uuid.UUID, task: OwnedTask, db: DbSession) -> Subtask:
    return crud.get_subtask(db, task, subtask_id)


OwnedSubtask = Annotated[Subtask, Depends(owned_subtask)]


@router.patch(
    "/tasks/{task_id}/subtasks/{subtask_id}",
    response_model=SubtaskOut,
    responses=errors(400, 401, 404),
)
def update_subtask(
    changes: SubtaskUpdate, subtask: OwnedSubtask, db: DbSession
) -> Subtask:
    return crud.update_subtask(db, subtask, changes.model_dump(exclude_unset=True))


@router.delete(
    "/tasks/{task_id}/subtasks/{subtask_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    responses=errors(400, 401, 404),
)
def delete_subtask(subtask: OwnedSubtask, db: DbSession) -> None:
    crud.delete(db, subtask)


@router.post(
    "/tasks/{task_id}/links",
    status_code=status.HTTP_201_CREATED,
    response_model=list[TaskOut],
    responses=errors(400, 401, 404, 409),
)
def link_tasks(
    new: LinkIn, task: OwnedTask, user: SignedInUser, db: DbSession
) -> list[Task]:
    return crud.link(db, user, task, new.depends_on_id)


@router.delete(
    "/tasks/{task_id}/links/{depends_on_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    responses=errors(400, 401, 404),
)
def unlink_tasks(depends_on_id: uuid.UUID, task: OwnedTask, db: DbSession) -> None:
    crud.unlink(db, task, depends_on_id)


@router.put(
    "/task-order", response_model=list[TaskOut], responses=errors(400, 401, 409)
)
def set_order(order: OrderIn, user: SignedInUser, db: DbSession) -> list[Task]:
    return crud.set_order(db, user, order.ids)


@router.post(
    "/tasks/{task_id}/category-suggestion",
    response_model=TaskOut,
    responses=errors(400, 401, 404, 429, 503),
)
def suggest_category(
    task: OwnedTask,
    user: SignedInUser,
    db: DbSession,
    http: Annotated[httpx.Client, Depends(ai.get_http_client)],
) -> Task:
    return ai.suggest_category(db, user, task, http)


@router.post(
    "/examples",
    status_code=status.HTTP_201_CREATED,
    response_model=list[TaskOut],
    responses=errors(401),
)
def load_example(user: SignedInUser, db: DbSession) -> list[Task]:
    seed.add_example(db, user)
    return crud.list_tasks(db, user)


@router.get("/categories", response_model=list[CategoryOut], responses=errors(401))
def list_categories(user: SignedInUser, db: DbSession) -> list[Category]:
    return crud.list_categories(db, user)


@router.post(
    "/categories",
    status_code=status.HTTP_201_CREATED,
    response_model=CategoryOut,
    responses=errors(400, 401, 409),
)
def create_category(new: CategoryIn, user: SignedInUser, db: DbSession) -> Category:
    return crud.create_category(db, user, new.name)


def owned_category(
    category_id: uuid.UUID, user: SignedInUser, db: DbSession
) -> Category:
    return crud.get_category(db, user, category_id)


OwnedCategory = Annotated[Category, Depends(owned_category)]


@router.patch(
    "/categories/{category_id}",
    response_model=CategoryOut,
    responses=errors(400, 401, 404, 409),
)
def rename_category(
    changes: CategoryIn, category: OwnedCategory, db: DbSession
) -> Category:
    return crud.rename_category(db, category, changes.name)


@router.delete(
    "/categories/{category_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    responses=errors(400, 401, 404),
)
def delete_category(category: OwnedCategory, db: DbSession) -> None:
    crud.delete_category(db, category)


@router.get("/health", responses=errors(503))
def health(db: DbSession) -> dict[str, str]:
    try:
        db.execute(text("SELECT 1"))
    except SQLAlchemyError:
        raise ServiceUnavailable from None
    return {"status": "ok"}


@router.get("/status", response_model=StatusOut)
def get_status(db: DbSession) -> dict:
    """Public, with nothing secret: which version and which copy answered, and how it's doing."""
    return current_status(db)
