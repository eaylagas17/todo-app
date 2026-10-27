import uuid

from sqlalchemy import func, select

from app.models import TaskLink
from tests.helpers import add_task


def link(client, headers, task, depends_on):
    return client.post(
        f"/api/tasks/{task['id']}/links",
        json={"depends_on_id": depends_on["id"]},
        headers=headers,
    )


def listed(client, headers) -> list[dict]:
    return client.get("/api/tasks", headers=headers).json()


def titles(client, headers) -> list[str]:
    return [task["title"] for task in listed(client, headers)]


def put_order(client, headers, ids, previous=None):
    # previous: the order the drag started from; by default, the list as it is now.
    if previous is None:
        previous = [task["id"] for task in listed(client, headers)]
    return client.put(
        "/api/task-order", json={"ids": ids, "previous": previous}, headers=headers
    )


def test_link_returns_the_list_with_waits_for(client, ada):
    venue = add_task(client, ada, "Book the venue")
    invites = add_task(client, ada, "Send invitations")
    response = link(client, ada, invites, venue)
    assert response.status_code == 201
    by_title = {task["title"]: task for task in response.json()}
    assert by_title["Send invitations"]["waits_for"] == [venue["id"]]
    assert by_title["Book the venue"]["waits_for"] == []


def test_linking_repairs_a_broken_order(client, ada):
    a, _, b, _ = (add_task(client, ada, title) for title in ("A", "X", "B", "Y"))
    link(client, ada, a, b)  # A waits for B, but A sits above B
    # B stays where it was, between X and Y; A goes just below it.
    assert titles(client, ada) == ["X", "B", "A", "Y"]


def test_self_link_is_400(client, ada):
    task = add_task(client, ada, "Book the venue")
    response = link(client, ada, task, task)
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "LINK_SELF"


def test_loop_is_409_and_names_it(client, ada):
    venue, invites, seating = (
        add_task(client, ada, title)
        for title in ("Book the venue", "Send invitations", "Seating plan")
    )
    link(client, ada, invites, venue)
    link(client, ada, seating, invites)
    response = link(client, ada, venue, seating)
    assert response.status_code == 409
    error = response.json()["error"]
    assert error["code"] == "LINK_CYCLE"
    assert "Book the venue" in error["message"]
    assert "Seating plan" in error["message"]
    assert "→" in error["message"]


def test_linking_to_someone_elses_task_is_404(client, ada, grace):
    mine = add_task(client, ada, "Book the venue")
    theirs = add_task(client, grace, "Their task")
    response = link(client, ada, mine, theirs)
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "TASK_NOT_FOUND"


def test_linking_twice_is_idempotent(client, ada):
    venue = add_task(client, ada, "Book the venue")
    invites = add_task(client, ada, "Send invitations")
    link(client, ada, invites, venue)
    response = link(client, ada, invites, venue)
    assert response.status_code == 201
    [_, invites_after] = response.json()
    assert invites_after["waits_for"] == [venue["id"]]


def test_unlink(client, ada):
    venue = add_task(client, ada, "Book the venue")
    invites = add_task(client, ada, "Send invitations")
    link(client, ada, invites, venue)
    response = client.delete(
        f"/api/tasks/{invites['id']}/links/{venue['id']}", headers=ada
    )
    assert response.status_code == 204
    assert all(task["waits_for"] == [] for task in listed(client, ada))


def test_deleting_a_task_removes_its_links(client, ada, db):
    a, b, c = (add_task(client, ada, title) for title in ("A", "B", "C"))
    link(client, ada, b, a)
    link(client, ada, c, b)
    client.delete(f"/api/tasks/{b['id']}", headers=ada)
    assert [task["waits_for"] for task in listed(client, ada)] == [[], []]
    assert db.scalar(select(func.count()).select_from(TaskLink)) == 0


def test_put_order_renumbers_positions(client, ada):
    a, b, c = (add_task(client, ada, title) for title in ("A", "B", "C"))
    response = put_order(client, ada, [c["id"], a["id"], b["id"]])
    assert response.status_code == 200
    assert [(t["title"], t["position"]) for t in response.json()] == [
        ("C", 1),
        ("A", 2),
        ("B", 3),
    ]
    assert titles(client, ada) == ["C", "A", "B"]


def test_stale_order_is_409(client, ada, grace):
    a, b, c = (add_task(client, ada, title)["id"] for title in ("A", "B", "C"))
    theirs = add_task(client, grace, "Theirs")["id"]
    for ids in ([a, b], [a, b, c, str(uuid.uuid4())], [a, b, c, theirs], [a, b, c, c]):
        response = put_order(client, ada, ids)
        assert response.status_code == 409, ids
        assert response.json()["error"]["code"] == "ORDER_STALE"
    assert titles(client, ada) == ["A", "B", "C"]


def test_two_tabs_saving_from_the_same_order_is_409(client, ada):
    # Review Focus 1: both tabs start from [A, B, C]. The first save wins; the second was
    # made on an order that no longer exists, so it's refused instead of overwriting.
    a, b, c = (add_task(client, ada, title)["id"] for title in ("A", "B", "C"))
    first = put_order(client, ada, [b, a, c], previous=[a, b, c])
    assert first.status_code == 200
    second = put_order(client, ada, [a, c, b], previous=[a, b, c])
    assert second.status_code == 409
    assert second.json()["error"]["code"] == "ORDER_STALE"
    assert titles(client, ada) == ["B", "A", "C"]


def test_order_that_breaks_a_link_is_409(client, ada):
    venue = add_task(client, ada, "Book the venue")
    invites = add_task(client, ada, "Send invitations")
    link(client, ada, invites, venue)
    response = put_order(client, ada, [invites["id"], venue["id"]])
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "ORDER_BREAKS_LINK"


def test_position_is_no_longer_patchable(client, ada):
    task = add_task(client, ada, "Book the venue")
    response = client.patch(
        f"/api/tasks/{task['id']}", json={"position": 3}, headers=ada
    )
    assert response.status_code == 400
    assert response.json()["error"]["fields"] == {"position": "Unknown field: position"}
