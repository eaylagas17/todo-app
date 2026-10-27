from app.crud import DEFAULT_CATEGORIES
from tests.helpers import add_task


def categories(client, headers) -> list[dict]:
    return client.get("/api/categories", headers=headers).json()


def add_category(client, headers, name):
    return client.post("/api/categories", json={"name": name}, headers=headers)


def test_new_accounts_get_the_default_categories(client, ada):
    assert [c["name"] for c in categories(client, ada)] == list(DEFAULT_CATEGORIES)


def test_create_and_rename_a_category(client, ada):
    response = add_category(client, ada, "  Wedding  ")
    assert response.status_code == 201
    wedding = response.json()
    assert wedding == {"id": wedding["id"], "name": "Wedding"}
    renamed = client.patch(
        f"/api/categories/{wedding['id']}", json={"name": "Party"}, headers=ada
    )
    assert renamed.json() == {"id": wedding["id"], "name": "Party"}
    assert categories(client, ada)[-1]["name"] == "Party"


def test_duplicate_category_name_is_409(client, ada):
    add_category(client, ada, "Wedding")
    response = add_category(client, ada, "wedding")
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "CATEGORY_EXISTS"
    work = categories(client, ada)[0]
    renamed = client.patch(
        f"/api/categories/{work['id']}", json={"name": "HOME"}, headers=ada
    )
    assert renamed.status_code == 409


def test_the_same_name_is_fine_for_another_person(client, ada, grace):
    add_category(client, ada, "Wedding")
    assert add_category(client, grace, "Wedding").status_code == 201


def test_deleting_a_category_uncategorises_its_tasks(client, ada):
    wedding = add_category(client, ada, "Wedding").json()
    task = add_task(client, ada, "Book the venue")
    client.patch(
        f"/api/tasks/{task['id']}", json={"category_id": wedding["id"]}, headers=ada
    )
    response = client.delete(f"/api/categories/{wedding['id']}", headers=ada)
    assert response.status_code == 204
    assert (
        client.get(f"/api/tasks/{task['id']}", headers=ada).json()["category_id"]
        is None
    )
    assert "Wedding" not in [c["name"] for c in categories(client, ada)]


def test_someone_elses_category_is_not_found(client, ada, grace):
    wedding = add_category(client, ada, "Wedding").json()
    path = f"/api/categories/{wedding['id']}"
    for response in (
        client.patch(path, json={"name": "Mine"}, headers=grace),
        client.delete(path, headers=grace),
    ):
        assert response.status_code == 404
        assert response.json() == {
            "error": {"code": "CATEGORY_NOT_FOUND", "message": "Category not found"}
        }


def test_set_and_clear_a_tasks_category(client, ada):
    work = categories(client, ada)[0]
    task = add_task(client, ada, "Write the report")
    path = f"/api/tasks/{task['id']}"
    set_ = client.patch(path, json={"category_id": work["id"]}, headers=ada)
    assert set_.json()["category_id"] == work["id"]
    cleared = client.patch(path, json={"category_id": None}, headers=ada)
    assert cleared.json()["category_id"] is None


def test_foreign_category_on_a_task_is_a_validation_error(client, ada, grace):
    theirs = categories(client, grace)[0]
    task = add_task(client, ada, "Write the report")
    response = client.patch(
        f"/api/tasks/{task['id']}", json={"category_id": theirs["id"]}, headers=ada
    )
    assert response.status_code == 400
    assert response.json() == {
        "error": {
            "code": "VALIDATION_ERROR",
            "message": "Category not found",
            "fields": {"category_id": "Category not found"},
        }
    }
