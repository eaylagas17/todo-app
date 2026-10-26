import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import type { AuthResult } from "../api.ts";

type Account = { id: string; email: string; password: string };
type Credentials = { email: string; password: string };

// A small in-memory stand-in for the backend: the same URLs, status codes and error envelope.
export const db = {
  users: new Map<string, Account>(),
  sessions: new Map<string, string>(),
};

let lastId = 0;
const nextId = () => `id-${++lastId}`;

export function resetDb() {
  db.users.clear();
  db.sessions.clear();
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

const fail = (status: number, code: string, message: string) =>
  HttpResponse.json({ error: { code, message } }, { status });

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
);
