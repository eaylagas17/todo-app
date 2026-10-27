import os
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.openapi.utils import get_openapi
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy.orm import Session

from app.db import engine
from app.errors import register_error_handlers
from app.migrate import migrate
from app.routes import router
from app.seed import seed_demo


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    migrate(engine)
    if os.environ.get("SEED_DEMO") == "1":
        with Session(engine) as db:
            seed_demo(db)
    yield


class HashedFiles(StaticFiles):
    """Vite puts a content hash in every built file name, so a cached copy never goes stale."""

    def file_response(self, *args, **kwargs):
        response = super().file_response(*args, **kwargs)
        response.headers["Cache-Control"] = "public, max-age=31536000, immutable"
        return response


def without_422(app: FastAPI):
    """FastAPI documents every validation failure as 422; ours answer 400 (errors.py)."""

    def openapi() -> dict:
        if app.openapi_schema is None:
            schema = get_openapi(
                title=app.title, version=app.version, routes=app.routes
            )
            for methods in schema["paths"].values():
                for operation in methods.values():
                    operation["responses"].pop("422", None)
            for unused in ("HTTPValidationError", "ValidationError"):
                schema["components"]["schemas"].pop(unused, None)
            app.openapi_schema = schema
        return app.openapi_schema

    return openapi


def create_app(static_dir: Path | None = None) -> FastAPI:
    app = FastAPI(title="To-Do API", lifespan=lifespan)
    app.openapi = without_422(app)
    app.include_router(router)
    register_error_handlers(app)
    if static_dir is not None:
        add_single_page_app(app, static_dir.resolve())
    return app


def add_single_page_app(app: FastAPI, static_dir: Path) -> None:
    app.mount("/assets", HashedFiles(directory=static_dir / "assets"), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    def single_page_app(path: str) -> FileResponse:
        if path == "api" or path.startswith("api/"):
            raise HTTPException(status_code=404)
        file = (static_dir / path).resolve()
        if file.is_file() and file.is_relative_to(static_dir):
            return FileResponse(file)
        # Any other path is a screen of the app (/tasks/123): the browser router takes it from here.
        return FileResponse(
            static_dir / "index.html", headers={"Cache-Control": "no-cache"}
        )


app = create_app(Path(os.environ["STATIC_DIR"]) if "STATIC_DIR" in os.environ else None)
