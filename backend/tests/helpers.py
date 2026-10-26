from fastapi.testclient import TestClient
from httpx import Response


def register(
    client: TestClient, email: str = "ada@example.com", password: str = "correct-horse"
) -> dict:
    response = client.post("/api/users", json={"email": email, "password": password})
    assert response.status_code == 201, response.text
    return response.json()


def sign_in(
    client: TestClient, email: str = "ada@example.com", password: str = "correct-horse"
) -> Response:
    return client.post("/api/sessions", json={"email": email, "password": password})


def bearer(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}
