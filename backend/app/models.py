import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, String, Text, func
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

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    owner_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE")
    )
    title: Mapped[str] = mapped_column(String(200))
    description: Mapped[str] = mapped_column(Text, default="")
    completed: Mapped[bool] = mapped_column(default=False)
    position: Mapped[float]
    category_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("categories.id", ondelete="SET NULL")
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow
    )
    # Deleting a task deletes its subtasks: the ORM does it, so SQLite needs no foreign-key pragma.
    subtasks: Mapped[list[Subtask]] = relationship(
        order_by="Subtask.created_at", cascade="all, delete-orphan"
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
