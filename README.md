# To-Do App

[![CI](https://github.com/eaylagas17/todo-app/actions/workflows/ci.yml/badge.svg)](https://github.com/eaylagas17/todo-app/actions/workflows/ci.yml)

A full-stack to-do list with drag-and-drop ordering, search, subtasks, AI-suggested categories, and tasks that can wait for each other. React + TypeScript, FastAPI, PostgreSQL. Built test-first.

**Live: https://todo-app.calmforest-9fc6134c.centralus.azurecontainerapps.io**. Demo login: `demo@example.com` / `demo-password`. The first load after a quiet spell takes a few seconds while the app wakes up. The **Features** tab shows how to try everything.

## Run it on a Mac

**With Docker** ([Docker Desktop](https://www.docker.com/products/docker-desktop/)):

```bash
docker compose up --build
```

Open http://localhost:8000. The database schema updates itself on start.

**Without Docker** (SQLite; needs Node 22.22+, 24.15+ or 26+):

```bash
brew install uv node
./run.sh
```

Open http://localhost:5173. Ctrl+C stops it.

**Optional:** put `TYPESAFE_API_KEY=…` in `backend/.env` to turn on AI category suggestions.

**Tests:**

```bash
cd backend && uv run pytest --cov=app
cd ../frontend && npm ci && npm test
```

## Summary

### Approach

- **Test-driven.** Each feature started as a failing test, committed first (`test:`), then the code that passed it (`feat:`). Every bug got a failing test before its fix.
- **A small, layered REST API.** `routes.py` (HTTP) → `crud.py` (rules) → `models.py` (tables). One error shape with stable codes. Another user's task is a 404, so ids can't be probed.
- **Secure sessions.** Argon2id password hashes. Random tokens, stored only as SHA-256 hashes, valid for 7 days.
- **Async through one abstraction.** TanStack Query handles caching and retries. Its optimistic updates roll back, with the server's reason, if a change is refused, and changes to a task are sent in click order.
- **Functional style.** Pure, immutable helpers in `tasks.ts`: higher-order filters composed with `allOf`, and `sweep`, which returns a new order.
- **Links as a graph.** Each person's tasks form a DAG. Loops are refused (depth-first search, O(V + E)). Dragging moves linked tasks together, and a new link repairs the order with a stable topological sort.
- **Bounded AI.** The classifier can only pick one of your own categories. Each person gets 10 suggestions a minute and 100 a day, under one app-wide monthly spending cap; all three are checked in the database.
- **Responsive and accessible.** A light and dark Notes-style UI, labelled controls, 44 px touch targets, and drag and drop by mouse, touch or keyboard.

```mermaid
flowchart LR
  UI["React app<br/>pages · TanStack Query · api.ts"] -- "JSON over /api" --> API["FastAPI<br/>routes → crud → models"]
  API -- "SQL" --> DB[("PostgreSQL")]
```

### Features completed

- [x] Sign in or create an account, and see only your own tasks
- [x] Create, view, edit, tick off and delete tasks, in a side panel or on their own screen
- [x] Reorder by drag and drop (mouse, touch, keyboard)
- [x] Search, ignoring case and accents
- [x] Titles and descriptions; subtasks with progress
- [x] Categories with AI suggestions
- [x] Links between tasks ("waits for"), with step numbers, colours and a graph view
- [x] Completed tasks: a 5-second undo, Recently completed, and a Completed page
- [x] Features and Status pages, a demo account, Docker, CI, and a live Azure deployment

### Given more time

Estimates assume working with an AI assistant, as this project was (see [AI assistance](#ai-assistance)).

**To make it more robust before real users:**

| Change | Why | Estimate |
|---|---|---|
| Rate limits per IP address on sign-up, sign-in and AI calls | Stops password guessing, and one person opening many accounts to drain the shared AI budget | 1 h |
| Email confirmation and password reset | Forgotten passwords; throwaway accounts | 3 h |
| Deploys from CI, via GitHub OIDC | Releases are run by hand today | 1 h |
| Browser tests (Playwright) and an accessibility scan in CI | jsdom can't see layout bugs | 3 h |
| Structured logs with request ids | To trace one request across copies | 30 min |
| httpOnly cookie sessions, CSRF protection, a Content Security Policy | Injected script can read a token in `localStorage` | 2 h |

**As usage grows:**

| Signal | Change | Estimate |
|---|---|---|
| Database connections or CPU near the limit | Connection pooling (PgBouncer), then a bigger tier, then read replicas | 1 h, then settings |
| Sign-ins slowing under load | Rate limits, more copies, then tune Argon2 | 30 min |
| Task list slower than ~200 ms at p95 | Keyset pagination | 1 h |
| Edits lost across two devices | A version column with `If-Match` (412 for the stale edit) | 1 h |
| Needing latency and errors per endpoint | OpenTelemetry into Azure Monitor | 4 h |
| v1.0 no longer a rollback target | Rename the task columns to match the code | 15 min |

**More features:**

| Feature | Estimate |
|---|---|
| Due dates and reminders (needs a background worker) | 4 h |
| Undo after deleting | 45 min |
| Search kept in the URL | 30 min |
| Real-time sync across tabs and devices | 4 h |
| Shared to-do lists | 1 day |

**Not planned on purpose:**
- **Kubernetes on AKS:** Container Apps already autoscales.
- **A cache or a queue:** nothing needs one yet.
- **Microservices:** one API and one database fit this domain.

## API

Everything is under `/api`, with interactive docs at `/docs`. All routes except sign-up, sign-in, `/health` and `/status` need `Authorization: Bearer <token>`.

- **Accounts:** `POST /users`, `POST /sessions`, `DELETE /sessions/current`
- **Tasks:** `GET`/`POST /tasks`, `GET`/`PATCH`/`DELETE /tasks/{id}`, and `PUT /task-order` to save the whole order
- **Subtasks:** `POST /tasks/{id}/subtasks`, `PATCH`/`DELETE /tasks/{id}/subtasks/{subtask_id}`
- **Links:** `POST /tasks/{id}/links`, `DELETE /tasks/{id}/links/{depends_on_id}`
- **Categories:** `GET`/`POST /categories`, `PATCH`/`DELETE /categories/{id}`, `POST /tasks/{id}/category-suggestion` (AI)
- **Other:** `POST /examples`, `GET /health`, `GET /status`

Errors are `{"error": {"code", "message", "fields"?}}`:

| Status | Meaning |
|---|---|
| 400 | Validation |
| 401 | Not signed in |
| 404 | Not found |
| 409 | Conflict |
| 429 | Too many AI calls |
| 503 | Unavailable |

## Testing

- **Backend:** 109 pytest tests through the HTTP API, on SQLite and Postgres. The AI is faked from a saved real response. 99% coverage.
- **Frontend:** 182 tests with Vitest, Testing Library and Mock Service Worker, driving the UI as a person would. 94% coverage.
- **CI:** on every push, lint, type checks, both suites on both databases, and a Docker smoke test.
- **Edge cases:** 61, each covered by a named test.

<details>
<summary>The 61 edge cases</summary>

| # | Case | Result |
|---|---|---|
| E1 | Email with capitals or spaces | Normalized |
| E2 | Email already registered | 409 `EMAIL_TAKEN` |
| E3 | Invalid email or password, missing or unknown field | 400, a message per field |
| E4 | Body that isn't JSON | 400 |
| E5 | Wrong password or unknown email | The same 401 for both |
| E6 | Missing, unknown or expired token | 401 |
| E7 | Signing out on one device | Only that session ends |
| E8 | Unknown URL or method | 404 / 405, same error shape |
| E9 | A crash | 500, no internals leaked |
| E10 | Blank or over-long title | 400 |
| E11 | Another user's task | 404 (a 403 would reveal it exists) |
| E12 | Malformed task id | 400 |
| E13 | `null`, an unknown field or an infinite position in a PATCH | 400 |
| E14 | Empty PATCH | 200, nothing changes |
| E15 | SQL-looking text | Stored literally |
| E16 | Server unreachable, or slower than 10 s | A clear message |
| E17 | A non-JSON error page (a proxy's 502) | A fallback message |
| E18 | Saved token rejected | Back to sign-in |
| E19 | Corrupt or blocked browser storage | Signed out; the app still works |
| E20 | A screen crashes | "Something went wrong" and Reload |
| E21 | Double-clicking Add task | One task |
| E22 | A title of only spaces | Add and Save disabled |
| E23 | HTML-looking text | Shown literally (no XSS) |
| E24 | The server refuses a change | Rolled back, with its message |
| E25 | Two moves before the first is saved | Both kept |
| E26 | Switching accounts | The previous user's tasks never show |
| E27 | Accents or capitals in search | "cafe" finds "Café" |
| E28 | Dragging while searching | No drag handles |
| E29 | A task deleted elsewhere | "Task not found" |
| E30 | Refreshing a deep link in Docker | The app loads |
| E31 | Database down | `/api/health` answers 503 |
| E32 | Seeding the demo twice | One demo user |
| E33 | Over-long description (2,000) | 400 naming the field |
| E34 | A subtask on another user's task | 404 |
| E35 | A subtask id from another of my tasks | 404 |
| E36 | A category name in another letter case | 409 `CATEGORY_EXISTS` |
| E37 | Deleting a category | Its tasks become uncategorised |
| E38 | AI off, down, slow, rate-limited or over budget | 503 or 429; the task is unaffected |
| E39 | The AI answers after the person chose | Their choice is kept |
| E40 | Linking a task to itself | 400 |
| E41 | A link that would make a loop | 409, naming the loop |
| E42 | Linking to another user's task | 404 |
| E43 | Saving an order from a stale tab | 409; the list refreshes |
| E44 | An order that breaks a link | 409 |
| E45 | Deleting a task others wait for | Its links go |
| E46 | Dragging while filtering by category | No drag handles |
| E47 | Reduced motion, or no View Transitions | No animation |
| E48 | Unticking within 5 seconds | The task stays |
| E49 | Reloading within the 5 seconds | Shown under Recently completed |
| E50 | Unticking from Recently completed | Back in its old slot |
| E51 | Unticking on the Completed page | Back in the list |
| E52 | Ticking a chain's last open task | The chain leaves together |
| E53 | Unticking a task in a finished chain | The whole chain comes back |
| E54 | Dragging with completed tasks hidden | They keep their slots |
| E55 | Linking to a completed task | It comes back, greyed |
| E56 | Deleting a chain's last open task | Its done tasks leave at once |
| E57 | Dragging a chain to the end of the list | It stops at the end |
| E58 | Escape during a drag | Everything goes back |
| E59 | A database made by v1.0 | Upgraded in place |
| E60 | Three copies starting at once | One migrates, the others wait |
| E61 | Rolling back to v1.0 after an upgrade | v1.0 still works on the new schema |

</details>

## Deploying to the cloud

Live on Azure at the URL above:

- **Azure Container Apps** runs the Docker image: 0 to 3 copies depending on load, with HTTPS. Each release is a new revision, and traffic can be split between revisions.
- **Azure Database for PostgreSQL** (Flexible Server), with TLS required.
- **Migrations** run as each copy starts. A Postgres lock lets one copy migrate while the others wait.
- **Secrets** are stored as Container Apps secrets, never in the image or in git.

For production, I'd add:
- copies across availability zones;
- a zone-redundant standby for the database;
- a private network for the database;
- Key Vault for secrets;
- a CDN (Front Door).

### Releasing and rolling back

A release starts beside the live version with no traffic. It's checked on its own address, and only then takes the traffic. The old version keeps running, so a rollback is one command. This is safe because schema changes only add things; a rename waits for a later release (expand, then contract).

```bash
# 1. Tag the release and publish its image
git tag v1.1.0 && git push origin v1.1.0
SHA=$(git rev-parse --short 'v1.1.0^{commit}')   # the commit, not the annotated tag
docker buildx build --platform linux/amd64 --build-arg GIT_SHA=$SHA \
  -t ghcr.io/eaylagas17/todo-app:$SHA --push .

# 2. Keep the traffic on the live revision, and start the new one beside it
az containerapp ingress traffic set -g todo-rg -n todo-app --revision-weight todo-app--v1-0-0=100
az containerapp update -g todo-rg -n todo-app --revision-suffix v1-1-0 \
  --image ghcr.io/eaylagas17/todo-app:$SHA --set-env-vars SEED_DEMO=1

# 3. Check it on its own address
curl https://todo-app--v1-1-0.calmforest-9fc6134c.centralus.azurecontainerapps.io/api/status

# 4. Move the traffic
az containerapp ingress traffic set -g todo-rg -n todo-app --revision-weight todo-app--v1-1-0=100

# Roll back
az containerapp ingress traffic set -g todo-rg -n todo-app --revision-weight todo-app--v1-0-0=100
```

<details>
<summary>One-time setup</summary>

```bash
az group create -n todo-rg -l centralus
az postgres flexible-server create -g todo-rg -n todo-db-928edc -l centralus --version 18 \
  --tier Burstable --sku-name Standard_B1ms --storage-size 32 \
  --admin-user todo --admin-password "$PGPASS" --public-access 0.0.0.0
az postgres flexible-server db create -g todo-rg -s todo-db-928edc -n todo
az containerapp env create -g todo-rg -n todo-env -l centralus
az containerapp create -g todo-rg -n todo-app --environment todo-env \
  --image ghcr.io/eaylagas17/todo-app:62a77df --revisions-mode multiple --revision-suffix v1-0-0 \
  --ingress external --target-port 8000 --cpu 0.25 --memory 0.5Gi --min-replicas 0 --max-replicas 3 \
  --secrets database-url="postgresql+psycopg://todo:$PGPASS@todo-db-928edc.postgres.database.azure.com:5432/todo?sslmode=require" \
            typesafe-api-key="$TYPESAFE_API_KEY" \
  --env-vars DATABASE_URL=secretref:database-url TYPESAFE_API_KEY=secretref:typesafe-api-key
```

`$PGPASS` is a generated password; `$TYPESAFE_API_KEY` comes from `backend/.env`.

</details>

## Project structure

```
backend/app/     FastAPI: routes, schemas, crud, models, security, errors, graph, ai, status, migrations/
backend/tests/   pytest
frontend/src/    React: pages, components, graph/, queries.ts (TanStack Query), api.ts, tasks.ts
Dockerfile, docker-compose.yml, run.sh, .github/workflows/ci.yml
```

## Credits

Chain icon from [Flaticon](https://www.flaticon.com/free-icon/url_3214746).

## AI assistance

Built with Claude Code (Anthropic's AI coding assistant) as a pair programmer. I directed the scope, the features, the edge cases and the test-first workflow; every change landed with its tests and was checked in a real browser, and I can walk through any file.
