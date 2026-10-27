import { screen, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { beforeEach, expect, it } from "vitest";
import type { AuthResult } from "../api.ts";
import { seedUser, server } from "../test/fakeApi.ts";
import { renderApp } from "../test/render.tsx";

let ada: AuthResult;

beforeEach(() => {
  ada = seedUser();
});

const answer = (replica: string) => ({
  version: "abc123",
  replica,
  started_at: "2026-10-27T09:00:00Z",
  uptime_seconds: 3725,
  database: { ok: true, latency_ms: 1.4 },
  ai: {
    enabled: true,
    calls_today: 3,
    spent_this_month_usd: 0.0002,
    monthly_budget_usd: 1,
    per_user_per_minute: 10,
    per_user_per_day: 100,
  },
});

it("shows the running version and the database state", async () => {
  server.use(http.get("/api/status", () => HttpResponse.json(answer("app-1"))));
  renderApp("/status", { as: ada });
  expect(await screen.findByText("abc123")).toBeInTheDocument();
  expect(screen.getByText("OK, 1.4 ms")).toBeInTheDocument();
  expect(screen.getByText("1 h 2 min")).toBeInTheDocument();
});

it("remembers which replicas answered", async () => {
  const replicas = ["app-1", "app-2"];
  server.use(
    http.get("/api/status", () =>
      HttpResponse.json(answer(replicas.shift() ?? "app-2")),
    ),
  );
  const { user } = renderApp("/status", { as: ada });
  const seen = await screen.findByRole("list", {
    name: "Replicas that answered",
  });
  expect(await within(seen).findByText("app-1")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Refresh now" }));
  expect(await within(seen).findByText("app-2")).toBeInTheDocument();
  expect(within(seen).getByText("app-1")).toBeInTheDocument();
});

it("the header shows a Status tab", async () => {
  const { user } = renderApp("/tasks", { as: ada });
  const nav = await screen.findByRole("navigation", { name: "Main" });
  await user.click(within(nav).getByRole("link", { name: "Status" }));
  expect(
    await screen.findByRole("heading", { name: "Status", level: 1 }),
  ).toBeInTheDocument();
});

it("links to the interactive API docs, in a new tab", async () => {
  renderApp("/status", { as: ada });
  const docs = await screen.findByRole("link", {
    name: "Open the interactive API docs",
  });
  expect(docs).toHaveAttribute("href", "/docs");
  expect(docs).toHaveAttribute("target", "_blank");
  expect(docs).toHaveAttribute("rel", "noreferrer");
});
