import socket

import pytest
from sqlalchemy import select
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session

from app.models import AiCall, User


def status(client) -> dict:
    response = client.get("/api/status")
    assert response.status_code == 200
    return response.json()


def test_status_reports_version_replica_and_uptime(client, monkeypatch):
    monkeypatch.setenv("GIT_SHA", "abc123")
    body = status(client)
    assert body["version"] == "abc123"
    assert body["replica"] == socket.gethostname()
    assert body["uptime_seconds"] >= 0
    assert body["started_at"]


def test_status_reports_database_latency(client):
    database = status(client)["database"]
    assert database["ok"] is True
    assert database["latency_ms"] >= 0


def test_status_survives_a_database_outage(client, monkeypatch):
    def broken(*args, **kwargs):
        raise OperationalError("SELECT 1", {}, Exception("down"))

    monkeypatch.setattr(Session, "execute", broken)
    monkeypatch.setattr(Session, "scalar", broken)
    body = status(client)
    assert body["database"] == {"ok": False, "latency_ms": None}
    assert body["ai"] is None


def test_status_reports_ai_usage(client, ada, db, monkeypatch):
    monkeypatch.setenv("TYPESAFE_API_KEY", "test-key")
    user_id = db.scalar(select(User.id))
    db.add_all(
        [
            AiCall(user_id=user_id, input_tokens=1000),
            AiCall(user_id=user_id, input_tokens=3000),
        ]
    )
    db.commit()
    ai = status(client)["ai"]
    assert ai["enabled"] is True
    assert ai["calls_today"] == 2
    assert ai["spent_this_month_usd"] == pytest.approx(4000 * 0.042 / 1_000_000)
    assert ai["monthly_budget_usd"] == 1.0
    assert (ai["per_user_per_minute"], ai["per_user_per_day"]) == (10, 100)


def test_status_says_ai_is_off_without_a_key(client, monkeypatch):
    monkeypatch.delenv("TYPESAFE_API_KEY", raising=False)
    assert status(client)["ai"]["enabled"] is False
