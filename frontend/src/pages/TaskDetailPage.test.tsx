import { screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { beforeEach, expect, it, vi } from "vitest";
import type { AuthResult, Task } from "../api.ts";
import { db, requests, seedTasks, seedUser, server } from "../test/fakeApi.ts";
import { renderApp } from "../test/render.tsx";

let ada: AuthResult;
let milk: Task;

beforeEach(() => {
  ada = seedUser();
  [milk] = seedTasks(ada, ["Buy milk"]);
});

it("opens a task from the list", async () => {
  const { user } = renderApp("/tasks", { as: ada });
  await user.click(await screen.findByRole("link", { name: "Buy milk" }));
  await user.click(await screen.findByRole("link", { name: "Open as page" }));
  expect(
    await screen.findByRole("heading", { name: "Task details" }),
  ).toBeInTheDocument();
  expect(screen.getByLabelText("Title")).toHaveValue("Buy milk");
});

it("saves an edit", async () => {
  const { user } = renderApp(`/tasks/${milk.id}`, { as: ada });
  await user.clear(await screen.findByLabelText("Title"));
  await user.type(screen.getByLabelText("Title"), "Buy oat milk");
  await user.click(screen.getByRole("button", { name: "Save" }));
  expect(await screen.findByRole("status")).toHaveTextContent("Saved");
  expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  expect(requests).toContainEqual({
    method: "PATCH",
    path: `/api/tasks/${milk.id}`,
    body: { title: "Buy oat milk" },
  });
});

it("saves a title and a description", async () => {
  const { user } = renderApp(`/tasks/${milk.id}`, { as: ada });
  await user.clear(await screen.findByLabelText("Title"));
  await user.type(screen.getByLabelText("Title"), "New");
  await user.type(screen.getByLabelText("Description"), "Notes");
  await user.click(screen.getByRole("button", { name: "Save" }));
  expect(await screen.findByRole("status")).toHaveTextContent("Saved");
  expect(requests).toContainEqual({
    method: "PATCH",
    path: `/api/tasks/${milk.id}`,
    body: { title: "New", description: "Notes" },
  });
});

it("won't save a blank title", async () => {
  const { user } = renderApp(`/tasks/${milk.id}`, { as: ada });
  await user.clear(await screen.findByLabelText("Title"));
  await user.type(screen.getByLabelText("Title"), "   ");
  expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
});

it("marks the task done", async () => {
  const { user } = renderApp(`/tasks/${milk.id}`, { as: ada });
  await user.click(await screen.findByRole("checkbox", { name: "Done" }));
  expect(screen.getByRole("checkbox", { name: "Done" })).toBeChecked();
  await waitFor(() => expect(db.tasks.get(milk.id)?.task.completed).toBe(true));
});

it("deletes after confirming and returns to the list", async () => {
  vi.spyOn(window, "confirm").mockReturnValue(true);
  const { user } = renderApp(`/tasks/${milk.id}`, { as: ada });
  await user.click(await screen.findByRole("button", { name: "Delete task" }));
  expect(
    await screen.findByRole("heading", { name: "My tasks" }),
  ).toBeInTheDocument();
  await waitFor(() => expect(db.tasks.has(milk.id)).toBe(false));
  expect(
    screen.queryByRole("link", { name: "Buy milk" }),
  ).not.toBeInTheDocument();
});

it("keeps the task when deletion is cancelled", async () => {
  vi.spyOn(window, "confirm").mockReturnValue(false);
  const { user } = renderApp(`/tasks/${milk.id}`, { as: ada });
  await user.click(await screen.findByRole("button", { name: "Delete task" }));
  expect(
    screen.getByRole("heading", { name: "Task details" }),
  ).toBeInTheDocument();
  expect(requests.filter((r) => r.method === "DELETE")).toEqual([]);
});

it("keeps an unsaved edit when a refresh fails", async () => {
  const { user } = renderApp(`/tasks/${milk.id}`, { as: ada });
  await user.type(await screen.findByLabelText("Title"), " today");
  server.use(
    http.get("/api/tasks/:id", () =>
      HttpResponse.json(
        { error: { code: "INTERNAL_ERROR", message: "Server exploded" } },
        { status: 500 },
      ),
    ),
  );
  await user.click(screen.getByRole("checkbox", { name: "Done" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Server exploded");
  expect(screen.getByLabelText("Title")).toHaveValue("Buy milk today");
});

it("shows not found for a task that doesn't exist", async () => {
  renderApp("/tasks/missing", { as: ada });
  expect(
    await screen.findByRole("heading", { name: "Task not found" }),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("link", { name: "Back to my tasks" }),
  ).toBeInTheDocument();
});

it("shows not found for a malformed task id", async () => {
  // The real API answers 400 for an id that isn't a UUID (E12); the fake ids aren't UUIDs.
  server.use(
    http.get("/api/tasks/not-a-uuid", () =>
      HttpResponse.json(
        {
          error: {
            code: "VALIDATION_ERROR",
            message: "Task id must be a valid id",
            fields: { task_id: "Task id must be a valid id" },
          },
        },
        { status: 400 },
      ),
    ),
  );
  renderApp("/tasks/not-a-uuid", { as: ada });
  expect(
    await screen.findByRole("heading", { name: "Task not found" }),
  ).toBeInTheDocument();
});

it("shows not found if the task was deleted elsewhere", async () => {
  const { user } = renderApp(`/tasks/${milk.id}`, { as: ada });
  await user.type(await screen.findByLabelText("Title"), " today");
  db.tasks.delete(milk.id);
  await user.click(screen.getByRole("button", { name: "Save" }));
  expect(
    await screen.findByRole("heading", { name: "Task not found" }),
  ).toBeInTheDocument();
});
