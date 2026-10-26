# Stage 1: build the frontend into static files. Node exists only in this stage.
FROM node:24-alpine AS frontend
WORKDIR /frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# Stage 2: install the Python dependencies. uv exists only in this stage.
FROM python:3.14-slim AS backend
COPY --from=ghcr.io/astral-sh/uv:0.9.26 /uv /usr/local/bin/uv
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy UV_PYTHON_DOWNLOADS=never
WORKDIR /app
COPY backend/pyproject.toml backend/uv.lock ./
RUN uv sync --frozen --no-dev

# Stage 3: the image that runs: Python, the dependencies, the API and the built frontend.
FROM python:3.14-slim
WORKDIR /app
COPY --from=backend /app/.venv ./.venv
COPY backend/app ./app
COPY --from=frontend /frontend/dist ./static
ENV PATH="/app/.venv/bin:$PATH" STATIC_DIR=/app/static
RUN useradd --system --create-home app && chown app /app
USER app
EXPOSE 8000
CMD ["fastapi", "run", "app/main.py", "--port", "8000"]
