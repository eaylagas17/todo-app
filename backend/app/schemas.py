import uuid
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
