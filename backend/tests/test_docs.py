def operations(client) -> dict:
    spec = client.get("/openapi.json").json()
    return {
        f"{method.upper()} {path}": details["responses"]
        for path, methods in spec["paths"].items()
        for method, details in methods.items()
    }


# The table also proves FastAPI's default 422 is gone: it would show up as an extra code.
def test_docs_list_the_errors_each_endpoint_returns(client):
    documented = {
        name: set(responses) - {"200", "201", "204"}
        for name, responses in operations(client).items()
    }
    assert documented == {
        "POST /api/users": {"400", "409"},
        "POST /api/sessions": {"400", "401"},
        "DELETE /api/sessions/current": {"401"},
        "GET /api/tasks": {"401"},
        "POST /api/tasks": {"400", "401"},
        "GET /api/tasks/{task_id}": {"400", "401", "404"},
        "PATCH /api/tasks/{task_id}": {"400", "401", "404"},
        "DELETE /api/tasks/{task_id}": {"400", "401", "404"},
        "POST /api/tasks/{task_id}/subtasks": {"400", "401", "404"},
        "PATCH /api/tasks/{task_id}/subtasks/{subtask_id}": {"400", "401", "404"},
        "DELETE /api/tasks/{task_id}/subtasks/{subtask_id}": {"400", "401", "404"},
        "POST /api/tasks/{task_id}/category-suggestion": {
            "400",
            "401",
            "404",
            "429",
            "503",
        },
        "POST /api/tasks/{task_id}/links": {"400", "401", "404", "409"},
        "DELETE /api/tasks/{task_id}/links/{depends_on_id}": {"400", "401", "404"},
        "PUT /api/task-order": {"400", "401", "409"},
        "POST /api/examples": {"401"},
        "GET /api/categories": {"401"},
        "POST /api/categories": {"400", "401", "409"},
        "PATCH /api/categories/{category_id}": {"400", "401", "404", "409"},
        "DELETE /api/categories/{category_id}": {"400", "401", "404"},
        "GET /api/health": {"503"},
        "GET /api/status": set(),
    }
    # Each error is documented with the error envelope.
    conflict = operations(client)["POST /api/users"]["409"]
    assert conflict["content"]["application/json"]["schema"] == {
        "$ref": "#/components/schemas/ErrorOut"
    }
