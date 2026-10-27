import { clearAuth, getAuth } from "./auth.ts";

export type User = { id: string; email: string };

export type Subtask = { id: string; title: string; completed: boolean };

export type Category = { id: string; name: string };

export type Task = {
  id: string;
  title: string;
  description: string;
  completed: boolean;
  position: number;
  subtasks: Subtask[];
  category_id: string | null;
  /** Ids of the tasks this one waits for. */
  waits_for: string[];
};

export type AuthResult = { user: User; token: string };

export const NETWORK_MESSAGE =
  "Can't reach the server. Check your connection and try again.";
export const TIMEOUT_MESSAGE =
  "The server took too long to respond. Please try again.";
export const FALLBACK_MESSAGE = "Something went wrong. Please try again.";

/** The server answered, with an error. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

export const hasStatus = (error: unknown, ...statuses: number[]) =>
  error instanceof ApiError && statuses.includes(error.status);

/** There was no answer: offline, DNS failure, refused connection, or a timeout. */
export class NetworkError extends Error {
  readonly timedOut: boolean;

  constructor(timedOut = false) {
    super(timedOut ? TIMEOUT_MESSAGE : NETWORK_MESSAGE);
    this.name = "NetworkError";
    this.timedOut = timedOut;
  }
}

type Envelope = { error?: { code?: unknown; message?: unknown } };

async function toApiError(response: Response): Promise<ApiError> {
  const { error } = ((await response.json().catch(() => null)) ??
    {}) as Envelope;
  return typeof error?.code === "string" && typeof error.message === "string"
    ? new ApiError(response.status, error.code, error.message)
    : new ApiError(response.status, "UNKNOWN_ERROR", FALLBACK_MESSAGE);
}

export async function request<T>(
  path: string,
  {
    method = "GET",
    body,
  }: {
    method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
    body?: unknown;
  } = {},
): Promise<T> {
  const auth = getAuth();
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      method,
      headers: {
        ...(body !== undefined && { "Content-Type": "application/json" }),
        ...(auth && { Authorization: `Bearer ${auth.token}` }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (error) {
    throw new NetworkError(
      error instanceof DOMException && error.name === "TimeoutError",
    );
  }
  if (response.status === 401 && auth) clearAuth();
  if (!response.ok) throw await toApiError(response);
  return response.status === 204
    ? (undefined as T)
    : ((await response.json()) as T);
}

const credentials = (email: string, password: string) => ({
  method: "POST" as const,
  body: { email, password },
});

export const login = (email: string, password: string) =>
  request<AuthResult>("/sessions", credentials(email, password));

export const register = (email: string, password: string) =>
  request<AuthResult>("/users", credentials(email, password));

export const logout = () =>
  request<void>("/sessions/current", { method: "DELETE" });

export type TaskChanges = Partial<Omit<Task, "id" | "subtasks" | "waits_for">>;

// encodeURIComponent: an id taken from the page's URL can't change which API path is called.
const taskPath = (id: string) => `/tasks/${encodeURIComponent(id)}`;

export const listTasks = () => request<Task[]>("/tasks");

export const getTask = (id: string) => request<Task>(taskPath(id));

export const createTask = (title: string, description?: string) =>
  request<Task>("/tasks", { method: "POST", body: { title, description } });

export const updateTask = (id: string, changes: TaskChanges) =>
  request<Task>(taskPath(id), { method: "PATCH", body: changes });

export const deleteTask = (id: string) =>
  request<void>(taskPath(id), { method: "DELETE" });

const subtasksPath = (taskId: string) => `${taskPath(taskId)}/subtasks`;
const subtaskPath = (taskId: string, subtaskId: string) =>
  `${subtasksPath(taskId)}/${encodeURIComponent(subtaskId)}`;

export const addSubtask = (taskId: string, title: string) =>
  request<Subtask>(subtasksPath(taskId), { method: "POST", body: { title } });

export const updateSubtask = (
  taskId: string,
  subtaskId: string,
  changes: Partial<Omit<Subtask, "id">>,
) =>
  request<Subtask>(subtaskPath(taskId, subtaskId), {
    method: "PATCH",
    body: changes,
  });

export const deleteSubtask = (taskId: string, subtaskId: string) =>
  request<void>(subtaskPath(taskId, subtaskId), { method: "DELETE" });

export const listCategories = () => request<Category[]>("/categories");

export const createCategory = (name: string) =>
  request<Category>("/categories", { method: "POST", body: { name } });

const categoryPath = (id: string) => `/categories/${encodeURIComponent(id)}`;

export const renameCategory = (id: string, name: string) =>
  request<Category>(categoryPath(id), { method: "PATCH", body: { name } });

export const deleteCategory = (id: string) =>
  request<void>(categoryPath(id), { method: "DELETE" });

/** Asks the server to ask Jev. Answers with the task, categorised or not. */
export const suggestCategory = (taskId: string) =>
  request<Task>(`${taskPath(taskId)}/category-suggestion`, { method: "POST" });

/** "taskId waits for dependsOnId". Answers with the whole list, in its repaired order. */
export const linkTasks = (taskId: string, dependsOnId: string) =>
  request<Task[]>(`${taskPath(taskId)}/links`, {
    method: "POST",
    body: { depends_on_id: dependsOnId },
  });

export const unlinkTasks = (taskId: string, dependsOnId: string) =>
  request<void>(
    `${taskPath(taskId)}/links/${encodeURIComponent(dependsOnId)}`,
    { method: "DELETE" },
  );

/** The whole list's new order, top to bottom. */
export const saveOrder = (ids: string[]) =>
  request<Task[]>("/task-order", { method: "PUT", body: { ids } });
