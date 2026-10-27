"""v1.1: titles, categories, subtasks, links, completion dates and AI calls.

Only additions, so v1.0 keeps working on this schema and a rollback is a traffic switch:
the new columns are nullable or have a default in the database, and the new tables'
foreign keys cascade, so v1.0 can still delete a task that has subtasks or links.

Revision ID: 0002
Revises: 0001
"""

import uuid
from datetime import UTC, datetime

import sqlalchemy as sa
from alembic import op

revision = "0002"
down_revision = "0001"

# Copied, not imported: a migration must do the same thing however the app changes later.
DEFAULT_CATEGORIES = ("Work", "Home", "Errands", "Health", "Finance")


def upgrade() -> None:
    categories = op.create_table(
        "categories",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "owner_id",
            sa.Uuid(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("name", sa.String(40), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index(
        "ix_categories_owner_name",
        "categories",
        ["owner_id", sa.text("lower(name)")],
        unique=True,
    )
    # v1.0's "description" column holds what v1.1 calls the title (models.py), so only the
    # new description, "details", is added.
    with op.batch_alter_table("tasks") as tasks:
        tasks.add_column(
            sa.Column("details", sa.Text(), nullable=False, server_default="")
        )
        tasks.add_column(
            sa.Column(
                "category_id",
                sa.Uuid(),
                # Batch mode needs a name: the one Postgres would have chosen.
                sa.ForeignKey(
                    "categories.id",
                    ondelete="SET NULL",
                    name="tasks_category_id_fkey",
                ),
            )
        )
        tasks.add_column(sa.Column("completed_at", sa.DateTime(timezone=True)))
    op.create_table(
        "subtasks",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "task_id",
            sa.Uuid(),
            sa.ForeignKey("tasks.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column("title", sa.String(200), nullable=False),
        sa.Column("completed", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_table(
        "task_links",
        sa.Column(
            "task_id",
            sa.Uuid(),
            sa.ForeignKey("tasks.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column(
            "depends_on_id",
            sa.Uuid(),
            sa.ForeignKey("tasks.id", ondelete="CASCADE"),
            primary_key=True,
            index=True,
        ),
        sa.CheckConstraint("task_id <> depends_on_id", name="ck_task_links_not_self"),
    )
    op.create_table(
        "ai_calls",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "user_id",
            sa.Uuid(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("input_tokens", sa.Integer(), nullable=False),
    )
    op.create_index("ix_ai_calls_user_at", "ai_calls", ["user_id", "at"])
    op.create_index("ix_ai_calls_at", "ai_calls", ["at"])

    # v1.1 gives every new account the default categories; v1.0's accounts get them here.
    users = sa.table("users", sa.column("id", sa.Uuid()))
    now = datetime.now(UTC)
    rows = [
        {"id": uuid.uuid7(), "owner_id": owner, "name": name, "created_at": now}
        for owner in op.get_bind().scalars(sa.select(users.c.id))
        for name in DEFAULT_CATEGORIES
    ]
    if rows:
        op.bulk_insert(categories, rows)
