from pathlib import Path

from alembic import command
from alembic.config import Config
from sqlalchemy import Engine, inspect, text


def migrate(engine: Engine, revision: str = "head") -> None:
    """Brings the schema up to date; the app runs this as it starts."""
    config = Config()
    config.set_main_option(
        "script_location", str(Path(__file__).with_name("migrations"))
    )
    with engine.begin() as connection:
        if connection.dialect.name == "postgresql":
            # Replicas start together: the first to take this lock migrates, the others wait
            # for its commit and then find nothing left to do.
            connection.execute(text("SELECT pg_advisory_xact_lock(1)"))
        config.attributes["connection"] = connection
        tables = inspect(connection).get_table_names()
        # v1.0 made its tables with create_all, which matches 0001 but records no version.
        if "tasks" in tables and "alembic_version" not in tables:
            command.stamp(config, "0001")
        command.upgrade(config, revision)
