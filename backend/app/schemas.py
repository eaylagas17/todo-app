import uuid
from datetime import UTC, datetime
from typing import Annotated

from email_validator import EmailNotValidError, validate_email
from pydantic import AfterValidator, BaseModel, ConfigDict, StringConstraints


def normalize_email(value: str) -> str:
    try:
        return validate_email(
            value.strip().lower(), check_deliverability=False
        ).normalized
    except EmailNotValidError:
        raise ValueError("Email is invalid") from None


Email = Annotated[str, AfterValidator(normalize_email)]
Password = Annotated[str, StringConstraints(min_length=8, max_length=128)]
Title = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)
]
Body = Annotated[str, StringConstraints(max_length=2000)]
CategoryName = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=40)
]


def as_utc(value: datetime) -> datetime:
    """SQLite drops the offset: a stored UTC time comes back naive. Every stored time is UTC."""
    return value if value.tzinfo else value.replace(tzinfo=UTC)


# A time on the wire always says it's UTC ("+00:00"), so a browser never reads it as local time.
UtcDateTime = Annotated[datetime, AfterValidator(as_utc)]


class Input(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Output(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class Credentials(Input):
    email: Email
    password: Password


class UserOut(Output):
    id: uuid.UUID
    email: str


class AuthOut(Output):
    user: UserOut
    token: str


class TaskCreate(Input):
    title: Title
    description: Body = ""


class TaskUpdate(Input):
    # Pydantic doesn't validate defaults: a field left out stays unset (and exclude_unset skips
    # it), while an explicit null fails the type check.
    title: Title = None
    description: Body = None
    completed: bool = None
    # The one field where an explicit null is allowed: it clears the category.
    category_id: uuid.UUID | None = None


class SubtaskCreate(Input):
    title: Title


class SubtaskUpdate(Input):
    title: Title = None
    completed: bool = None


class SubtaskOut(Output):
    id: uuid.UUID
    title: str
    completed: bool


class TaskOut(Output):
    id: uuid.UUID
    title: str
    description: str
    completed: bool
    position: float
    subtasks: list[SubtaskOut]
    category_id: uuid.UUID | None
    waits_for: list[uuid.UUID]
    created_at: UtcDateTime
    completed_at: UtcDateTime | None


class LinkIn(Input):
    depends_on_id: uuid.UUID


class OrderIn(Input):
    """The signed-in user's whole list, top to bottom, and the order the drag started from."""

    ids: list[uuid.UUID]
    previous: list[uuid.UUID]


class CategoryIn(Input):
    name: CategoryName


class CategoryOut(Output):
    id: uuid.UUID
    name: str


class DatabaseStatus(Output):
    ok: bool
    latency_ms: float | None


class StatusOut(Output):
    version: str
    replica: str
    started_at: datetime
    uptime_seconds: int
    database: DatabaseStatus
    ai_enabled: bool


class ErrorDetail(Output):
    code: str
    message: str
    fields: dict[str, str] | None = None


class ErrorOut(Output):
    """The error envelope, as documented in /docs; errors.py builds it."""

    error: ErrorDetail
