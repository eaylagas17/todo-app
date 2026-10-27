import socket

from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session


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
    assert "ai_enabled" in body  # known without the database


def test_status_shows_only_what_a_reviewer_needs(client, monkeypatch):
    # No AI calls, spend or limits: operator numbers, not for a reviewer (Feedback 7).
    monkeypatch.setenv("TYPESAFE_API_KEY", "test-key")
    body = status(client)
    assert set(body) == {
        "version",
        "replica",
        "started_at",
        "uptime_seconds",
        "database",
        "ai_enabled",
    }
    assert body["ai_enabled"] is True


def test_status_says_ai_is_off_without_a_key(client, monkeypatch):
    monkeypatch.delenv("TYPESAFE_API_KEY", raising=False)
    assert status(client)["ai_enabled"] is False
