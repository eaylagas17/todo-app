import uuid
from typing import Annotated

from email_validator import EmailNotValidError, validate_email
from pydantic import AfterValidator, BaseModel, ConfigDict, Field, StringConstraints


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
Position = Annotated[float, Field(allow_inf_nan=False)]


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
    position: Position = None


class TaskOut(Output):
    id: uuid.UUID
    title: str
    description: str
    completed: bool
    position: float


class ErrorDetail(Output):
    code: str
    message: str
    fields: dict[str, str] | None = None


class ErrorOut(Output):
    """The error envelope, as documented in /docs; errors.py builds it."""

    error: ErrorDetail
