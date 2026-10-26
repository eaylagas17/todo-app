import hashlib
from datetime import timedelta

import pytest
from sqlalchemy import select

from app.db import utcnow
from app.models import User, UserSession
from tests.helpers import bearer, register, sign_in


def test_register_returns_user_and_token(client):
    response = client.post(
        "/api/users", json={"email": "ada@example.com", "password": "correct-horse"}
    )
    assert response.status_code == 201
    body = response.json()
    assert body["user"] == {"id": body["user"]["id"], "email": "ada@example.com"}
    assert len(body["token"]) >= 32


def test_register_stores_only_hashes(client, db):
    token = register(client)["token"]
    assert db.scalars(select(User)).one().password_hash.startswith("$argon2id$")
    stored = db.scalars(select(UserSession)).one()
    assert stored.token_hash == hashlib.sha256(token.encode()).hexdigest()


@pytest.mark.parametrize(
    ("payload", "field", "message"),
    [
        ({"email": "not-an-email", "password": "correct-horse"}, "email", "Email is invalid"),
        ({"password": "correct-horse"}, "email", "Email is required"),
        (
            {"email": "ada@example.com", "password": "short"},
            "password",
            "Password must be at least 8 characters",
        ),
        (
            {"email": "ada@example.com", "password": "x" * 129},
            "password",
            "Password must be at most 128 characters",
        ),
        (
            {"email": "ada@example.com", "password": "correct-horse", "role": "admin"},
            "role",
            "Unknown field: role",
        ),
    ],
)
def test_register_rejects_invalid_input(client, payload, field, message):
    response = client.post("/api/users", json=payload)
    assert response.status_code == 400
    assert response.json() == {
        "error": {"code": "VALIDATION_ERROR", "message": message, "fields": {field: message}}
    }


def test_register_rejects_a_taken_email(client):
    register(client)
    response = client.post(
        "/api/users", json={"email": "ADA@example.com", "password": "correct-horse"}
    )
    assert response.status_code == 409
    assert response.json() == {
        "error": {"code": "EMAIL_TAKEN", "message": "Email is already registered"}
    }


def test_sign_in_normalizes_email(client):
    register(client)
    response = sign_in(client, email="  ADA@Example.com ")
    assert response.status_code == 201
    assert response.json()["user"]["email"] == "ada@example.com"


@pytest.mark.parametrize(
    ("email", "password"),
    [("ada@example.com", "wrong-horse"), ("nobody@example.com", "correct-horse")],
)
def test_sign_in_rejects_bad_credentials(client, email, password):
    register(client)
    response = sign_in(client, email, password)
    assert response.status_code == 401
    assert response.json() == {
        "error": {"code": "INVALID_CREDENTIALS", "message": "Invalid email or password"}
    }


def test_protected_routes_need_a_token(client):
    response = client.delete("/api/sessions/current")
    assert response.status_code == 401
    assert response.json() == {
        "error": {"code": "AUTH_REQUIRED", "message": "Authentication required"}
    }
    assert response.headers["www-authenticate"] == "Bearer"


def test_sign_out_revokes_only_that_session(client):
    first = register(client)["token"]
    second = sign_in(client).json()["token"]
    assert client.delete("/api/sessions/current", headers=bearer(first)).status_code == 204
    assert client.delete("/api/sessions/current", headers=bearer(first)).status_code == 401
    assert client.delete("/api/sessions/current", headers=bearer(second)).status_code == 204


def test_expired_tokens_are_rejected(client, db):
    token = register(client)["token"]
    db.scalars(select(UserSession)).one().expires_at = utcnow() - timedelta(seconds=1)
    db.commit()
    assert client.delete("/api/sessions/current", headers=bearer(token)).status_code == 401
