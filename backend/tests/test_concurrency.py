"""Two requests from the same person at the same moment, on Postgres (SQLite has one writer).

Each test lets both transactions run their check, then holds them at a barrier, which is
exactly the window a race needs. With the owner's row locked, the second transaction waits
at the lock instead, the barrier times out, and it checks again once the first has committed.
"""

import os
import threading
import uuid

import pytest
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app import crud
from app.errors import LinkCycle, OrderStale
from app.models import Task, TaskLink, User
from tests.helpers import add_task

pytestmark = pytest.mark.skipif(
    not os.environ.get("TEST_DATABASE_URL"),
    reason="needs Postgres: SQLite allows only one writer at a time",
)


def hold_after(monkeypatch, name):
    """Make crud.<name> wait (up to 1 s) for a second caller before returning."""
    real = getattr(crud, name)
    both = threading.Barrier(2, timeout=1)

    def checked_then_wait(*args):
        result = real(*args)
        try:
            both.wait()
        except threading.BrokenBarrierError:
            pass
        return result

    monkeypatch.setattr(crud, name, checked_then_wait)


def run_together(*jobs):
    threads = [threading.Thread(target=job) for job in jobs]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()


def test_opposite_links_at_once_never_store_a_loop(client, ada, engine, monkeypatch):
    add_task(client, ada, "A")
    add_task(client, ada, "B")
    hold_after(monkeypatch, "find_path")
    results = []

    def link(title, other_title):
        with Session(engine) as db:
            owner = db.scalar(select(User))
            task = db.scalar(select(Task).where(Task.title == title))
            other = db.scalar(select(Task).where(Task.title == other_title))
            try:
                crud.link(db, owner, task, other.id)
                results.append("linked")
            except LinkCycle:
                results.append("loop refused")

    run_together(lambda: link("A", "B"), lambda: link("B", "A"))
    assert sorted(results) == ["linked", "loop refused"]
    with Session(engine) as db:
        assert db.scalar(select(func.count()).select_from(TaskLink)) == 1


def test_two_orders_from_the_same_start_at_once(client, ada, engine, monkeypatch):
    a, b, c = (uuid.UUID(add_task(client, ada, t)["id"]) for t in ("A", "B", "C"))
    hold_after(monkeypatch, "breaks_link")
    results = []

    def save(order):
        with Session(engine) as db:
            owner = db.scalar(select(User))
            try:
                crud.set_order(db, owner, order, [a, b, c])
                results.append("saved")
            except OrderStale:
                results.append("stale")

    run_together(lambda: save([b, a, c]), lambda: save([a, c, b]))
    assert sorted(results) == ["saved", "stale"]
