import os
import sqlite3
from collections.abc import Iterator
from datetime import UTC, datetime
from typing import Annotated

from fastapi import Depends
from sqlalchemy import Engine, create_engine, event
from sqlalchemy.orm import DeclarativeBase, Session

DATABASE_URL = os.environ.get("DATABASE_URL", "sqlite:///./todo.db")

engine = create_engine(
    DATABASE_URL,
    connect_args={"check_same_thread": False}
    if DATABASE_URL.startswith("sqlite")
    else {},
)


# SQLite ignores foreign keys unless each connection asks: with this, ON DELETE CASCADE and
# SET NULL work there as they do on Postgres. For every engine, the tests' included.
@event.listens_for(Engine, "connect")
def _foreign_keys(connection, _record) -> None:
    if isinstance(connection, sqlite3.Connection):
        connection.execute("PRAGMA foreign_keys = ON")


class Base(DeclarativeBase):
    pass


def get_session() -> Iterator[Session]:
    with Session(engine) as session:
        yield session


DbSession = Annotated[Session, Depends(get_session)]


def utcnow() -> datetime:
    return datetime.now(UTC)
