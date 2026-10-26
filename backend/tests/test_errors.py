import pytest
from fastapi.testclient import TestClient

from app import crud
from app.errors import friendly_message
from app.main import app


def test_malformed_json_is_a_validation_error(client):
    response = client.post(
        "/api/users", content="{not json", headers={"Content-Type": "application/json"}
    )
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "VALIDATION_ERROR"
    assert response.json()["error"]["message"] == "Request body is not valid JSON"


def test_unknown_routes_use_the_error_shape(client):
    response = client.get("/api/nope")
    assert response.status_code == 404
    assert response.json() == {"error": {"code": "NOT_FOUND", "message": "Not found"}}


def test_wrong_method_uses_the_error_shape(client):
    response = client.put("/api/sessions/current")
    assert response.status_code == 405
    assert response.json() == {
        "error": {"code": "METHOD_NOT_ALLOWED", "message": "Method not allowed"}
    }


def test_unexpected_errors_do_not_leak_details(client, monkeypatch):
    def explode(*args, **kwargs):
        raise RuntimeError("secret internal detail")

    monkeypatch.setattr(crud, "authenticate", explode)
    response = TestClient(app, raise_server_exceptions=False).post(
        "/api/sessions", json={"email": "ada@example.com", "password": "correct-horse"}
    )
    assert response.status_code == 500
    assert response.json() == {
        "error": {
            "code": "INTERNAL_ERROR",
            "message": "Something went wrong. Please try again.",
        }
    }
    assert "secret" not in response.text


@pytest.mark.parametrize(
    ("error", "message"),
    [
        (
            {
                "type": "missing",
                "loc": ("body", "task_id"),
                "msg": "Field required",
                "input": None,
            },
            "Task id is required",
        ),
        (
            {
                "type": "string_too_long",
                "loc": ("body", "description"),
                "msg": "String should have at most 500 characters",
                "input": "x",
                "ctx": {"max_length": 500},
            },
            "Description must be at most 500 characters",
        ),
        (
            {
                "type": "bool_type",
                "loc": ("body", "completed"),
                "msg": "Input should be a valid boolean",
                "input": None,
            },
            "Completed cannot be null",
        ),
        (
            {
                "type": "value_error",
                "loc": ("body", "email"),
                "msg": "Value error, Email is invalid",
                "input": "x",
            },
            "Email is invalid",
        ),
        (
            {
                "type": "finite_number",
                "loc": ("body", "position"),
                "msg": "Input should be a finite number",
                "input": float("inf"),
            },
            "Input should be a finite number",
        ),
    ],
)
def test_friendly_message(error, message):
    assert friendly_message(error) == message
