# To-Do App

[![CI](https://github.com/eaylagas17/todo-app/actions/workflows/ci.yml/badge.svg)](https://github.com/eaylagas17/todo-app/actions/workflows/ci.yml)

A full-stack to-do list: sign in, add, tick, search, reorder by drag and drop, and edit tasks in a side panel or on their own screen. Tasks have subtasks and categories (suggested by AI), and can wait for each other; a graph view draws those links. A ticked task waits five seconds for an undo, then moves under Recently completed. React + TypeScript frontend, FastAPI backend, PostgreSQL. Built test-first.

**Demo account:** `demo@example.com` / `demo-password` (created automatically, with a small example plan). The **Features** tab lists every feature with a way to try it.

## Run it on a Mac

**With Docker** ([Docker Desktop](https://www.docker.com/products/docker-desktop/)):

```bash
docker compose up --build
```

Open http://localhost:8000. One container serves the app and the API; Postgres runs beside it.
After pulling schema changes, reset the local database: `docker compose down -v` (or, without Docker, delete `backend/todo.db`).

**Without Docker** (uses SQLite; needs Node 24.15+, 22.22+ or 26+):

```bash
brew install uv node
./run.sh
```

Open http://localhost:5173. Ctrl+C stops everything.

**AI categories (optional):** put `TYPESAFE_API_KEY=…` in `backend/.env`; without it the app runs with manual categories.

**Tests:**

```bash
cd backend && uv run pytest --cov=app        # 123 tests
cd ../frontend && npm ci && npm test         # 208 tests
```

## Summary

### Approach

- **Test-driven.** Each feature started as failing tests, committed first (`test:`), then the code that passed them (`feat:`). Bugs found later got a failing test before the fix. `git log` shows the sequence.
- **A small, layered API.** `routes.py` handles HTTP, `crud.py` the data and rules, `models.py` the tables. Pydantic validates every request; every failure returns one JSON shape with a stable code. Validation errors are 400; another user's task is 404, so ids can't be probed.
- **Secure sessions.** Passwords hashed with Argon2id. Sign-in issues a random token, stored only as a SHA-256 hash, valid 7 days; sign-out deletes it.
- **Async through one abstraction.** TanStack Query owns every request: caching, retries of only the failures worth retrying, and task changes queued in click order. Ticking, deleting and reordering show at once and roll back with the server's message if it refuses. Offline, timeouts and server errors each get a clear message.
- **Functional and declarative.** Pure, immutable helpers (`tasks.ts`: `toSorted`, `toSpliced`, a search filter made by a higher-order function); every optimistic change is one hook that takes an update function. Components describe the screen from state.
- **Links between tasks, as a graph.** "A waits for B" is an edge in a per-user DAG. A link that would make a loop is refused (depth-first search, O(V + E)). Dragging is a snowball (one pass, O(V + E)): the dragged task lands exactly where you let go, and the linked tasks it reaches on the way join it and travel along. Creating a link repairs the order on the server with a two-pass topological sort (Kahn's algorithm with a priority queue, O((V + E) log V)), tested against a shared table. Chains are coloured by age (the oldest gets the first of six colours), so dragging never recolours one; a colour shifts only when an older chain appears or goes.
- **AI that can't go wrong in a bad way.** Categories are suggested by TypeSafe's Jev, a classifier that can only answer with one of the person's own category ids, so the worst case is a wrong category, never injected text. Per-person limits and a monthly spend cap are checked in the database before every call, so every copy of the server shares them.
- **Responsive and accessible.** Our own small stylesheet (an iPhone Notes look, light and dark), labelled controls, 44 px tap targets, and drag and drop by mouse, touch or keyboard (with screen-reader announcements); every drag has a keyboard alternative.
- **Easy to run anywhere.** A stateless API on Postgres, one Docker image, and CI on every push.

```mermaid
flowchart LR
  UI["React app<br/>pages · TanStack Query · api.ts"] -- "JSON over /api" --> API["FastAPI<br/>routes → crud → models"]
  API -- "SQL" --> DB[("PostgreSQL")]
```

### Features completed

- [x] Sign in from the landing page, or create an account
- [x] See your tasks after signing in; only your own
- [x] Reorder by drag and drop (mouse, touch, keyboard); linked tasks travel with the dragged one
- [x] Search, ignoring case and accents
- [x] Open a task to view or edit it on its own screen
- [x] Create, update, tick off and delete tasks
- [x] Demo account, health check, Docker image, CI
- [x] A title and an optional description per task
- [x] Subtasks: a checklist in each task, with "1 of 3" in the list
- [x] Categories, with AI suggestions and limits
- [x] Links between tasks, with step numbers, group colours, and an order that keeps them; an arrow shows the link while you drag it
- [x] A graph view: steps as columns, links as arrows, subtasks as branches
- [x] A Features tab and a Status page
- [x] Completed tasks: a 5-second undo, Recently completed under the list, and a Completed page

### With more time

Estimates are for me working with an AI assistant, the way this project was built (see [AI assistance](#ai-assistance)). The assistant writes most of the code; my time goes into deciding what to build, reviewing every change, testing it in a real browser, and making sure I can explain it.

| Feature | Estimate |
|---|---|
| Due dates and reminders (reminders need a background worker) | 4 h |
| Search kept in the URL, so a filtered view survives a reload and can be shared | 30 min |
| Undo after deleting (the same 5-second window that completing uses) | 45 min |
| Shared to-dos: a shared task keeps its creator's category; each person orders it in their own list; a link is visible only to its maker unless both tasks are shared | 1 day |
| Kubernetes on AKS (Container Apps already runs on Kubernetes; AKS pays off with many services or a service mesh) | 4 h |
| Monitoring: Prometheus and Grafana, plus tracing | 4 h |
| Real-time sync between tabs and devices | 4 h |
| Password reset and email confirmation | 3 h |
| Browser tests in CI: Playwright checks of layout and flows (rows that shift when filtering, the drag, the undo window) and an accessibility scan; screenshot comparisons later. Today's tests run in jsdom, which can't see layout | 3 h |

### To make it more robust

| Change | Why | Estimate |
|---|---|---|
| Version column with `If-Match` → 412 | Two devices editing one task: today the last save wins | 1 h |
| Alembic migrations as a deploy step | Now urgent: the cloud database is live, and `create_all` can't change existing tables | 1 h |
| Azure Container Registry with a managed identity | Pull the image without a public registry | 30 min |
| VNet integration for the database | Today it accepts connections from Azure services | 1 h |
| Rate limiting on sign-up, sign-in and AI calls | Password guessing (Argon2 is memory-heavy under a flood), and many new accounts draining the shared AI budget | 1 h |
| httpOnly cookie sessions, CSRF protection, a Content Security Policy | Keeps tokens out of JavaScript's reach | 2 h |
| Keyset pagination | Lists of thousands of tasks | 1 h |
| Structured logs with request ids | Tracing a request across many copies | 30 min |

## API

All under `/api` (interactive docs at http://localhost:8000/docs). Task routes need `Authorization: Bearer <token>`.

- `POST /users`, `POST /sessions`, `DELETE /sessions/current`: sign up, sign in, sign out
- `GET /tasks`, `POST /tasks {title, description?}`, `GET /tasks/{id}`, `PATCH /tasks/{id} {title?, description?, completed?, category_id?}`, `DELETE /tasks/{id}`: tasks (each with its `subtasks` and `waits_for`)
- `PUT /task-order {ids}`: the whole list's new order
- `POST /tasks/{id}/subtasks {title}`, `PATCH`/`DELETE /tasks/{id}/subtasks/{subtask_id}`: subtasks
- `POST /tasks/{id}/links {depends_on_id}`, `DELETE /tasks/{id}/links/{depends_on_id}`: "this task waits for that one"
- `GET`/`POST /categories {name}`, `PATCH`/`DELETE /categories/{id}`; `POST /tasks/{id}/category-suggestion`: ask the AI
- `POST /examples`: add the example tasks
- `GET /health`: 200, or 503 when the database is unreachable; `GET /status`: version, replica, uptime, database, and whether AI is on; always 200

Errors are always `{"error": {"code": "…", "message": "…"}}` (plus `fields` for validation): 400 validation, 401 not signed in, 404 not found, 409 conflicts (email taken, category exists, a link loop, a stale order), 429 too many AI requests, 503 AI or database unavailable.

## Testing

- **Backend:** 123 pytest tests through the real HTTP stack, on SQLite and on Postgres. The AI is replaced by a fake that answers with a real saved response, so tests never call the network. Coverage 99%.
- **Frontend:** 208 tests with Vitest (Jest's API), Testing Library and Mock Service Worker, driving the app the way a person does. Coverage 94% (the graph's pinch and pan are checked in a real browser instead).
- **Edge cases:** 58, each pinned by a named test. Bugs found in a real browser or by an independent review each got a failing test before the fix.
- **CI** (GitHub Actions) runs lint, types, both suites on both databases, and a Docker smoke test on every push.

<details>
<summary>The 58 edge cases</summary>

| # | Case | Behaviour |
|---|---|---|
| E1–E2 | Email with capitals or spaces; already registered | Normalized; 409 `EMAIL_TAKEN` |
| E3–E4 | Invalid input; body that isn't JSON | 400 with a message per field |
| E5 | Wrong password or unknown email | The same 401 for both |
| E6–E7 | Missing or expired token; sign out on one device | 401; only that session ends |
| E8–E9 | Unknown URL or method; a crash | Same error shape; no internals leaked |
| E10–E15 | Blank or over-long title (200) or description (2000); another user's task; bad id; `null` or unknown fields; empty PATCH; SQL-looking text | 400 / 404 / unchanged / stored literally |
| E16–E17 | Offline, timeout, or a non-JSON error page | Clear messages, never a crash |
| E18–E20 | Expired saved session; corrupt storage; a screen crash | Back to sign-in; still works; "Something went wrong" + Reload |
| E21–E23 | Double-click Add; only spaces; HTML-looking text | One task; button disabled; shown literally |
| E24–E26 | Server refuses a change; two quick moves; switching accounts | Rolled back with the reason; both kept; no stale tasks |
| E27–E29 | Accents in search; dragging while searching; task deleted elsewhere | Matched; handles hidden; "Task not found" |
| E30–E32 | Deep-link refresh in Docker; database down; seeding twice | App loads; 503 health; one demo user |
| E33 | Blank or over-long title; over-long description | 400 naming the field |
| E34–E35 | A subtask on someone else's task; a subtask id from another of my tasks | 404 `TASK_NOT_FOUND`; 404 `SUBTASK_NOT_FOUND` |
| E36–E37 | Same category name in another case; deleting a category | 409 `CATEGORY_EXISTS`; its tasks become uncategorised, a filter on it falls back to All |
| E38–E39 | AI: no key, down or slow, too many, budget reached; an answer landing after the person chose | 503 / 503 / 429 / 503, the task unaffected; the person's choice kept |
| E40–E42 | Linking a task to itself; a loop; someone else's task | 400 `LINK_SELF`; 409 `LINK_CYCLE` naming the loop; 404 |
| E43–E44 | Saving an order from a stale tab; an order that breaks a link | 409 `ORDER_STALE`, the list refreshes; 409 `ORDER_BREAKS_LINK` |
| E45 | Deleting a task others wait for | Its links go; dependents lose their step |
| E46–E47 | Dragging while filtering by category; reduced motion or no View Transitions | No drag handles; changes apply without animation |
| E48–E49 | Unticking within 5 seconds; reloading inside the window | The task stays; it shows under Recently completed |
| E50–E51 | Unticking from Recently completed or the Completed page | Back in the list, in its old slot |
| E52–E53 | Ticking the last open task of a chain; unticking one task of a finished chain | The chain leaves together; the whole chain comes back |
| E54–E55 | Dragging with completed tasks hidden; linking to a completed task | Hidden tasks keep their slots; it comes back, greyed |
| E56 | Deleting the last open task of a chain | Its done tasks close up at once, without the bar |
| E57–E58 | Dragging a chain into the end of the list; Escape mid-drag | It stops like a pushed stack; everything goes back |

</details>

## Deploying to the cloud

The API is stateless (sessions live in Postgres, settings come from environment variables), so the same image scales out by running more copies behind a load balancer that checks `/api/health`. On Azure:

- **Azure Container Apps:** the image as 2+ replicas across availability zones, autoscaled, with a readiness probe on `/api/health`
- **Azure Database for PostgreSQL (Flexible Server):** a zone-redundant standby and point-in-time backups
- **Azure Front Door:** a CDN for the built files (hashed names, cached a year) and TLS
- **Azure Key Vault:** `DATABASE_URL`, never baked into the image

<details>
<summary>Azure CLI steps</summary>

```bash
az group create --name todo-rg --location westeurope
az acr create --resource-group todo-rg --name <registry> --sku Basic
az acr build --registry <registry> --image todo-app:1 .

az postgres flexible-server create --resource-group todo-rg --name <db-server> \
  --tier GeneralPurpose --sku-name Standard_D2ds_v5 --high-availability ZoneRedundant \
  --admin-user todo --admin-password '<strong password>' --database-name todo

az containerapp env create --resource-group todo-rg --name todo-env --location westeurope
az containerapp create --resource-group todo-rg --name todo-app --environment todo-env \
  --image <registry>.azurecr.io/todo-app:1 --registry-server <registry>.azurecr.io --registry-identity system \
  --target-port 8000 --ingress external --min-replicas 2 --max-replicas 10 \
  --secrets database-url='postgresql+psycopg://todo:<password>@<db-server>.postgres.database.azure.com:5432/todo?sslmode=require' \
  --env-vars DATABASE_URL=secretref:database-url
```

Then put the app and the database in one virtual network, point the readiness probe at `/api/health`, and move the secret into Key Vault. These steps weren't run against a live subscription; the image and health checks they rely on are tested.

</details>

## Project structure

```
backend/app/     FastAPI: routes, schemas, crud, models, security, errors; graph.py (links), ai.py (Jev), status.py
backend/tests/   pytest
frontend/src/    React: pages, components, graph/ (the graph view), queries.ts (TanStack Query), api.ts, tasks.ts
shared/          the order-repair test table, used by both test suites
Dockerfile, docker-compose.yml, run.sh, .github/workflows/ci.yml
```

## Credits

Chain icon from [Flaticon](https://www.flaticon.com/free-icon/url_3214746).

## AI assistance

Built with Claude Code (Anthropic's AI coding assistant) as a pair programmer. I directed the scope, the features, the edge cases and the test-first workflow; every change landed with its tests and was checked in a real browser, and I can walk through any file.
