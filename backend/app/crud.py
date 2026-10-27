import secrets
import uuid
from datetime import timedelta

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from app.db import utcnow
from app.errors import EmailTaken, InvalidCredentials, SubtaskNotFound, TaskNotFound
from app.models import Subtask, Task, User, UserSession
from app.security import hash_token, hasher, verify_password

SESSION_LIFETIME = timedelta(days=7)
# Checking a password against this costs the same as a real check, so an unknown email takes
# as long to reject as a wrong password and response times don't reveal who has an account.
DUMMY_HASH = hasher.hash(secrets.token_urlsafe())


def create_user(db: Session, email: str, password: str) -> User:
    user = User(email=email, password_hash=hasher.hash(password))
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


def list_tasks(db: Session, owner: User) -> list[Task]:
    query = (
        select(Task)
        .where(Task.owner_id == owner.id)
        .order_by(Task.position, Task.created_at)
        # All the subtasks in one more query (WHERE task_id IN ...), never one query per task.
        .options(selectinload(Task.subtasks))
    )
    return list(db.scalars(query))


def create_task(db: Session, owner: User, title: str, description: str = "") -> Task:
    # Two requests at once can read the same MAX and get the same position. The tie is harmless
    # (created_at orders them); the fix is to lock the owner's row (SELECT ... FOR UPDATE) first.
    top = db.scalar(select(func.max(Task.position)).where(Task.owner_id == owner.id))
    task = Task(
        owner_id=owner.id,
        title=title,
        description=description,
        position=(top or 0) + 1,
    )
    db.add(task)
    db.commit()
    return task


def get_task(db: Session, owner: User, task_id: uuid.UUID) -> Task:
    task = db.scalar(select(Task).where(Task.id == task_id, Task.owner_id == owner.id))
    if task is None:
        raise TaskNotFound
    return task


def update_task(db: Session, task: Task, changes: dict) -> Task:
    for field, value in changes.items():
        setattr(task, field, value)
    db.commit()
    return task


def add_subtask(db: Session, task: Task, title: str) -> Subtask:
    subtask = Subtask(task_id=task.id, title=title)
    db.add(subtask)
    db.commit()
    return subtask


def get_subtask(db: Session, task: Task, subtask_id: uuid.UUID) -> Subtask:
    # Scoped by its task, which is already scoped by its owner: a subtask id from another task,
    # mine or not, is not found.
    subtask = db.scalar(
        select(Subtask).where(Subtask.id == subtask_id, Subtask.task_id == task.id)
    )
    if subtask is None:
        raise SubtaskNotFound
    return subtask


def update_subtask(db: Session, subtask: Subtask, changes: dict) -> Subtask:
    for field, value in changes.items():
        setattr(subtask, field, value)
    db.commit()
    return subtask


def delete(db: Session, row: Task | Subtask | UserSession) -> None:
    db.delete(row)
    db.commit()
