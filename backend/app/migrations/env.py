"""Alembic runs this for every command: on the app's own connection at startup (migrate.py),
or on a new one from the command line (`uv run alembic revision --autogenerate -m "..."`)."""

from alembic import context

from app import models  # noqa: F401  (puts every table on Base.metadata)
from app.db import Base, engine


def run(connection) -> None:
    # Batch mode: SQLite can't add a foreign key to a table, so Alembic copies the table
    # instead. On Postgres it's a plain ALTER TABLE.
    context.configure(
        connection=connection, target_metadata=Base.metadata, render_as_batch=True
    )
    with context.begin_transaction():
        context.run_migrations()


if (connection := context.config.attributes.get("connection")) is not None:
    run(connection)
else:
    with engine.begin() as connection:
        run(connection)
