from app.graph import breaks_link
from app.seed import EXAMPLE
from tests.helpers import add_task

EXAMPLE_TITLES = [title for title, *_ in EXAMPLE]


def load_example(client, headers):
    return client.post("/api/examples", headers=headers)


def category_names(client, headers) -> dict[str, str]:
    listed = client.get("/api/categories", headers=headers).json()
    return {category["id"]: category["name"] for category in listed}


def test_the_example_has_links_subtasks_and_categories(client, ada):
    response = load_example(client, ada)
    assert response.status_code == 201
    tasks = {task["title"]: task for task in response.json()}
    assert list(tasks) == EXAMPLE_TITLES
    ids = {title: task["id"] for title, task in tasks.items()}
    assert set(tasks["Send invitations"]["waits_for"]) == {
        ids["Book the venue"],
        ids["Confirm guest list"],
    }
    assert tasks["Seating plan"]["waits_for"] == [ids["Send invitations"]]
    assert tasks["Book flights"]["waits_for"] == [ids["Renew passport"]]
    assert tasks["Order the cake"]["waits_for"] == []
    assert len(tasks["Book the venue"]["subtasks"]) == 3
    assert len(tasks["Send invitations"]["subtasks"]) == 2
    names = category_names(client, ada)
    assert names[tasks["Book flights"]["category_id"]] == "Travel"
    assert names[tasks["Book the venue"]["category_id"]] == "Wedding"


def test_the_example_order_respects_its_links(client, ada):
    tasks = load_example(client, ada).json()
    graph = {task["id"]: task["waits_for"] for task in tasks}
    assert breaks_link([task["id"] for task in tasks], graph) is False


def test_adding_it_twice_appends_a_second_copy(client, ada):
    add_task(client, ada, "Mine")
    load_example(client, ada)
    tasks = load_example(client, ada).json()
    assert [task["title"] for task in tasks] == ["Mine", *EXAMPLE_TITLES * 2]
    names = list(category_names(client, ada).values())
    assert names.count("Wedding") == 1
    assert names.count("Travel") == 1


def test_the_example_needs_a_signed_in_user(client):
    assert load_example(client, {}).status_code == 401
