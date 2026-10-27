import { screen, waitFor } from "@testing-library/react";
import { http } from "msw";
import { beforeEach, expect, it } from "vitest";
import type { AuthResult } from "../api.ts";
import {
  db,
  fail,
  gate,
  requests,
  seedTasks,
  seedUser,
  server,
} from "../test/fakeApi.ts";
import { renderApp, titlesIn } from "../test/render.tsx";

let ada: AuthResult;

beforeEach(() => {
  ada = seedUser();
});

const exploded = () => fail(500, "INTERNAL_ERROR", "Server exploded");

it("shows my tasks in order", async () => {
  const [c, a, b] = seedTasks(ada, ["c", "a", "b"]);
  db.tasks.get(c.id)!.task.position = 3;
  db.tasks.get(a.id)!.task.position = 1;
  db.tasks.get(b.id)!.task.position = 2;
  renderApp("/tasks", { as: ada });
  await screen.findByRole("link", { name: "a" });
  expect(titlesIn()).toEqual(["a", "b", "c"]);
});

it("adds a task and clears the input", async () => {
  const { user } = renderApp("/tasks", { as: ada });
  await user.type(await screen.findByLabelText("New task"), "Buy milk");
  await user.click(screen.getByRole("button", { name: "Add task" }));
  expect(
    await screen.findByRole("link", { name: "Buy milk" }),
  ).toBeInTheDocument();
  expect(screen.getByLabelText("New task")).toHaveValue("");
});

it("shows the description under the title", async () => {
  const [venue] = seedTasks(ada, ["Book the venue"]);
  db.tasks.get(venue.id)!.task.description = "Call three places\nThen pick one";
  renderApp("/tasks", { as: ada });
  expect(await screen.findByText("Call three places")).toBeInTheDocument();
  expect(screen.queryByText(/Then pick one/)).not.toBeInTheDocument();
});

it("won't add a title that is only spaces", async () => {
  const { user } = renderApp("/tasks", { as: ada });
  await user.type(await screen.findByLabelText("New task"), "   ");
  expect(screen.getByRole("button", { name: "Add task" })).toBeDisabled();
});

it("creates one task even if Add task is clicked twice", async () => {
  const { wait, release } = gate();
  server.use(
    http.post("/api/tasks", async () => {
      await wait;
    }),
  );
  const { user } = renderApp("/tasks", { as: ada });
  await user.type(await screen.findByLabelText("New task"), "Buy milk");
  await user.click(screen.getByRole("button", { name: "Add task" }));
  await user.click(screen.getByRole("button", { name: "Add task" }));
  release();
  await screen.findByRole("link", { name: "Buy milk" });
  expect(
    requests.filter((r) => r.method === "POST" && r.path === "/api/tasks"),
  ).toHaveLength(1);
});

it("shows task text literally, even if it looks like HTML", async () => {
  const text = '<img src=x onerror="alert(1)">';
  seedTasks(ada, [text]);
  renderApp("/tasks", { as: ada });
  expect(await screen.findByRole("link", { name: text })).toBeInTheDocument();
  expect(document.querySelector("img")).toBeNull();
});

it("marks a task done", async () => {
  seedTasks(ada, ["Buy milk"]);
  const { user } = renderApp("/tasks", { as: ada });
  await user.click(
    await screen.findByRole("checkbox", { name: "Complete Buy milk" }),
  );
  expect(
    screen.getByRole("checkbox", { name: "Complete Buy milk" }),
  ).toBeChecked();
  await waitFor(() =>
    expect(requests).toContainEqual(
      expect.objectContaining({ body: { completed: true } }),
    ),
  );
});

it("undoes a tick and explains when saving fails", async () => {
  seedTasks(ada, ["Buy milk"]);
  server.use(http.patch("/api/tasks/:id", exploded));
  const { user } = renderApp("/tasks", { as: ada });
  await user.click(
    await screen.findByRole("checkbox", { name: "Complete Buy milk" }),
  );
  expect(await screen.findByRole("alert")).toHaveTextContent("Server exploded");
  expect(
    screen.getByRole("checkbox", { name: "Complete Buy milk" }),
  ).not.toBeChecked();
});

it("deletes a task", async () => {
  seedTasks(ada, ["Buy milk"]);
  const { user } = renderApp("/tasks", { as: ada });
  await user.click(
    await screen.findByRole("button", { name: "Delete Buy milk" }),
  );
  await waitFor(() =>
    expect(
      screen.queryByRole("link", { name: "Buy milk" }),
    ).not.toBeInTheDocument(),
  );
});

