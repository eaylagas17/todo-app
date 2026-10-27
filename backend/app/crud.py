import secrets
import uuid
from collections import defaultdict
from datetime import timedelta

from sqlalchemy import func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from app.db import utcnow
from app.errors import (
    CategoryExists,
    CategoryNotFound,
    EmailTaken,
    InvalidCredentials,
    InvalidField,
    LinkCycle,
    LinkSelf,
    OrderBreaksLink,
    OrderStale,
    SubtaskNotFound,
    TaskNotFound,
)
from app.graph import breaks_link, find_path, repair
from app.models import Category, Subtask, Task, TaskLink, User, UserSession
from app.security import hash_token, hasher, verify_password

SESSION_LIFETIME = timedelta(days=7)
# Checking a password against this costs the same as a real check, so an unknown email takes
# as long to reject as a wrong password and response times don't reveal who has an account.
DUMMY_HASH = hasher.hash(secrets.token_urlsafe())
DEFAULT_CATEGORIES = ("Work", "Home", "Errands", "Health", "Finance")


def create_user(db: Session, email: str, password: str) -> User:
    user = User(email=email, password_hash=hasher.hash(password))
    db.add(user)
    try:
        db.flush()  # sends the INSERT, so a taken email fails here and user.id exists
    except IntegrityError:
        db.rollback()
        raise EmailTaken from None
    # In the same commit: an account never exists without its default categories.
    db.add_all(Category(owner_id=user.id, name=name) for name in DEFAULT_CATEGORIES)
    db.commit()
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
        .options(selectinload(Task.subtasks), selectinload(Task.links))
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
    category_id = changes.get("category_id")
    # An unknown id and someone else's id get the same answer, so ids can't be probed.
    if category_id is not None and not db.scalar(
        select(Category.id).where(
            Category.id == category_id, Category.owner_id == task.owner_id
        )
    ):
        raise InvalidField("category_id", "Category not found")
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


def owner_graph(db: Session, owner: User) -> dict[uuid.UUID, list[uuid.UUID]]:
    """Every link of one user as an adjacency list, task → what it waits for. One query."""
    rows = db.execute(
        select(TaskLink.task_id, TaskLink.depends_on_id)
        .join(Task, Task.id == TaskLink.task_id)
        .where(Task.owner_id == owner.id)
    )
    graph: dict[uuid.UUID, list[uuid.UUID]] = defaultdict(list)
    for task_id, depends_on_id in rows:
        graph[task_id].append(depends_on_id)
    return graph


def _renumber(tasks: list[Task], order: list[uuid.UUID]) -> None:
    by_id = {task.id: task for task in tasks}
    for position, task_id in enumerate(order, start=1):
        by_id[task_id].position = position


def link(db: Session, owner: User, task: Task, depends_on_id: uuid.UUID) -> list[Task]:
    """ "task waits for depends_on_id". Returns the whole list, in its (possibly repaired) order."""
    if depends_on_id == task.id:
        raise LinkSelf
    target = get_task(db, owner, depends_on_id)  # someone else's task is 404
    graph = owner_graph(db, owner)
    if target.id in graph[task.id]:
        return list_tasks(db, owner)  # already linked: nothing to do
    # A loop would form if the target already waits, step by step, for this task.
    if path := find_path(graph, target.id, task.id):
        rows = db.execute(select(Task.id, Task.title).where(Task.id.in_(path)))
        titles = {task_id: title for task_id, title in rows}
        raise LinkCycle([task.title, *(titles[i] for i in path)])
    db.add(TaskLink(task_id=task.id, depends_on_id=target.id))
    graph[task.id].append(target.id)
    tasks = list_tasks(db, owner)
    order = [t.id for t in tasks]
    if breaks_link(order, graph):
        # The task linked to stays put; the waiting task goes just below it, and anything
        # waiting on it is pushed along by the "down" pass (spec §8.3).
        desired = [i for i in order if i != task.id]
        desired.insert(desired.index(target.id) + 1, task.id)
        _renumber(tasks, repair(desired, graph, "down"))
    db.commit()
    return list_tasks(db, owner)


def unlink(db: Session, task: Task, depends_on_id: uuid.UUID) -> None:
    existing = db.get(TaskLink, (task.id, depends_on_id))
    if existing is not None:  # unlinking twice is fine
        delete(db, existing)


def set_order(
    db: Session, owner: User, ids: list[uuid.UUID], previous: list[uuid.UUID]
) -> list[Task]:
    """Saves the whole list's order. Checks it; never re-sorts it."""
    tasks = list_tasks(db, owner)
    if len(ids) != len(set(ids)) or set(ids) != {task.id for task in tasks}:
        raise OrderStale  # a task missing, extra, repeated or someone else's (E43)
    if previous != [task.id for task in tasks]:
        raise OrderStale  # the drag started from an order another tab has since changed
    if breaks_link(ids, owner_graph(db, owner)):
        raise OrderBreaksLink  # (E44)
    _renumber(tasks, ids)
    db.commit()
    return list_tasks(db, owner)


def list_categories(db: Session, owner: User) -> list[Category]:
    query = (
        select(Category)
        .where(Category.owner_id == owner.id)
        .order_by(Category.created_at, Category.id)
    )
    return list(db.scalars(query))


def _save_category(db: Session, category: Category) -> Category:
    try:
        db.commit()
    except IntegrityError:  # the unique index on (owner_id, lower(name))
        db.rollback()
        raise CategoryExists from None
    return category


def create_category(db: Session, owner: User, name: str) -> Category:
    category = Category(owner_id=owner.id, name=name)
    db.add(category)
    return _save_category(db, category)


def get_category(db: Session, owner: User, category_id: uuid.UUID) -> Category:
    category = db.scalar(
        select(Category).where(
            Category.id == category_id, Category.owner_id == owner.id
        )
    )
    if category is None:
        raise CategoryNotFound
    return category


def rename_category(db: Session, category: Category, name: str) -> Category:
    category.name = name
    return _save_category(db, category)


def delete_category(db: Session, category: Category) -> None:
    # Its tasks become uncategorised first, in code, so SQLite (whose foreign-key actions are
    # off by default) behaves like Postgres's ON DELETE SET NULL.
    db.execute(
        update(Task).where(Task.category_id == category.id).values(category_id=None)
    )
    delete(db, category)


def delete(
    db: Session, row: Task | Subtask | Category | TaskLink | UserSession
) -> None:
    db.delete(row)
    db.commit()
