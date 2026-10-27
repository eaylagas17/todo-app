from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session

from app.main import create_app
from app.models import Task, User
from app.seed import seed_demo
from tests.helpers import sign_in


def test_health_reports_ok(client):
    assert client.get("/api/health").json() == {"status": "ok"}


def test_health_reports_database_outage(client, monkeypatch):
    def broken(*args, **kwargs):
        raise OperationalError("SELECT 1", {}, Exception("down"))

    monkeypatch.setattr(Session, "execute", broken)
    response = client.get("/api/health")
    assert response.status_code == 503
    assert response.json() == {
        "error": {"code": "SERVICE_UNAVAILABLE", "message": "Database unavailable"}
    }


def built_app(tmp_path) -> TestClient:
    (tmp_path / "assets").mkdir()
    (tmp_path / "index.html").write_text("<div id=root>")
    (tmp_path / "assets" / "app-3f9a1c.js").write_text("console")
    (tmp_path / "favicon.svg").write_text("<svg/>")
    return TestClient(create_app(tmp_path))


def test_spa_serves_index_for_app_routes(tmp_path):
    spa = built_app(tmp_path)
    assert spa.get("/").text == "<div id=root>"
    assert spa.get("/tasks/123").text == "<div id=root>"
    assert spa.get("/assets/app-3f9a1c.js").text == "console"
    assert spa.get("/favicon.svg").text == "<svg/>"
    assert spa.get("/api/nope").json()["error"]["code"] == "NOT_FOUND"


def test_spa_never_serves_files_outside_its_folder(tmp_path):
    (tmp_path / "secret.txt").write_text("secret")
    (tmp_path / "site" / "assets").mkdir(parents=True)
    (tmp_path / "site" / "index.html").write_text("<div id=root>")
    spa = TestClient(create_app(tmp_path / "site"))
    assert spa.get("/..%2Fsecret.txt").text == "<div id=root>"


def test_built_files_are_cached_forever_but_index_is_not(tmp_path):
    spa = built_app(tmp_path)
    assert "immutable" in spa.get("/assets/app-3f9a1c.js").headers["cache-control"]
    assert spa.get("/tasks/123").headers["cache-control"] == "no-cache"


def test_seed_demo_is_idempotent(db):
    seed_demo(db)
    seed_demo(db)
    assert db.scalar(select(func.count()).select_from(User)) == 1
    assert db.scalar(select(func.count()).select_from(Task)) == 7


def test_demo_user_can_sign_in(client, db):
    seed_demo(db)
    response = sign_in(client, "demo@example.com", "demo-password")
    assert response.status_code == 201
    demo = {"Authorization": f"Bearer {response.json()['token']}"}
    titles = [task["title"] for task in client.get("/api/tasks", headers=demo).json()]
    assert titles[:3] == ["Book the venue", "Confirm guest list", "Send invitations"]
