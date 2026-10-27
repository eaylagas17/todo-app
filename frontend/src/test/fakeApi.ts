import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import type { AuthResult, Subtask, Task } from "../api.ts";

type Account = { id: string; email: string; password: string };
type Credentials = { email: string; password: string };
type Recorded = { method: string; path: string; body?: unknown };

// A small in-memory stand-in for the backend: the same URLs, status codes and error envelope.
export const db = {
  users: new Map<string, Account>(),
  sessions: new Map<string, string>(),
  tasks: new Map<string, { ownerId: string; task: Task }>(),
};

/** Every task request the fake server answered, so tests can check what was sent. */
export const requests: Recorded[] = [];

let lastId = 0;
const nextId = () => `id-${++lastId}`;

export function resetDb() {
  db.users.clear();
  db.sessions.clear();
  db.tasks.clear();
  requests.length = 0;
}

function startSession(account: Account): AuthResult {
  const token = nextId();
  db.sessions.set(token, account.id);
  return { user: { id: account.id, email: account.email }, token };
}

export function seedUser(
  email = "ada@example.com",
  password = "correct-horse",
): AuthResult {
  const account = { id: nextId(), email, password };
  db.users.set(email, account);
  return startSession(account);
}

const tasksOf = (ownerId: string) =>
  [...db.tasks.values()].filter((entry) => entry.ownerId === ownerId);

function addTask(ownerId: string, title: string, description = ""): Task {
  const top = Math.max(0, ...tasksOf(ownerId).map(({ task }) => task.position));
  const task = {
    id: nextId(),
    title,
    description,
    completed: false,
    position: top + 1,
    subtasks: [],
  };
  db.tasks.set(task.id, { ownerId, task });
  return { ...task };
}

/** Tasks for an existing session, at positions 1, 2, 3…, each with an empty description. */
export function seedTasks(auth: AuthResult, titles: string[]): Task[] {
  return titles.map((title) => addTask(auth.user.id, title));
}

/** Holds a handler until the test calls release(), to look at the screen mid-request. */
export function gate() {
  let release = () => {};
  const wait = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { wait, release };
}

const fail = (status: number, code: string, message: string) =>
  HttpResponse.json({ error: { code, message } }, { status });

const signedInUser = (request: Request) =>
  db.sessions.get(
    request.headers.get("Authorization")?.replace("Bearer ", "") ?? "",
  );

function record(request: Request, body?: unknown) {
  requests.push({
    method: request.method,
    path: new URL(request.url).pathname,
    body,
  });
}

// Looks up the caller and the task the URL names; a missing or foreign task is 404, as on the server.
function ownTask(request: Request, id: string) {
  const ownerId = signedInUser(request);
  const entry = db.tasks.get(id);
  if (!ownerId)
    return { error: fail(401, "AUTH_REQUIRED", "Authentication required") };
  if (entry?.ownerId !== ownerId)
    return { error: fail(404, "TASK_NOT_FOUND", "Task not found") };
  return { task: entry.task };
}

// The task first (404 TASK_NOT_FOUND if it isn't the caller's), then the subtask within it.
function ownSubtask(request: Request, params: Record<string, unknown>) {
  const { task, error } = ownTask(request, String(params.id));
  if (error) return { error };
  const subtask = task.subtasks.find((s) => s.id === params.subtaskId);
  if (!subtask)
    return { error: fail(404, "SUBTASK_NOT_FOUND", "Subtask not found") };
  return { task, subtask };
}

export const server = setupServer(
  http.post("/api/users", async ({ request }) => {
    const { email, password } = (await request.json()) as Credentials;
    if (db.users.has(email))
      return fail(409, "EMAIL_TAKEN", "Email is already registered");
    const account = { id: nextId(), email, password };
    db.users.set(email, account);
    return HttpResponse.json(startSession(account), { status: 201 });
  }),
  http.post("/api/sessions", async ({ request }) => {
    const { email, password } = (await request.json()) as Credentials;
    const account = db.users.get(email);
    if (account?.password !== password) {
      return fail(401, "INVALID_CREDENTIALS", "Invalid email or password");
    }
    return HttpResponse.json(startSession(account), { status: 201 });
  }),
  http.delete("/api/sessions/current", ({ request }) => {
    const token =
      request.headers.get("Authorization")?.replace("Bearer ", "") ?? "";
    if (!db.sessions.delete(token))
      return fail(401, "AUTH_REQUIRED", "Authentication required");
    return new HttpResponse(null, { status: 204 });
  }),
  // Deliberately unsorted (insertion order): the client must sort by position itself.
  http.get("/api/tasks", ({ request }) => {
    record(request);
    const ownerId = signedInUser(request);
    if (!ownerId) return fail(401, "AUTH_REQUIRED", "Authentication required");
    return HttpResponse.json(tasksOf(ownerId).map(({ task }) => ({ ...task })));
  }),
  http.post("/api/tasks", async ({ request }) => {
    const body = (await request.json()) as {
      title: string;
      description?: string;
    };
    record(request, body);
    const ownerId = signedInUser(request);
    if (!ownerId) return fail(401, "AUTH_REQUIRED", "Authentication required");
    return HttpResponse.json(
      addTask(ownerId, body.title.trim(), body.description),
      {
        status: 201,
      },
    );
  }),
  http.get("/api/tasks/:id", ({ request, params }) => {
    record(request);
    const { task, error } = ownTask(request, String(params.id));
    return error ?? HttpResponse.json({ ...task });
  }),
  http.patch("/api/tasks/:id", async ({ request, params }) => {
    const changes = (await request.json()) as Partial<Task>;
    record(request, changes);
    const { task, error } = ownTask(request, String(params.id));
    if (error) return error;
    Object.assign(task, changes);
    return HttpResponse.json({ ...task });
  }),
  http.post("/api/tasks/:id/subtasks", async ({ request, params }) => {
    const body = (await request.json()) as { title: string };
    record(request, body);
    const { task, error } = ownTask(request, String(params.id));
    if (error) return error;
    const subtask = { id: nextId(), title: body.title, completed: false };
    task.subtasks.push(subtask);
    return HttpResponse.json({ ...subtask }, { status: 201 });
  }),
  http.patch(
    "/api/tasks/:id/subtasks/:subtaskId",
    async ({ request, params }) => {
      const changes = (await request.json()) as Partial<Subtask>;
      record(request, changes);
      const { subtask, error } = ownSubtask(request, params);
      if (error) return error;
      Object.assign(subtask, changes);
      return HttpResponse.json({ ...subtask });
    },
  ),
  http.delete("/api/tasks/:id/subtasks/:subtaskId", ({ request, params }) => {
    record(request);
    const { task, subtask, error } = ownSubtask(request, params);
    if (error) return error;
    task.subtasks = task.subtasks.filter((s) => s !== subtask);
    return new HttpResponse(null, { status: 204 });
  }),
  http.delete("/api/tasks/:id", ({ request, params }) => {
    record(request);
    const { error } = ownTask(request, String(params.id));
    if (error) return error;
    db.tasks.delete(String(params.id));
    return new HttpResponse(null, { status: 204 });
  }),
);
