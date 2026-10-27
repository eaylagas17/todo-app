from sqlalchemy import event, func, select

from app.models import Subtask
from tests.helpers import add_task


def add_subtask(client, headers, task_id, title):
    return client.post(
        f"/api/tasks/{task_id}/subtasks", json={"title": title}, headers=headers
    )


def test_add_subtask_returns_it(client, ada):
    task = add_task(client, ada, "Book the venue")
    response = add_subtask(client, ada, task["id"], "Shortlist")
    assert response.status_code == 201
    subtask = response.json()
    assert subtask == {"id": subtask["id"], "title": "Shortlist", "completed": False}


def test_list_embeds_subtasks_in_creation_order(client, ada):
    task = add_task(client, ada, "Book the venue")
    for title in ("Shortlist", "Visit", "Sign"):
        add_subtask(client, ada, task["id"], title)
    [listed] = client.get("/api/tasks", headers=ada).json()
    assert [s["title"] for s in listed["subtasks"]] == ["Shortlist", "Visit", "Sign"]


def test_tick_and_rename_a_subtask(client, ada):
    task = add_task(client, ada, "Book the venue")
    subtask = add_subtask(client, ada, task["id"], "Shortlist").json()
    path = f"/api/tasks/{task['id']}/subtasks/{subtask['id']}"
    assert client.patch(path, json={"completed": True}, headers=ada).json() == {
        **subtask,
        "completed": True,
    }
    assert client.patch(path, json={"title": "Visit"}, headers=ada).json() == {
        **subtask,
        "completed": True,
        "title": "Visit",
    }


def test_delete_a_subtask(client, ada):
    task = add_task(client, ada, "Book the venue")
    subtask = add_subtask(client, ada, task["id"], "Shortlist").json()
    response = client.delete(
        f"/api/tasks/{task['id']}/subtasks/{subtask['id']}", headers=ada
    )
    assert response.status_code == 204
    [listed] = client.get("/api/tasks", headers=ada).json()
    assert listed["subtasks"] == []


def test_subtask_title_is_required(client, ada):
    task = add_task(client, ada, "Book the venue")
    response = add_subtask(client, ada, task["id"], "  ")
    assert response.status_code == 400
    assert response.json()["error"]["fields"]["title"] == "Title is required"


def test_someone_elses_subtasks_are_not_found(client, ada, grace):
    task = add_task(client, ada, "Book the venue")
    response = add_subtask(client, grace, task["id"], "Sneaky")
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "TASK_NOT_FOUND"


def test_subtask_of_another_task_is_not_found(client, ada):
    venue = add_task(client, ada, "Book the venue")
    cake = add_task(client, ada, "Order the cake")
    subtask = add_subtask(client, ada, venue["id"], "Shortlist").json()
    path = f"/api/tasks/{cake['id']}/subtasks/{subtask['id']}"
    for response in (
        client.patch(path, json={"completed": True}, headers=ada),
        client.delete(path, headers=ada),
    ):
        assert response.status_code == 404
        assert response.json() == {
            "error": {"code": "SUBTASK_NOT_FOUND", "message": "Subtask not found"}
        }


def test_deleting_a_task_deletes_its_subtasks(client, ada, db):
    task = add_task(client, ada, "Book the venue")
    add_subtask(client, ada, task["id"], "Shortlist")
    client.delete(f"/api/tasks/{task['id']}", headers=ada)
    assert db.scalar(select(func.count()).select_from(Subtask)) == 0


def test_listing_tasks_takes_the_same_number_of_queries_for_1_or_10_tasks(
    client, ada, engine
):
    def queries_to_list() -> int:
        statements = []

        def count(*args):
            statements.append(args[2])

        event.listen(engine, "before_cursor_execute", count)
        try:
            client.get("/api/tasks", headers=ada)
        finally:
            event.remove(engine, "before_cursor_execute", count)
        return len(statements)

    first = add_task(client, ada, "task 0")
    add_subtask(client, ada, first["id"], "step")
    one = queries_to_list()
    for n in range(1, 10):
        task = add_task(client, ada, f"task {n}")
        add_subtask(client, ada, task["id"], "step")
    assert queries_to_list() == one
