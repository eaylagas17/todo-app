# To-Do App

A full-stack to-do list: a React single-page app talking to a FastAPI backend on PostgreSQL. Sign in, add tasks, tick them off, search, reorder by drag and drop (mouse, touch or keyboard), and edit or delete a task on its own screen. Built test-first.

**Demo account:** `demo@example.com` / `demo-password` (created automatically with four sample tasks).

## Run it on a Mac

### With Docker (one command)

Requires [Docker Desktop](https://www.docker.com/products/docker-desktop/).

```bash
docker compose up --build
```

Open http://localhost:8000 and sign in with the demo account. One container serves the API and the built frontend; Postgres runs in a second container. Stop with Ctrl+C; `docker compose down -v` also deletes the database.

### Without Docker

```bash
brew install uv node
./run.sh
```

Node 24.15+ (or 22.22+, or 26+) is needed for the frontend tools; `run.sh` checks and says so if yours is older.

Open http://localhost:5173. The API runs on SQLite (port 8000) and Vite serves the frontend; Ctrl+C stops both.

### Run the tests

From the repository root:

```bash
docker compose up -d --wait db      # Postgres, for the second backend run
cd backend
uv run pytest --cov=app             # 49 tests on SQLite
TEST_DATABASE_URL=postgresql+psycopg://todo:todo@localhost:5433/todo_test uv run pytest   # the same tests on Postgres
cd ../frontend
npm ci
npm test                            # 76 tests
npm run lint && npm run typecheck && npm run format:check
```

## Summary of the assignment

### Approach

- **Test-driven.** Every feature started as failing tests, committed on their own (`test: …`), then the code that made them pass (`feat: …`). Bugs found by hand got a failing test before their fix. `git log --oneline` shows the sequence.
- **A small, layered backend.** FastAPI with three layers: `routes.py` (HTTP only), `crud.py` (data and rules, no HTTP), `models.py` (tables). Pydantic validates every request before our code runs. Every task query is scoped to the signed-in user, so there is no way to reach someone else's data.
- **One error contract.** Every failure, from validation to a crash, has the same shape, `{"error": {"code", "message", "fields"?}}`, with stable codes the frontend can rely on. Validation errors are 400, as the brief asks.
- **Sessions I can explain end to end.** Passwords hashed with Argon2id; sign-in issues a random token whose SHA-256 is stored with a 7-day expiry; sign-out deletes that session. A leaked database holds no usable tokens.
- **A frontend that feels instant and never lies.** TanStack Query caches server data. Ticking, deleting and reordering update the screen before the server answers, and roll back with the server's message if it refuses. Network failures, timeouts and unexpected answers each have their own message.
- **Accessible and responsive.** Semantic HTML with Pico CSS, labelled controls, 44px tap targets, keyboard drag and drop with screen-reader announcements, and no horizontal scroll from 375 to 1280 px (checked in a real browser).
- **Easy to run.** One command with Docker, or `./run.sh` without it, both with a demo account. CI runs everything on every push.

### Features completed

The brief's suggested user experience, all done:

- [x] Sign in from the landing page (or create an account)
- [x] See your tasks after signing in
- [x] Change the order of tasks: drag and drop with a mouse, a finger, or the keyboard
- [x] Search tasks (ignores case and accents)
- [x] Open a task to view or edit it on its own screen
- [x] Create, update and delete tasks, and tick them off
- [x] Each user sees only their own tasks; sign out ends the session

Also: optimistic updates with rollback, a health check for load balancers, an error boundary, a demo account, and CI.

### With more time

| Feature | Why | Estimate |
|---|---|---|
| Due dates and reminders | A real to-do feature; reminders need a background worker and a queue | 1 h for dates, 1 day with reminders |
| Filters (all / active / done) and search kept in the URL | Bookmarkable views | 1.5 h |
| Undo after deleting, instead of a confirmation | Faster, friendlier | 1 h |
| Kubernetes manifests verified on a local cluster | Proves the distributed deployment below, not just describes it | 3 h |
| A live deployment on Azure | Reviewers click instead of running | 2 h |
| Password reset and email confirmation | Account recovery | 1 day (needs an email provider) |

### To make it more robust

| Change | What it fixes | Estimate |
|---|---|---|
| A version column with `If-Match` and 412 responses | Two devices editing one task: today the last save wins silently | 2 h |
| Alembic migrations, run as a deploy step | `create_all` can't change existing tables | 2 h |
| Rate limiting on sign-in and sign-up | Password guessing, and Argon2's memory cost under a flood | 2 h |
| Session tokens in httpOnly cookies, with CSRF protection and a Content Security Policy | Tokens out of JavaScript's reach (today they live in `localStorage`) | 3 h |
| Keyset pagination | Lists of thousands of tasks | 2 h |
| Renumbering positions when a gap gets too small | Fractional positions run out of precision after about 50 moves into the same spot | 1 h |
| Structured logs with a request id; separate liveness and readiness probes | Debugging across many copies; no restart loops during a database outage | 1.5 h |
| Generated TypeScript types from the API's OpenAPI schema | Backend changes that would break the frontend fail the type check | 1 h |

## Architecture

```mermaid
flowchart LR
  subgraph B["Browser · React single-page app"]
    P["pages · what you see"] --> Q["queries.ts · TanStack Query cache"]
    P --> T["tasks.ts · ordering and search"]
    Q --> A["api.ts · fetch, token, errors"]
    A --> AU["auth.ts · who is signed in"]
  end
  A -- "JSON over HTTP, /api/..." --> V["Vite proxy :5173 · in Docker, the same FastAPI process"]
  V --> R
  subgraph F["FastAPI :8000"]
    R["routes.py · HTTP layer"] --> SC["schemas.py · validation"]
    R --> SE["security.py · signed-in check"]
    R --> C["crud.py · data and rules"]
    C --> M["models.py · tables"]
    M --> D["db.py · engine, pool, session"]
    R -. "any failure" .-> E["errors.py · one error shape"]
  end
  D -- "SQL" --> PG[("PostgreSQL · SQLite without Docker")]
```

```mermaid
erDiagram
  USERS ||--o{ SESSIONS : "signs in with"
  USERS ||--o{ TASKS : "owns"
  USERS {
    uuid id PK
    string email UK "lowercased, unique index"
    string password_hash "Argon2id"
  }
  SESSIONS {
    string token_hash PK "SHA-256 of the token"
    uuid user_id FK "indexed, cascade delete"
    timestamptz expires_at "7 days"
  }
  TASKS {
    uuid id PK
    uuid owner_id FK "index with position"
    text description "1 to 500 characters"
    boolean completed
    float position "fractional ordering"
    timestamptz created_at "tie-break"
  }
```

Signing in, file by file:

```mermaid
sequenceDiagram
  autonumber
  actor U as Person
  participant SP as SignInPage.tsx
  participant API as api.ts
  participant RT as routes.py
  participant SC as schemas.py
  participant CR as crud.py
  participant SE as security.py
  participant DB as PostgreSQL
  U->>SP: Types email and password, presses Sign in
  SP->>API: login(email, password)
  API->>RT: POST /api/sessions with email and password
  RT->>SC: Validate Credentials, trim and lowercase the email, password 8 to 128
  alt Invalid input
    SC-->>API: 400 VALIDATION_ERROR, built by errors.py
  end
  RT->>CR: authenticate(db, email, password)
  CR->>DB: SELECT the user by email, unique index
  DB-->>CR: The user row, or nothing
  CR->>SE: verify_password with Argon2id, or against the dummy hash if no user
  alt Wrong password or unknown email
    CR-->>API: 401 INVALID_CREDENTIALS, the same answer for both
  else Correct
    CR->>DB: INSERT a session holding the SHA-256 of a new random token, COMMIT
    RT-->>API: 201 with user and token
    API-->>SP: AuthResult
    SP->>SP: Clear the query cache, save the session in auth.ts, go to /tasks
  end
```

**Key choices, briefly:**
- **FastAPI rather than Express:** the brief allows "or similar". Type hints give request validation, response shaping and OpenAPI docs (`/docs`) from one source, and the workload (I/O-bound CRUD) doesn't favour either runtime.
- **A single-page app on Vite rather than Next.js:** every screen sits behind sign-in, so server rendering for search engines doesn't apply, and static files are the simplest thing to put on a CDN in front of a stateless API.
- **PostgreSQL** in Docker and CI; **SQLite** for the no-Docker path and fast local tests. SQLAlchemy keeps the code identical for both, and the suite runs on both.
- **Fractional positions** for ordering: moving a task writes one row, whatever the list's length.

## API

All endpoints are under `/api`. Task endpoints need `Authorization: Bearer <token>`.

| Method and path | Body | Success | Errors |
|---|---|---|---|
| `POST /api/users` | `{email, password}` | 201 `{user, token}` | 400, 409 |
| `POST /api/sessions` | `{email, password}` | 201 `{user, token}` | 400, 401 |
| `DELETE /api/sessions/current` | — | 204 | 401 |
| `GET /api/tasks` | — | 200 `[task]`, in order | 401 |
| `POST /api/tasks` | `{description}` | 201 `task`, with `Location` | 400, 401 |
| `GET /api/tasks/{id}` | — | 200 `task` | 400, 401, 404 |
| `PATCH /api/tasks/{id}` | any of `{description, completed, position}` | 200 `task` | 400, 401, 404 |
| `DELETE /api/tasks/{id}` | — | 204 | 400, 401, 404 |
| `GET /api/health` | — | 200 `{"status": "ok"}` | 503 |

A task is `{id, description, completed, position}`. Interactive docs: http://localhost:8000/docs.

**Errors** always look like `{"error": {"code": "…", "message": "…"}}`; validation errors add `"fields": {"<field>": "<message>"}`.

| Code | Status | Message |
|---|---|---|
| `VALIDATION_ERROR` | 400 | per field, e.g. "Description is required" |
| `AUTH_REQUIRED` | 401 | "Authentication required" |
| `INVALID_CREDENTIALS` | 401 | "Invalid email or password" |
| `TASK_NOT_FOUND` | 404 | "Task not found" (also for another user's task, so ids can't be probed) |
| `NOT_FOUND` / `METHOD_NOT_ALLOWED` | 404 / 405 | "Not found" / "Method not allowed" |
| `EMAIL_TAKEN` | 409 | "Email is already registered" |
| `INTERNAL_ERROR` | 500 | "Something went wrong. Please try again." (no internals leak) |
| `SERVICE_UNAVAILABLE` | 503 | "Database unavailable" |

## Testing

- **Backend:** pytest, 49 tests through the real HTTP stack (FastAPI's `TestClient`), each on a fresh database. They run on SQLite by default and on Postgres with `TEST_DATABASE_URL`; CI runs both. Coverage: 98%.
- **Frontend:** Vitest (Jest-compatible API) with Testing Library (the successor to Enzyme) and Mock Service Worker, 76 tests. Tests drive the whole app the way a person does, finding controls by their accessible names; MSW answers with the real API's status codes and error envelope, so the real request code runs. Coverage: 97% of statements, 94% of branches.
- **TDD in the history:** each `feat:` commit follows the `test:` commit that failed first. Four bugs found while checking the app in a real browser (a sign-in that hung silently while offline, two inaccurate screen-reader announcements, and a garbled task link) each got a failing test before the fix. An independent review of the finished code then found four more (refusals retried for seconds before showing, a failed refresh hiding the list and an unsaved edit, two quick changes to one task saved out of order, and a late failure from a previous session reaching the next user's list), fixed the same way.
- **Checked by hand in a real browser** against the real API: every flow, drag and drop with mouse, touch and keyboard, and layouts at 375, 768 and 1280 px.

### Edge cases

| # | Edge case | Expected behaviour | Test |
|---|---|---|---|
| E1 | Email typed with capitals or spaces | Stored lowercase and trimmed; sign-in still works | `test_sign_in_normalizes_email` |
| E2 | Email already registered, in any letter case | 409 `EMAIL_TAKEN` | `test_register_rejects_a_taken_email` |
| E3 | Invalid email, short or long password, missing or unknown field | 400 with a message per field | `test_register_rejects_invalid_input` |
| E4 | Body is not valid JSON | 400 "Request body is not valid JSON" | `test_malformed_json_is_a_validation_error` |
| E5 | Wrong password, or an unknown email | 401 `INVALID_CREDENTIALS`, the same answer for both | `test_sign_in_rejects_bad_credentials` |
| E6 | No token, unknown token, expired token | 401 `AUTH_REQUIRED` with `WWW-Authenticate: Bearer` | `test_protected_routes_need_a_token`, `test_expired_tokens_are_rejected` |
| E7 | Sign out on one device | Only that session ends | `test_sign_out_revokes_only_that_session` |
| E8 | Unknown URL or wrong method | 404 / 405 in the same error shape | `test_unknown_routes_use_the_error_shape`, `test_wrong_method_uses_the_error_shape` |
| E9 | A bug crashes a request | 500 with a generic message; nothing internal leaks | `test_unexpected_errors_do_not_leak_details` |
| E10 | Description empty, only spaces, or over 500 characters | 400 `VALIDATION_ERROR` | `test_create_task_requires_a_description`, `test_long_descriptions_are_rejected` |
| E11 | Another user's task id | 404 for get, patch and delete (not 403, which would confirm it exists) | `test_someone_elses_task_is_not_found` |
| E12 | Malformed task id | 400 on `task_id`; in the browser, "Task not found" | `test_a_malformed_id_is_a_validation_error`, "shows not found for a malformed task id" |
| E13 | PATCH with `null`, an unknown field, or an infinite position | 400 | `test_patch_rejects_invalid_changes`, `test_patch_rejects_an_infinite_position` |
| E14 | Empty PATCH body | 200, nothing changes | `test_an_empty_patch_changes_nothing` |
| E15 | SQL-looking text in a description | Stored literally; the table is untouched | `test_task_text_is_stored_literally` |
| E16 | Server unreachable, browser offline, or no answer within 10 s | "Can't reach the server…" / "The server took too long…" | `api.test.ts`; "shows the network message when the browser is offline" |
| E17 | An error response that isn't JSON (a proxy's HTML 502) | The generic message, never a parse crash | `api.test.ts` |
| E18 | A saved token the server no longer accepts | Signed out and sent to sign-in | "returns to sign in when the saved token is no longer valid" |
| E19 | Corrupt saved session, or blocked storage | Treated as signed out, or kept in memory | `auth.test.ts` |
| E20 | A screen throws while rendering | "Something went wrong" and Reload, never a blank page | `ErrorBoundary.test.tsx` |
| E21 | Double-click "Add task" | Exactly one task is created | "creates one task even if Add task is clicked twice" |
| E22 | A description of only spaces in the browser | "Add task" and "Save" stay disabled | "won't add…", "won't save a blank description" |
| E23 | Task text that looks like HTML | Shown literally; never becomes markup | "shows task text literally, even if it looks like HTML" |
| E24 | The server refuses a tick, a delete or a move | The screen rolls back and shows the server's message | "undoes a tick and explains…", "brings a task back and explains when deleting fails" |
| E25 | Two moves before the server answers the first | The final order matches both moves | "applies two quick moves in a row" |
| E26 | Sign out, then sign in as someone else | The previous user's tasks never appear | "never shows the previous user's tasks after switching accounts" |
| E27 | Search with accents, capitals or only spaces | "cafe" finds "Café"; a blank search shows everything | `matchesSearch` tests |
| E28 | Dragging while a search is active | Drag handles hidden | "hides drag handles while searching" |
| E29 | A task deleted elsewhere, then opened or saved | "Task not found" | "shows not found if the task was deleted elsewhere" |
| E30 | Refresh on a deep link in the Docker image | The app loads; unknown `/api/*` paths stay JSON 404s | `test_spa_serves_index_for_app_routes` |
| E31 | Database down | `/api/health` answers 503, so a load balancer stops sending traffic | `test_health_reports_database_outage` |
| E32 | Starting twice with the demo seed on | Still exactly one demo user | `test_seed_demo_is_idempotent` |

Known and documented, not fixed: two tasks created at the same instant can share a position (creation time breaks the tie); two devices editing one task: the last save wins (the fix is in "To make it more robust").

## Deploying to the cloud

The Docker image is stateless: sessions and tasks live in Postgres, configuration comes from environment variables, and `/api/health` tells a load balancer whether a copy can serve. So the same image scales out by running more copies.

**Target layout on Azure:**

```mermaid
flowchart TB
  B["Browser"] --> FD["Azure Front Door · CDN for index.html and /assets, TLS, rate limits"]
  FD --> CA["Azure Container Apps · the API image, 2+ replicas across zones, autoscaled"]
  CA --> PG[("Azure Database for PostgreSQL Flexible Server · zone-redundant standby, point-in-time backups")]
  KV["Azure Key Vault · DATABASE_URL"] -.-> CA
  ACR["Azure Container Registry · one image per commit"] -.-> CA
```

**Steps** (Azure CLI; replace the `<…>` names, which must be globally unique for the registry and the database server):

```bash
az group create --name todo-rg --location westeurope

# 1. Registry, and the image built in Azure from this repository
az acr create --resource-group todo-rg --name <registry> --sku Basic
az acr build --registry <registry> --image todo-app:1 .

# 2. Managed Postgres with a standby in another availability zone
az postgres flexible-server create --resource-group todo-rg --name <db-server> \
  --tier GeneralPurpose --sku-name Standard_D2ds_v5 --high-availability ZoneRedundant \
  --admin-user todo --admin-password '<strong password>' --database-name todo

# 3. The API: several replicas behind Container Apps' built-in load balancer
az containerapp env create --resource-group todo-rg --name todo-env --location westeurope
az containerapp create --resource-group todo-rg --name todo-app --environment todo-env \
  --image <registry>.azurecr.io/todo-app:1 --registry-server <registry>.azurecr.io --registry-identity system \
  --target-port 8000 --ingress external --min-replicas 2 --max-replicas 10 \
  --secrets database-url='postgresql+psycopg://todo:<password>@<db-server>.postgres.database.azure.com:5432/todo?sslmode=require' \
  --env-vars DATABASE_URL=secretref:database-url
```

Then:
- **Network:** let the container app reach the database, preferably by putting the Container Apps environment and the database in one virtual network (private access); a firewall rule for the environment's outbound IPs also works.
- **Health probes:** point the readiness probe at `/api/health`, so a replica that can't reach the database stops receiving traffic, and keep the liveness probe free of database checks, so an outage doesn't cause restart loops.
- **Secrets:** move `database-url` into Key Vault and reference it from the container app, so it never appears in a command history or the image.
- **CDN:** put Azure Front Door in front and cache `/assets/*` (hashed file names, already served with `Cache-Control: immutable`) at the edge; `index.html` is served `no-cache`, so a deploy is visible at once.
- **Zones:** create the Container Apps environment on a virtual network with zone redundancy enabled, so replicas spread across availability zones.
- **Rolling deploys:** each new image becomes a new revision; traffic moves only once its replicas pass the health check.

I haven't run these commands against a live subscription; they describe the deployment I'd do, and the image and health checks they rely on are tested locally and in CI. On Kubernetes (AKS) the same image would run as a Deployment with readiness and liveness probes, a Service, an Ingress, a HorizontalPodAutoscaler and a PodDisruptionBudget.

## AI assistance

I built this with Claude Code, Anthropic's AI coding assistant, as a pair programmer. I directed the work: the scope, the features and edge cases to cover, the test-first workflow, and the decisions recorded above. The assistant proposed designs and wrote most of the code, each change landed with its tests and was checked in a real browser, and I study a line-by-line annotated copy of the code so I can explain and defend every decision. Commits carry no AI trailer lines; this section is the disclosure.

## Project structure

```
.
├── backend/                 FastAPI app (Python 3.14, uv)
│   ├── app/
│   │   ├── main.py          create_app(): routes, error handlers, the built frontend, startup
│   │   ├── routes.py        HTTP endpoints under /api
│   │   ├── schemas.py       request and response shapes, validation
│   │   ├── crud.py          reading and writing data; business rules
│   │   ├── models.py        tables: users, sessions, tasks
│   │   ├── security.py      Argon2id passwords, session tokens, the signed-in check
│   │   ├── errors.py        the error contract
│   │   ├── seed.py          the demo account
│   │   └── db.py            engine, connection pool, sessions
│   └── tests/               pytest, on SQLite or Postgres
├── frontend/                React 19 + TypeScript + Vite
│   └── src/
│       ├── api.ts           every request, the token, ApiError and NetworkError
│       ├── auth.ts          who is signed in (localStorage + useSyncExternalStore)
│       ├── queries.ts       TanStack Query hooks, optimistic updates
│       ├── tasks.ts         pure functions: ordering, moving, search
│       ├── pages/           sign-in, task list, task detail
│       ├── components/      a task row, the sortable list
│       └── test/            a fake API (MSW) and render helpers
├── Dockerfile               three stages: build the frontend, install Python packages, run
├── docker-compose.yml       the app and Postgres
├── run.sh                   run without Docker
└── .github/workflows/ci.yml backend, frontend and a Docker smoke test
```
