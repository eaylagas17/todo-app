"""Category suggestions from TypeSafe's Jev classifier, with limits checked before every call."""

import os
import uuid
from datetime import timedelta

import httpx
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app import crud
from app.db import utcnow
from app.errors import AiBudgetReached, AiRateLimited, AiUnavailable
from app.models import AiCall, Task, User

JEV_URL = "https://api.typesafe.ai/v1/systemone"
JEV_MODEL = "jev-1.14.0"  # pinned, so the same task gets the same answer
CONFIDENCE = 0.6
PER_MINUTE = 10
PER_DAY = 100
USD_PER_TOKEN = 0.042 / 1_000_000  # input tokens; output is free

# One client for the whole process: it keeps connections to Jev open between calls.
_http = httpx.Client(timeout=5)


def get_http_client() -> httpx.Client:
    """A dependency, so tests can swap in a fake Jev (httpx.MockTransport)."""
    return _http


def monthly_budget() -> float:
    return float(os.environ.get("AI_MONTHLY_BUDGET_USD", "1.00"))


def _calls_since(db: Session, user: User, since) -> int:
    query = select(func.count()).where(AiCall.user_id == user.id, AiCall.at >= since)
    return db.scalar(query)


def _spent_this_month(db: Session) -> float:
    start = utcnow().replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    tokens = db.scalar(
        select(func.coalesce(func.sum(AiCall.input_tokens), 0)).where(
            AiCall.at >= start
        )
    )
    return tokens * USD_PER_TOKEN


def suggest_category(db: Session, user: User, task: Task, http: httpx.Client) -> Task:
    key = os.environ.get("TYPESAFE_API_KEY")
    if not key:
        raise AiUnavailable
    if task.category_id is not None:
        return task

    # Lock the user's row so two requests at once can't both pass the limit (a no-op on
    # SQLite, which allows one writer at a time anyway).
    db.execute(select(User.id).where(User.id == user.id).with_for_update())
    now = utcnow()
    if (
        _calls_since(db, user, now - timedelta(minutes=1)) >= PER_MINUTE
        or _calls_since(db, user, now - timedelta(days=1)) >= PER_DAY
    ):
        db.rollback()
        raise AiRateLimited
    if _spent_this_month(db) >= monthly_budget():
        db.rollback()
        raise AiBudgetReached
    # Recorded before the call, so a failed attempt still counts; the commit ends the lock.
    call = AiCall(user_id=user.id)
    db.add(call)
    db.commit()

    criteria = {str(c.id): c.name for c in crud.list_categories(db, user)}
    body = {
        "model": JEV_MODEL,
        "state": f"Title: {task.title}\nDescription: {task.description}",
        "questions": {
            "category": {
                "type": "choice",
                "instructions": "Which category does this to-do belong to?",
                "criteria": criteria,
            }
        },
    }
    try:
        response = http.post(
            JEV_URL, json=body, headers={"Authorization": f"Bearer {key}"}
        )
        response.raise_for_status()
        data = response.json()
        tokens = int(data["usage"]["input_tokens"])
        answer = data["answers"]["category"]
        choice, confidence = answer["choice"], float(answer["confidence"])
    except httpx.HTTPError, ValueError, KeyError, TypeError:
        raise AiUnavailable from None

    call.input_tokens = tokens
    # The person may have picked a category while Jev was thinking (E39): read it again.
    db.refresh(task)
    if task.category_id is None and confidence >= CONFIDENCE and choice in criteria:
        task.category_id = uuid.UUID(choice)
    db.commit()
    return task
