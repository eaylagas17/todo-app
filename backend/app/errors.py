from collections.abc import Callable
from http import HTTPStatus
from typing import ClassVar

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException


class AppError(Exception):
    status_code = 500
    code = "INTERNAL_ERROR"
    message = "Something went wrong. Please try again."
    headers: ClassVar[dict[str, str]] = {}
    fields: dict[str, str] | None = None


class AuthRequired(AppError):
    status_code = 401
    code = "AUTH_REQUIRED"
    message = "Authentication required"
    headers: ClassVar[dict[str, str]] = {"WWW-Authenticate": "Bearer"}


class InvalidCredentials(AppError):
    status_code = 401
    code = "INVALID_CREDENTIALS"
    message = "Invalid email or password"
    headers: ClassVar[dict[str, str]] = {"WWW-Authenticate": "Bearer"}


class EmailTaken(AppError):
    status_code = 409
    code = "EMAIL_TAKEN"
    message = "Email is already registered"


class TaskNotFound(AppError):
    status_code = 404
    code = "TASK_NOT_FOUND"
    message = "Task not found"


class SubtaskNotFound(AppError):
    status_code = 404
    code = "SUBTASK_NOT_FOUND"
    message = "Subtask not found"


class InvalidField(AppError):
    """A value that passes the schema but not a rule only the database can check."""

    status_code = 400
    code = "VALIDATION_ERROR"

    def __init__(self, field: str, message: str):
        super().__init__(message)
        self.message = message
        self.fields = {field: message}


class CategoryExists(AppError):
    status_code = 409
    code = "CATEGORY_EXISTS"
    message = "You already have a category with that name"


class CategoryNotFound(AppError):
    status_code = 404
    code = "CATEGORY_NOT_FOUND"
    message = "Category not found"


class AiUnavailable(AppError):
    status_code = 503
    code = "AI_UNAVAILABLE"
    message = "AI suggestions are unavailable right now"


class AiRateLimited(AppError):
    status_code = 429
    code = "AI_RATE_LIMITED"
    message = "Too many AI requests. Try again in a minute."


class AiBudgetReached(AppError):
    status_code = 503
    code = "AI_BUDGET_REACHED"
    message = "AI suggestions are paused for this month"


class ServiceUnavailable(AppError):
    status_code = 503
    code = "SERVICE_UNAVAILABLE"
    message = "Database unavailable"


def error_response(
    status_code: int,
    code: str,
    message: str,
    fields: dict[str, str] | None = None,
    headers: dict[str, str] | None = None,
) -> JSONResponse:
    error = {"code": code, "message": message} | ({"fields": fields} if fields else {})
    return JSONResponse({"error": error}, status_code=status_code, headers=headers)


def _label(error: dict) -> str:
    return str(error["loc"][-1]).replace("_", " ").capitalize()


def _too_short(error: dict) -> str:
    minimum = error["ctx"]["min_length"]
    if minimum == 1:
        return f"{_label(error)} is required"
    return f"{_label(error)} must be at least {minimum} characters"


MESSAGES: dict[str, Callable[[dict], str]] = {
    "missing": lambda e: f"{_label(e)} is required",
    "string_too_short": _too_short,
    "string_too_long": lambda e: (
        f"{_label(e)} must be at most {e['ctx']['max_length']} characters"
    ),
    "extra_forbidden": lambda e: f"Unknown field: {e['loc'][-1]}",
    "json_invalid": lambda e: "Request body is not valid JSON",
    "uuid_parsing": lambda e: f"{_label(e)} must be a valid id",
    "value_error": lambda e: e["msg"].removeprefix("Value error, "),
}


def friendly_message(error: dict) -> str:
    if error["type"] in MESSAGES:
        return MESSAGES[error["type"]](error)
    if error.get("input", "") is None:
        return f"{_label(error)} cannot be null"
    return error["msg"]


def _field(error: dict) -> str:
    return "body" if error["type"] == "json_invalid" else str(error["loc"][-1])


async def _app_error(request: Request, exc: AppError) -> JSONResponse:
    return error_response(
        exc.status_code, exc.code, exc.message, exc.fields, exc.headers
    )


async def _validation_error(
    request: Request, exc: RequestValidationError
) -> JSONResponse:
    fields: dict[str, str] = {}
    for error in exc.errors():
        fields.setdefault(_field(error), friendly_message(error))
    return error_response(400, "VALIDATION_ERROR", next(iter(fields.values())), fields)


async def _http_error(request: Request, exc: HTTPException) -> JSONResponse:
    phrase = HTTPStatus(exc.status_code).phrase
    code = phrase.upper().replace(" ", "_")
    return error_response(
        exc.status_code, code, phrase.capitalize(), headers=exc.headers
    )


async def _unexpected_error(request: Request, exc: Exception) -> JSONResponse:
    # Starlette re-raises the exception after this response is sent, so the server still logs
    # the full traceback; the client only ever sees the generic message.
    return error_response(500, AppError.code, AppError.message)


def register_error_handlers(app: FastAPI) -> None:
    app.add_exception_handler(AppError, _app_error)
    app.add_exception_handler(RequestValidationError, _validation_error)
    app.add_exception_handler(HTTPException, _http_error)
    app.add_exception_handler(Exception, _unexpected_error)
