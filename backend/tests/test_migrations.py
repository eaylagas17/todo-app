"""The schema comes from migrations: on a new database, on the one v1.0 made, and back again.

A rollback sends traffic to v1.0 on the newer schema, so every change since v1.0 only adds
(a table, a column with a default): v1.0's reads and writes must keep working.
"""

import multiprocessing
import os
import uuid
from datetime import UTC, datetime

import pytest
from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from sqlalchemy import (
    DateTime,
    Uuid,
    column,
    create_engine,
    delete,
    insert,
    select,
    table,
    text,
)
from sqlalchemy.orm import Session

from app.crud import DEFAULT_CATEGORIES
from app.db import Base
from app.migrate import migrate
from app.models import Category, Subtask, Task, TaskLink, User

# The two tables as v1.0 sees them: only the columns it knows.
V1_0_USERS = table(
    "users", column("id", Uuid), column("email"), column("password_hash")
)
V1_0_TASKS = table(
    "tasks",
    column("id", Uuid),
    column("owner_id", Uuid),
    column("description"),
    column("completed"),
    column("position"),
    column("created_at", DateTime(timezone=True)),
)


@pytest.fixture
def empty(engine):
    """The test database with no tables, as a new deployment finds it."""
    Base.metadata.drop_all(engine)
    yield engine
    with engine.begin() as connection:
        connection.execute(text("DROP TABLE IF EXISTS alembic_version"))


def v1_0_task(owner_id, description):
    return insert(V1_0_TASKS).values(
        id=uuid.uuid4(),
        owner_id=owner_id,
        description=description,
        completed=False,
        position=1.0,
        created_at=datetime.now(UTC),
    )


def test_migrations_build_the_schema_the_models_describe(empty):
    migrate(empty)
    migrate(empty)  # the next start finds nothing to do
    with empty.connect() as connection:
        context = MigrationContext.configure(connection)
        assert compare_metadata(context, Base.metadata) == []


def test_a_v1_0_database_is_upgraded_in_place(empty):
    # v1.0 made its tables with create_all, so they carry no version number.
    migrate(empty, "0001")
    with empty.begin() as connection:
        connection.execute(text("DROP TABLE alembic_version"))
        ada = uuid.uuid4()
        connection.execute(
            insert(V1_0_USERS).values(
                id=ada, email="ada@example.com", password_hash="x"
            )
        )
        connection.execute(v1_0_task(ada, "Water the plants"))

    migrate(empty)

    with Session(empty) as db:
        task = db.scalars(select(Task)).one()
        assert (task.title, task.description) == ("Water the plants", "")
        assert (task.category_id, task.completed_at, task.links) == (None, None, [])
        names = db.scalars(select(Category.name).order_by(Category.id)).all()
        assert names == list(DEFAULT_CATEGORIES)


def test_v1_0_still_works_on_the_new_schema(empty):
    migrate(empty)
    with Session(empty) as db:
        ada = User(email="ada@example.com", password_hash="x")
        db.add(ada)
        db.flush()
        venue = Task(owner_id=ada.id, title="Book the venue", position=1)
        cards = Task(owner_id=ada.id, title="Send invitations", position=2)
        venue.subtasks = [Subtask(title="Visit on Saturday")]
        db.add_all([venue, cards])
        db.flush()
        cards.links = [TaskLink(depends_on_id=venue.id)]
        db.commit()
        ada_id, venue_id = ada.id, venue.id

    with empty.begin() as connection:
        connection.execute(v1_0_task(ada_id, "Order the cake"))
        connection.execute(delete(V1_0_TASKS).where(V1_0_TASKS.c.id == venue_id))

    with Session(empty) as db:
        tasks = {t.title: t for t in db.scalars(select(Task))}
        assert tasks.keys() == {"Send invitations", "Order the cake"}
        assert tasks["Order the cake"].description == ""
        assert tasks["Send invitations"].links == []
        assert db.scalars(select(Subtask)).all() == []


def replica(url, start) -> None:
    """One replica starting: its own process, so its own Alembic and its own connection."""
    engine = create_engine(url)
    start.wait()  # all of them at once
    migrate(engine)


@pytest.mark.skipif(
    not os.environ.get("TEST_DATABASE_URL"),
    reason="needs Postgres: replicas share one database there",
)
def test_replicas_starting_together_migrate_once(empty):
    spawn = multiprocessing.get_context("spawn")
    start = spawn.Barrier(3)
    url = os.environ["TEST_DATABASE_URL"]
    replicas = [spawn.Process(target=replica, args=(url, start)) for _ in range(3)]
    for process in replicas:
        process.start()
    for process in replicas:
        process.join(timeout=30)
    assert [process.exitcode for process in replicas] == [0, 0, 0]
