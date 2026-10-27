from datetime import UTC, datetime, timedelta

import pytest

from tests.helpers import add_task


def test_create_task_returns_it_with_location(client, ada):
    response = client.post("/api/tasks", json={"title": "  Buy milk  "}, headers=ada)
    assert response.status_code == 201
    task = response.json()
    assert task == {
        "id": task["id"],
        "title": "Buy milk",
        "description": "",
        "completed": False,
        "position": 1,
        "subtasks": [],
        "category_id": None,
        "waits_for": [],
        "created_at": task["created_at"],
        "completed_at": None,
    }
    assert response.headers["location"] == f"/api/tasks/{task['id']}"


def test_task_ids_grow_with_creation_time(client, ada):
    # UUIDv7: the smallest id in a group of linked tasks is its oldest task.
    ids = [add_task(client, ada, title)["id"] for title in "abcde"]
    assert ids == sorted(ids)


def test_new_tasks_go_to_the_end(client, ada):
    assert [add_task(client, ada, d)["position"] for d in ("a", "b", "c")] == [1, 2, 3]


def test_create_task_with_title_and_description(client, ada):
    task = add_task(client, ada, "Book the venue", "Call three places")
    assert (task["title"], task["description"]) == (
        "Book the venue",
        "Call three places",
    )


@pytest.mark.parametrize(
    ("payload", "field", "message"),
    [
        ({"title": ""}, "title", "Title is required"),
        ({"title": "  "}, "title", "Title is required"),
        ({"title": "x" * 201}, "title", "Title must be at most 200 characters"),
        (
            {"title": "ok", "description": "x" * 2001},
            "description",
            "Description must be at most 2000 characters",
        ),
    ],
)
def test_create_task_rejects_bad_title_or_description(
    client, ada, payload, field, message
):
    response = client.post("/api/tasks", json=payload, headers=ada)
    assert response.status_code == 400
    assert response.json()["error"]["fields"] == {field: message}


def test_patch_edits_title_and_description(client, ada):
    task = add_task(client, ada, "Old")
    body = client.patch(
        f"/api/tasks/{task['id']}",
        json={"title": "New", "description": "Notes"},
        headers=ada,
    ).json()
    assert (body["title"], body["description"]) == ("New", "Notes")


def test_tasks_require_a_token(client):
    assert client.get("/api/tasks").json()["error"]["code"] == "AUTH_REQUIRED"


def test_list_returns_only_my_tasks_in_order(client, ada, grace):
    for d in ("a", "b", "c"):
        add_task(client, ada, d)
    add_task(client, grace, "theirs")
    tasks = client.get("/api/tasks", headers=ada).json()
    assert [t["title"] for t in tasks] == ["a", "b", "c"]


def test_get_task_returns_it(client, ada):
    task = add_task(client, ada, "Buy milk")
    assert client.get(f"/api/tasks/{task['id']}", headers=ada).json() == task


def test_someone_elses_task_is_not_found(client, ada, grace):
    task = add_task(client, grace, "secret")
    for method in ("get", "patch", "delete"):
        kwargs = {"json": {"completed": True}} if method == "patch" else {}
        response = getattr(client, method)(
            f"/api/tasks/{task['id']}", headers=ada, **kwargs
        )
        assert response.status_code == 404
        assert response.json() == {
            "error": {"code": "TASK_NOT_FOUND", "message": "Task not found"}
        }


def test_a_malformed_id_is_a_validation_error(client, ada):
    response = client.get("/api/tasks/not-a-uuid", headers=ada)
    assert response.status_code == 400
    assert response.json()["error"]["fields"] == {
        "task_id": "Task id must be a valid id"
    }


def test_patch_changes_only_the_fields_sent(client, ada):
    task = add_task(client, ada, "Buy milk")
    response = client.patch(
        f"/api/tasks/{task['id']}", json={"completed": True}, headers=ada
    )
    assert response.status_code == 200
    changed = response.json()
    assert changed == {
        **task,
        "completed": True,
        "completed_at": changed["completed_at"],
    }


def test_an_empty_patch_changes_nothing(client, ada):
    task = add_task(client, ada, "Buy milk")
    assert client.patch(f"/api/tasks/{task['id']}", json={}, headers=ada).json() == task


@pytest.mark.parametrize(
    ("payload", "field", "message"),
    [
        ({"owner_id": "x"}, "owner_id", "Unknown field: owner_id"),
        ({"completed": None}, "completed", "Completed cannot be null"),
        ({"title": "  "}, "title", "Title is required"),
        # Order changes go through PUT /task-order, which checks the links.
        ({"position": 3}, "position", "Unknown field: position"),
    ],
)
def test_patch_rejects_invalid_changes(client, ada, payload, field, message):
    task = add_task(client, ada, "Buy milk")
    response = client.patch(f"/api/tasks/{task['id']}", json=payload, headers=ada)
    assert response.status_code == 400
    assert response.json()["error"]["fields"] == {field: message}


def test_task_text_is_stored_literally(client, ada):
    text = "'); DROP TABLE tasks; --"
    assert add_task(client, ada, text)["title"] == text
    tasks = client.get("/api/tasks", headers=ada).json()
    assert [t["title"] for t in tasks] == [text]


def test_delete_removes_the_task(client, ada):
    task = add_task(client, ada, "Buy milk")
    response = client.delete(f"/api/tasks/{task['id']}", headers=ada)
    assert response.status_code == 204
    assert client.get(f"/api/tasks/{task['id']}", headers=ada).status_code == 404


def utc(value: str) -> datetime:
    """An API date, which must carry its UTC offset."""
    moment = datetime.fromisoformat(value)
    assert moment.utcoffset() == timedelta(0), value
    return moment


def test_task_dates_are_utc(client, ada):
    task = add_task(client, ada, "Buy milk")
    assert abs(utc(task["created_at"]) - datetime.now(UTC)) < timedelta(seconds=60)
    assert task["completed_at"] is None


def test_completed_at_is_stamped_once_and_cleared_on_untick(client, ada):
    task = add_task(client, ada, "Buy milk")
    url = f"/api/tasks/{task['id']}"
    done = client.patch(url, json={"completed": True}, headers=ada).json()
    assert abs(utc(done["completed_at"]) - datetime.now(UTC)) < timedelta(seconds=60)
    # Renaming, or ticking it again, keeps the first time.
    for change in ({"title": "Buy oat milk"}, {"completed": True}):
        stamped = client.patch(url, json=change, headers=ada).json()["completed_at"]
        assert stamped == done["completed_at"]
    undone = client.patch(url, json={"completed": False}, headers=ada).json()
    assert undone["completed_at"] is None
