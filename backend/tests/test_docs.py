def operations(client) -> dict:
    spec = client.get("/openapi.json").json()
    return {
        f"{method.upper()} {path}": details["responses"]
        for path, methods in spec["paths"].items()
        for method, details in methods.items()
    }


def test_docs_describe_validation_errors_as_400_not_422(client):
    for name, responses in operations(client).items():
        assert "422" not in responses, name


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
        "GET /api/categories": {"401"},
        "POST /api/categories": {"400", "401", "409"},
        "PATCH /api/categories/{category_id}": {"400", "401", "404", "409"},
        "DELETE /api/categories/{category_id}": {"400", "401", "404"},
        "GET /api/health": {"503"},
    }


def test_docs_show_the_error_envelope(client):
    spec = client.get("/openapi.json").json()
    conflict = spec["paths"]["/api/users"]["post"]["responses"]["409"]
    assert conflict["content"]["application/json"]["schema"] == {
        "$ref": "#/components/schemas/ErrorOut"
    }
