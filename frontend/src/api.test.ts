import { http, HttpResponse } from "msw";
import { expect, it, vi } from "vitest";
import {
  ApiError,
  FALLBACK_MESSAGE,
  NETWORK_MESSAGE,
  NetworkError,
  request,
  TIMEOUT_MESSAGE,
} from "./api.ts";
import { getAuth, saveAuth } from "./auth.ts";
import { gate, server } from "./test/fakeApi.ts";

it("sends JSON and returns the parsed body", async () => {
  server.use(
    http.post("/api/echo", async ({ request }) =>
      HttpResponse.json(await request.json(), { status: 201 }),
    ),
  );
  await expect(
    request("/echo", { method: "POST", body: { a: 1 } }),
  ).resolves.toEqual({ a: 1 });
});

it("returns undefined for 204 responses", async () => {
  server.use(
    http.delete("/api/thing", () => new HttpResponse(null, { status: 204 })),
  );
  await expect(
    request("/thing", { method: "DELETE" }),
  ).resolves.toBeUndefined();
});

it("adds the bearer token only when signed in", async () => {
  const seen: (string | null)[] = [];
  server.use(
    http.get("/api/who", ({ request }) => {
      seen.push(request.headers.get("Authorization"));
      return HttpResponse.json({});
    }),
  );
  await request("/who");
  saveAuth({ user: { id: "u", email: "ada@example.com" }, token: "abc" });
  await request("/who");
  expect(seen).toEqual([null, "Bearer abc"]);
});

it("throws ApiError with the server's code and message", async () => {
  server.use(
    http.post("/api/users", () =>
      HttpResponse.json(
        {
          error: {
            code: "EMAIL_TAKEN",
            message: "Email is already registered",
          },
        },
        { status: 409 },
      ),
    ),
  );
  const error = await request("/users", { method: "POST", body: {} }).catch(
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(ApiError);
  expect(error).toMatchObject({
    status: 409,
    code: "EMAIL_TAKEN",
    message: "Email is already registered",
  });
});

it("uses the fallback for error bodies that aren't ours", async () => {
  server.use(
    http.get(
      "/api/broken",
      () =>
        new HttpResponse("<h1>Bad Gateway</h1>", {
          status: 502,
          headers: { "Content-Type": "text/html" },
        }),
    ),
  );
  await expect(request("/broken")).rejects.toMatchObject({
    status: 502,
    code: "UNKNOWN_ERROR",
    message: FALLBACK_MESSAGE,
  });
});

it("reports an unreachable server as a NetworkError", async () => {
  server.use(http.get("/api/down", () => HttpResponse.error()));
  const error = await request("/down").catch((e: unknown) => e);
  expect(error).toBeInstanceOf(NetworkError);
  expect(error).toMatchObject({ message: NETWORK_MESSAGE });
});

it("reports a timeout as a NetworkError with its own message", async () => {
  vi.spyOn(globalThis, "fetch").mockRejectedValue(
    new DOMException("timed out", "TimeoutError"),
  );
  await expect(request("/slow")).rejects.toMatchObject({
    message: TIMEOUT_MESSAGE,
  });
});

it("signs the user out when the server rejects their token", async () => {
  saveAuth({ user: { id: "u", email: "ada@example.com" }, token: "stale" });
  server.use(
    http.get("/api/tasks", () =>
      HttpResponse.json(
        {
          error: { code: "AUTH_REQUIRED", message: "Authentication required" },
        },
        { status: 401 },
      ),
    ),
  );
  await expect(request("/tasks")).rejects.toMatchObject({ status: 401 });
  expect(getAuth()).toBeNull();
});

it("a late 401 for a previous session doesn't sign out the next user", async () => {
  const { wait, release } = gate();
  server.use(
    http.get("/api/tasks", async () => {
      await wait;
      return HttpResponse.json(
        {
          error: { code: "AUTH_REQUIRED", message: "Authentication required" },
        },
        { status: 401 },
      );
    }),
  );
  saveAuth({ user: { id: "1", email: "ada@example.com" }, token: "ada-token" });
  const late = request("/tasks");
  saveAuth({
    user: { id: "2", email: "grace@example.com" },
    token: "grace-token",
  });
  release();
  await expect(late).rejects.toMatchObject({ status: 401 });
  expect(getAuth()?.token).toBe("grace-token");
});
