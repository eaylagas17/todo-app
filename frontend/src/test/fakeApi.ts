import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import type { AuthResult, Category, Subtask, Task } from "../api.ts";
import { repair } from "./repair.ts";

type Account = { id: string; email: string; password: string };
type Credentials = { email: string; password: string };
type Recorded = { method: string; path: string; body?: unknown };

// A small in-memory stand-in for the backend: the same URLs, status codes and error envelope.
export const db = {
  users: new Map<string, Account>(),
  sessions: new Map<string, string>(),
  tasks: new Map<string, { ownerId: string; task: Task }>(),
  categories: new Map<string, { ownerId: string; category: Category }>(),
};

const DEFAULT_CATEGORIES = ["Work", "Home", "Errands", "Health", "Finance"];

/** Every task request the fake server answered, so tests can check what was sent. */
export const requests: Recorded[] = [];

let lastId = 0;
const nextId = () => `id-${++lastId}`;

export function resetDb() {
  db.users.clear();
  db.sessions.clear();
  db.tasks.clear();
  db.categories.clear();
  requests.length = 0;
}

function addCategory(ownerId: string, name: string): Category {
  const category = { id: nextId(), name };
  db.categories.set(category.id, { ownerId, category });
  return { ...category };
}

// Every new account starts with the default categories, as on the server.
function addAccount(email: string, password: string): Account {
  const account = { id: nextId(), email, password };
  db.users.set(email, account);
  DEFAULT_CATEGORIES.forEach((name) => addCategory(account.id, name));
  return account;
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
  return startSession(addAccount(email, password));
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
    category_id: null,
    waits_for: [],
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

const categoriesOf = (ownerId: string) =>
  [...db.categories.values()].filter((entry) => entry.ownerId === ownerId);

function ownCategory(request: Request, id: string) {
  const ownerId = signedInUser(request);
  const entry = db.categories.get(id);
  if (!ownerId)
    return { error: fail(401, "AUTH_REQUIRED", "Authentication required") };
  if (entry?.ownerId !== ownerId)
    return { error: fail(404, "CATEGORY_NOT_FOUND", "Category not found") };
  return { ownerId, category: entry.category };
}

const nameTaken = (ownerId: string, name: string, except?: string) =>
  categoriesOf(ownerId).some(
    ({ category }) =>
      category.id !== except &&
      category.name.toLowerCase() === name.toLowerCase(),
  );

const exists = () =>
  fail(409, "CATEGORY_EXISTS", "You already have a category with that name");

// The task first (404 TASK_NOT_FOUND if it isn't the caller's), then the subtask within it.
function ownSubtask(request: Request, params: Record<string, unknown>) {
  const { task, error } = ownTask(request, String(params.id));
  if (error) return { error };
  const subtask = task.subtasks.find((s) => s.id === params.subtaskId);
  if (!subtask)
    return { error: fail(404, "SUBTASK_NOT_FOUND", "Subtask not found") };
  return { task, subtask };
}

/** True if any task sits above a task it waits for. */
function breaksLink(
  order: string[],
  waitsFor: Record<string, string[]>,
): boolean {
  const index = new Map(order.map((id, i) => [id, i]));
  return order.some((id) =>
    (waitsFor[id] ?? []).some(
      (p) => index.has(p) && index.get(p)! > index.get(id)!,
    ),
  );
}

// The caller's list in order, and its links, for the link and order routes.
function ownList(ownerId: string) {
  const tasks = tasksOf(ownerId)
    .map(({ task }) => task)
    .sort((a, b) => a.position - b.position);
  const waitsFor = Object.fromEntries(tasks.map((t) => [t.id, t.waits_for]));
  return { tasks, order: tasks.map((t) => t.id), waitsFor };
}

function renumber(tasks: Task[], order: string[]) {
  for (const task of tasks) task.position = order.indexOf(task.id) + 1;
}

const listOf = (ownerId: string) =>
  ownList(ownerId).tasks.map((task) => ({ ...task }));

export const server = setupServer(
  http.post("/api/users", async ({ request }) => {
    const { email, password } = (await request.json()) as Credentials;
    if (db.users.has(email))
      return fail(409, "EMAIL_TAKEN", "Email is already registered");
    return HttpResponse.json(startSession(addAccount(email, password)), {
      status: 201,
    });
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
  // Mirrors crud.link: self 400, someone else's 404, a loop 409, repairs the order "down".
  http.post("/api/tasks/:id/links", async ({ request, params }) => {
    const body = (await request.json()) as { depends_on_id: string };
    record(request, body);
    const { task, error } = ownTask(request, String(params.id));
    if (error) return error;
    if (body.depends_on_id === task.id)
      return fail(400, "LINK_SELF", "A task can't wait for itself");
    const target = ownTask(request, body.depends_on_id);
    if (target.error) return target.error;
    const ownerId = signedInUser(request)!;
    const { tasks, order, waitsFor } = ownList(ownerId);
    if (!task.waits_for.includes(body.depends_on_id)) {
      const linked = {
        ...waitsFor,
        [task.id]: [...task.waits_for, body.depends_on_id],
      };
      const desired = order.filter((id) => id !== task.id);
      desired.splice(desired.indexOf(body.depends_on_id) + 1, 0, task.id);
      let repaired: string[];
      try {
        repaired = breaksLink(order, linked)
          ? repair(desired, linked, "down")
          : order;
      } catch {
        return fail(409, "LINK_CYCLE", "That would make a loop");
      }
      task.waits_for.push(body.depends_on_id);
      renumber(tasks, repaired);
    }
    return HttpResponse.json(listOf(ownerId), { status: 201 });
  }),
  http.delete("/api/tasks/:id/links/:dependsOnId", ({ request, params }) => {
    record(request);
    const { task, error } = ownTask(request, String(params.id));
    if (error) return error;
    task.waits_for = task.waits_for.filter((id) => id !== params.dependsOnId);
    return new HttpResponse(null, { status: 204 });
  }),
  // Mirrors crud.set_order: exactly the caller's tasks, in an order that keeps every link.
  http.put("/api/task-order", async ({ request }) => {
    const { ids, previous } = (await request.json()) as {
      ids: string[];
      previous: string[];
    };
    record(request, { ids, previous });
    const ownerId = signedInUser(request);
    if (!ownerId) return fail(401, "AUTH_REQUIRED", "Authentication required");
    const { tasks, order, waitsFor } = ownList(ownerId);
    if (
      ids.length !== new Set(ids).size ||
      [...ids].sort().join() !== [...order].sort().join() ||
      previous.join() !== order.join()
    )
      return fail(
        409,
        "ORDER_STALE",
        "Your list changed elsewhere. Refresh and try again.",
      );
    if (breaksLink(ids, waitsFor))
      return fail(
        409,
        "ORDER_BREAKS_LINK",
        "A task can't move above a task it waits for.",
      );
    renumber(tasks, ids);
    return HttpResponse.json(listOf(ownerId));
  }),
  http.get("/api/status", () =>
    HttpResponse.json({
      version: "dev",
      replica: "test",
      started_at: "2026-10-27T00:00:00Z",
      uptime_seconds: 5,
      database: { ok: true, latency_ms: 1 },
      ai: null,
    }),
  ),
  // A smaller copy of seed.EXAMPLE: the titles, in order, and the links between them.
  http.post("/api/examples", ({ request }) => {
    record(request);
    const ownerId = signedInUser(request);
    if (!ownerId) return fail(401, "AUTH_REQUIRED", "Authentication required");
    const added = new Map<string, Task>();
    for (const [title, waitsFor] of [
      ["Book the venue", []],
      ["Confirm guest list", []],
      ["Send invitations", ["Book the venue", "Confirm guest list"]],
      ["Seating plan", ["Send invitations"]],
      ["Renew passport", []],
      ["Book flights", ["Renew passport"]],
      ["Order the cake", []],
    ] as const) {
      const task = addTask(ownerId, title);
      db.tasks.get(task.id)!.task.waits_for = waitsFor.map(
        (name) => added.get(name)!.id,
      );
      added.set(title, task);
    }
    return HttpResponse.json(listOf(ownerId), { status: 201 });
  }),
  // Without a TYPESAFE_API_KEY the real server answers this; tests that want a category say so.
  http.post("/api/tasks/:id/category-suggestion", ({ request }) => {
    record(request);
    return fail(
      503,
      "AI_UNAVAILABLE",
      "AI suggestions are unavailable right now",
    );
  }),
  http.get("/api/categories", ({ request }) => {
    const ownerId = signedInUser(request);
    if (!ownerId) return fail(401, "AUTH_REQUIRED", "Authentication required");
    return HttpResponse.json(
      categoriesOf(ownerId).map(({ category }) => ({ ...category })),
    );
  }),
  http.post("/api/categories", async ({ request }) => {
    const { name } = (await request.json()) as { name: string };
    record(request, { name });
    const ownerId = signedInUser(request);
    if (!ownerId) return fail(401, "AUTH_REQUIRED", "Authentication required");
    if (nameTaken(ownerId, name.trim())) return exists();
    return HttpResponse.json(addCategory(ownerId, name.trim()), {
      status: 201,
    });
  }),
  http.patch("/api/categories/:id", async ({ request, params }) => {
    const { name } = (await request.json()) as { name: string };
    record(request, { name });
    const { ownerId, category, error } = ownCategory(
      request,
      String(params.id),
    );
    if (error) return error;
    if (nameTaken(ownerId, name.trim(), category.id)) return exists();
    category.name = name.trim();
    return HttpResponse.json({ ...category });
  }),
  http.delete("/api/categories/:id", ({ request, params }) => {
    record(request);
    const { ownerId, category, error } = ownCategory(
      request,
      String(params.id),
    );
    if (error) return error;
    db.categories.delete(category.id);
    for (const { task } of tasksOf(ownerId))
      if (task.category_id === category.id) task.category_id = null;
    return new HttpResponse(null, { status: 204 });
  }),
  http.delete("/api/tasks/:id", ({ request, params }) => {
    record(request);
    const { error } = ownTask(request, String(params.id));
    if (error) return error;
    db.tasks.delete(String(params.id));
    // Its links go too, both ways (E45).
    for (const { task } of db.tasks.values())
      task.waits_for = task.waits_for.filter((id) => id !== params.id);
    return new HttpResponse(null, { status: 204 });
  }),
);