it("brings a task back and explains when deleting fails", async () => {
  seedTasks(ada, ["Buy milk"]);
  server.use(http.delete("/api/tasks/:id", exploded));
  const { user } = renderApp("/tasks", { as: ada });
  await user.click(
    await screen.findByRole("button", { name: "Delete Buy milk" }),
  );
  expect(await screen.findByRole("alert")).toHaveTextContent("Server exploded");
  expect(screen.getByRole("link", { name: "Buy milk" })).toBeInTheDocument();
});

it("filters as you type, ignoring case and accents", async () => {
  seedTasks(ada, ["Buy milk", "Café run", "Call mom"]);
  const { user } = renderApp("/tasks", { as: ada });
  await user.type(await screen.findByLabelText("Search tasks"), "CAFE");
  expect(titlesIn()).toEqual(["Café run"]);
});

it("says so when nothing matches", async () => {
  seedTasks(ada, ["Buy milk"]);
  const { user } = renderApp("/tasks", { as: ada });
  await user.type(await screen.findByLabelText("Search tasks"), "zebra");
  expect(
    await screen.findByText('No tasks match "zebra".'),
  ).toBeInTheDocument();
});

it("shows an empty state for a new account", async () => {
  renderApp("/tasks", { as: ada });
  expect(
    await screen.findByText("No tasks yet. Add your first one above."),
  ).toBeInTheDocument();
});

it("offers a retry when tasks fail to load", async () => {
  seedTasks(ada, ["Buy milk"]);
  server.use(http.get("/api/tasks", exploded, { once: true }));
  const { user } = renderApp("/tasks", { as: ada });
  expect(await screen.findByRole("alert")).toHaveTextContent("Server exploded");
  await user.click(screen.getByRole("button", { name: "Try again" }));
  expect(
    await screen.findByRole("link", { name: "Buy milk" }),
  ).toBeInTheDocument();
});

it("keeps the list on screen when a refresh fails", async () => {
  seedTasks(ada, ["Buy milk"]);
  const { user } = renderApp("/tasks", { as: ada });
  await screen.findByRole("link", { name: "Buy milk" });
  server.use(http.get("/api/tasks", exploded));
  await user.click(screen.getByRole("checkbox", { name: "Complete Buy milk" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Server exploded");
  expect(screen.getByRole("link", { name: "Buy milk" })).toBeInTheDocument();
});

it("returns to sign in when the saved token is no longer valid", async () => {
  renderApp("/tasks", {
    as: { user: { id: "u", email: "ada@example.com" }, token: "expired" },
  });
  expect(
    await screen.findByRole("heading", { name: "Sign in" }),
  ).toBeInTheDocument();
  expect(localStorage.getItem("todo.auth")).toBeNull();
});

it("never shows the previous user's tasks after switching accounts", async () => {
  seedTasks(ada, ["Ada's secret"]);
  seedUser("grace@example.com");
  const { user } = renderApp("/tasks", { as: ada });
  await screen.findByRole("link", { name: "Ada's secret" });
  await user.click(screen.getByRole("button", { name: "Sign out" }));

  const { wait, release } = gate();
  server.use(
    http.get("/api/tasks", async () => {
      await wait;
    }),
  );
  await user.type(await screen.findByLabelText("Email"), "grace@example.com");
  await user.type(screen.getByLabelText("Password"), "correct-horse");
  await user.click(screen.getByRole("button", { name: "Sign in" }));
  expect(
    await screen.findByRole("heading", { name: "My tasks" }),
  ).toBeInTheDocument();
  expect(screen.queryByText("Ada's secret")).not.toBeInTheDocument();
  release();
  expect(
    await screen.findByText("No tasks yet. Add your first one above."),
  ).toBeInTheDocument();
});

it("never shows the previous user's tasks when one of their changes fails late", async () => {
  seedTasks(ada, ["Ada's secret"]);
  seedUser("grace@example.com");
  const { wait, release } = gate();
  server.use(
    http.delete("/api/tasks/:id", async () => {
      await wait;
      return exploded();
    }),
  );
  const { user } = renderApp("/tasks", { as: ada });
  await user.click(
    await screen.findByRole("button", { name: "Delete Ada's secret" }),
  );
  await user.click(screen.getByRole("button", { name: "Sign out" }));
  await user.type(await screen.findByLabelText("Email"), "grace@example.com");
  await user.type(screen.getByLabelText("Password"), "correct-horse");
  await user.click(screen.getByRole("button", { name: "Sign in" }));
  expect(
    await screen.findByText("No tasks yet. Add your first one above."),
  ).toBeInTheDocument();
  release();
  await new Promise((resolve) => setTimeout(resolve, 100));
  expect(screen.queryByText("Ada's secret")).not.toBeInTheDocument();
});
