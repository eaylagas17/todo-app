import { clearAuth, getAuth } from "./auth.ts";

export type User = { id: string; email: string };

export type Task = {
  id: string;
  description: string;
  completed: boolean;
  position: number;
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

/** There was no answer: offline, DNS failure, refused connection, or a timeout. */
export class NetworkError extends Error {
  name = "NetworkError";
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
  }: { method?: "GET" | "POST" | "PATCH" | "DELETE"; body?: unknown } = {},
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
    const timedOut =
      error instanceof DOMException && error.name === "TimeoutError";
    throw new NetworkError(timedOut ? TIMEOUT_MESSAGE : NETWORK_MESSAGE);
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
