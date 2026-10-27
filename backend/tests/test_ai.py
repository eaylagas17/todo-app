import copy
import json
from datetime import timedelta
from pathlib import Path

import httpx
import pytest
from sqlalchemy import func, select, update

from app.ai import get_http_client
from app.db import utcnow
from app.main import app
from app.models import AiCall, Task
from tests.helpers import add_task

# A real answer from Jev (one call made while building this, spec §9); tests change only
# the choice and the confidence, so the fake can't drift from the real format.
REAL = json.loads((Path(__file__).parent / "jev_choice_response.json").read_text())


class FakeJev:
    def __init__(self):
        self.requests: list[httpx.Request] = []
        self.choice: str | None = None
        self.confidence = 0.9
        self.status = 200
        self.before_answering = lambda: None

    def handle(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        self.before_answering()
        if self.status != 200:
            return httpx.Response(self.status, json={"error": "overloaded"})
        body = copy.deepcopy(REAL)
        body["answers"]["category"] |= {
            "choice": self.choice,
            "confidence": self.confidence,
        }
        return httpx.Response(200, json=body)


@pytest.fixture
def jev(client, monkeypatch):
    monkeypatch.setenv("TYPESAFE_API_KEY", "test-key")
    fake = FakeJev()
    app.dependency_overrides[get_http_client] = lambda: httpx.Client(
        transport=httpx.MockTransport(fake.handle)
    )
    return fake


def category_id(client, headers, name):
    listed = client.get("/api/categories", headers=headers).json()
    return next(c["id"] for c in listed if c["name"] == name)


def suggest(client, headers, task):
    return client.post(f"/api/tasks/{task['id']}/category-suggestion", headers=headers)


def calls(db) -> int:
    return db.scalar(select(func.count()).select_from(AiCall))


def test_applies_a_confident_choice(client, ada, jev):
    jev.choice = category_id(client, ada, "Errands")
    task = add_task(client, ada, "Buy stamps")
    response = suggest(client, ada, task)
    assert response.status_code == 200
    assert response.json()["category_id"] == jev.choice


def test_low_confidence_leaves_the_task_uncategorised(client, ada, jev):
    jev.choice, jev.confidence = category_id(client, ada, "Errands"), 0.4
    task = add_task(client, ada, "Buy stamps")
    assert suggest(client, ada, task).json()["category_id"] is None


def test_never_overwrites_a_chosen_category(client, ada, jev):
    work = category_id(client, ada, "Work")
    task = add_task(client, ada, "Buy stamps")
    client.patch(f"/api/tasks/{task['id']}", json={"category_id": work}, headers=ada)
    assert suggest(client, ada, task).json()["category_id"] == work
    assert jev.requests == []


def test_never_overwrites_a_category_chosen_meanwhile(client, ada, jev, db):
    home = category_id(client, ada, "Home")
    jev.choice = category_id(client, ada, "Errands")
    task = add_task(client, ada, "Buy stamps")

    def person_picks_home():
        db.execute(
            update(Task).where(Task.title == "Buy stamps").values(category_id=home)
        )
        db.commit()

    jev.before_answering = person_picks_home
    assert suggest(client, ada, task).json()["category_id"] == home


def test_sends_ids_and_names_as_choices(client, ada, jev):
    task = add_task(client, ada, "Buy stamps", "At the post office")
    suggest(client, ada, task)
    [request] = jev.requests
    body = json.loads(request.content)
    listed = client.get("/api/categories", headers=ada).json()
    assert body["model"] == "jev-1.14.0"
    assert body["state"] == "Title: Buy stamps\nDescription: At the post office"
    question = body["questions"]["category"]
    assert question["type"] == "choice"
    assert question["criteria"] == {c["id"]: c["name"] for c in listed}
    assert request.headers["Authorization"] == "Bearer test-key"


def test_without_a_key_it_is_unavailable(client, ada, jev, monkeypatch):
    monkeypatch.delenv("TYPESAFE_API_KEY")
    response = suggest(client, ada, add_task(client, ada, "Buy stamps"))
    assert response.status_code == 503
    assert response.json()["error"]["code"] == "AI_UNAVAILABLE"
    assert jev.requests == []


def test_jev_failure_is_unavailable_and_still_counts(client, ada, jev, db):
    jev.status = 529
    response = suggest(client, ada, add_task(client, ada, "Buy stamps"))
    assert response.status_code == 503
    assert response.json()["error"]["code"] == "AI_UNAVAILABLE"
    assert calls(db) == 1


def test_a_slow_or_unreachable_jev_is_unavailable(client, ada, jev):
    def time_out():
        raise httpx.ConnectTimeout("too slow")

    jev.before_answering = time_out
    response = suggest(client, ada, add_task(client, ada, "Buy stamps"))
    assert response.status_code == 503


def test_records_the_tokens_used(client, ada, jev, db):
    jev.choice = category_id(client, ada, "Errands")
    suggest(client, ada, add_task(client, ada, "Buy stamps"))
    assert db.scalar(select(AiCall.input_tokens)) == REAL["usage"]["input_tokens"]


def test_per_minute_limit(client, ada, jev):
    jev.confidence = 0.4
    task = add_task(client, ada, "Buy stamps")
    for _ in range(10):
        assert suggest(client, ada, task).status_code == 200
    response = suggest(client, ada, task)
    assert response.status_code == 429
    assert response.json()["error"]["code"] == "AI_RATE_LIMITED"


def test_per_day_limit(client, ada, jev, db):
    task = add_task(client, ada, "Buy stamps")
    user_id = db.scalar(select(Task.owner_id).where(Task.title == "Buy stamps"))
    two_hours_ago = utcnow() - timedelta(hours=2)
    db.add_all(AiCall(user_id=user_id, at=two_hours_ago) for _ in range(100))
    db.commit()
    assert suggest(client, ada, task).status_code == 429


def test_monthly_budget(client, ada, grace, jev, db):
    add_task(client, grace, "Buy stamps")
    user_id = db.scalar(select(Task.owner_id).where(Task.title == "Buy stamps"))
    db.add(
        AiCall(user_id=user_id, input_tokens=24_000_000)
    )  # $1.008 at $0.042 per million
    db.commit()
    response = suggest(client, ada, add_task(client, ada, "Post the letter"))
    assert response.status_code == 503
    assert response.json()["error"]["code"] == "AI_BUDGET_REACHED"


def test_usage_survives_task_deletion(client, ada, jev, db):
    jev.choice = category_id(client, ada, "Errands")
    task = add_task(client, ada, "Buy stamps")
    suggest(client, ada, task)
    client.delete(f"/api/tasks/{task['id']}", headers=ada)
    assert calls(db) == 1
