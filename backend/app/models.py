import uuid
from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base, utcnow


class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    email: Mapped[str] = mapped_column(String(254), unique=True)
    password_hash: Mapped[str]


class UserSession(Base):
    __tablename__ = "sessions"

    token_hash: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    # timestamptz on Postgres. SQLite drops the offset, which is harmless because every value
    # is UTC and expiry is only ever compared inside SQL.
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    # Loaded in the same query as the session, so finding the signed-in user costs one query.
    user: Mapped[User] = relationship(lazy="joined")


class Task(Base):
    __tablename__ = "tasks"
    # A user's list in order is one range scan of this index, and so is MAX(position).
    __table_args__ = (Index("ix_tasks_owner_position", "owner_id", "position"),)

    # UUIDv7: ids grow with creation time, so the smallest id in a group is its oldest task.
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid7)
    owner_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE")
    )
    # v1.0 called the task's text "description"; the column keeps that name, so v1.0 still
    # reads and writes every task after a rollback. Renaming it waits until v1.0 is retired.
    title: Mapped[str] = mapped_column("description", Text)
    # New in v1.1. The database's default fills it in when v1.0 adds a task.
    description: Mapped[str] = mapped_column(
        "details", Text, default="", server_default=""
    )
    completed: Mapped[bool] = mapped_column(default=False)
    position: Mapped[float]
    category_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("categories.id", ondelete="SET NULL")
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow
    )
    # When it was last ticked off; None while it's open. Sorts Recently completed.
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    subtasks: Mapped[list[Subtask]] = relationship(
        order_by="Subtask.created_at", cascade="all, delete-orphan"
    )
    # What this task waits for. Links pointing at it are removed by the database (ON DELETE
    # CASCADE), so none is ever left pointing at a task that's gone (E45).
    links: Mapped[list[TaskLink]] = relationship(
        foreign_keys="TaskLink.task_id", cascade="all, delete-orphan"
    )

    @property
    def waits_for(self) -> list[uuid.UUID]:
        return [link.depends_on_id for link in self.links]


class TaskLink(Base):
    """One edge: task_id waits for depends_on_id. The primary key makes each pair unique."""

    __tablename__ = "task_links"
    __table_args__ = (
        CheckConstraint("task_id <> depends_on_id", name="ck_task_links_not_self"),
    )

    task_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("tasks.id", ondelete="CASCADE"), primary_key=True
    )
    # Its own index: "who waits for this task?" is a lookup by depends_on_id.
    depends_on_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("tasks.id", ondelete="CASCADE"), primary_key=True, index=True
    )


class Subtask(Base):
    __tablename__ = "subtasks"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    task_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("tasks.id", ondelete="CASCADE"), index=True
    )
    title: Mapped[str] = mapped_column(String(200))
    completed: Mapped[bool] = mapped_column(default=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow
    )


class Category(Base):
    __tablename__ = "categories"

    # UUIDv7 ids grow with time, so the five default categories, created in the same
    # millisecond, still list in the order they were made.
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid7)
    owner_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE")
    )
    name: Mapped[str] = mapped_column(String(40))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow
    )


# Unique per owner ignoring case: "Wedding" and "wedding" can't both exist (E36). The same index
# serves listing a user's categories.
Index(
    "ix_categories_owner_name",
    Category.owner_id,
    func.lower(Category.name),
    unique=True,
)


class AiCall(Base):
    """One request to the AI, kept to enforce the limits. No task column: deleting a task must
    never shrink what was spent."""

    __tablename__ = "ai_calls"
    __table_args__ = (
        Index("ix_ai_calls_user_at", "user_id", "at"),
        Index("ix_ai_calls_at", "at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE")
    )
    at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    input_tokens: Mapped[int] = mapped_column(default=0)
