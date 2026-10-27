import { screen, waitFor, within } from "@testing-library/react";
import { beforeEach, expect, it } from "vitest";
import type { AuthResult, Task } from "../api.ts";
import { db, requests, seedTasks, seedUser } from "../test/fakeApi.ts";
import { findPanel, renderApp } from "../test/render.tsx";

let ada: AuthResult;
let venue: Task;
let invites: Task;

beforeEach(() => {
  ada = seedUser();
  [venue, invites] = seedTasks(ada, ["Book the venue", "Send invitations"]);
  db.tasks.get(invites.id)!.task.waits_for = [venue.id];
  db.tasks.get(venue.id)!.task.subtasks = [
    { id: "s1", title: "Shortlist", completed: false },
    { id: "s2", title: "Visit", completed: false },
  ];
});

const graph = () => screen.findByRole("region", { name: "Task graph" });

it("switches to the graph and back, keeping the URL in step", async () => {
  const { user } = renderApp("/tasks", { as: ada });
  await user.click(await screen.findByRole("button", { name: "Graph" }));
  expect(await graph()).toBeInTheDocument();
  expect(screen.getByTestId("location")).toHaveTextContent("/tasks?view=graph");
  expect(screen.queryByRole("list", { name: "Tasks" })).toBeNull();
  await user.click(screen.getByRole("button", { name: "List" }));
  expect(
    await screen.findByRole("list", { name: "Tasks" }),
  ).toBeInTheDocument();
  expect(screen.getByTestId("location")).toHaveTextContent(/^\/tasks$/);
});

it("opens the panel from a node", async () => {
  const { user } = renderApp("/tasks?view=graph", { as: ada });
  await user.click(
    await within(await graph()).findByRole("link", { name: /^Book the venue/ }),
  );
  expect(await findPanel()).toBeInTheDocument();
  expect(screen.getByTestId("location")).toHaveTextContent(`task=${venue.id}`);
  expect(screen.getByTestId("location")).toHaveTextContent("view=graph");
});

it("folds and unfolds subtasks", async () => {
  const { user } = renderApp("/tasks?view=graph", { as: ada });
  const area = await graph();
  const fold = await within(area).findByRole("button", {
    name: "Subtasks of Book the venue",
  });
  expect(fold).toHaveAttribute("aria-expanded", "true");
  expect(within(area).getByRole("checkbox", { name: "Visit" })).toBeVisible();
  await user.click(fold);
  expect(fold).toHaveAttribute("aria-expanded", "false");
  expect(within(area).queryByRole("checkbox", { name: "Visit" })).toBeNull();
  await user.click(fold);
  expect(within(area).getByRole("checkbox", { name: "Visit" })).toBeVisible();
});

it("ticks a subtask in the graph", async () => {
  const { user } = renderApp("/tasks?view=graph", { as: ada });
  await user.click(
    await within(await graph()).findByRole("checkbox", { name: "Shortlist" }),
  );
  await waitFor(() =>
    expect(requests).toContainEqual({
      method: "PATCH",
      path: `/api/tasks/${venue.id}/subtasks/s1`,
      body: { completed: true },
    }),
  );
});

it("zooms with the buttons", async () => {
  const { user } = renderApp("/tasks?view=graph", { as: ada });
  const area = await graph();
  const level = within(area).getByTestId("zoom");
  expect(level).toHaveTextContent("100%");
  await user.click(within(area).getByRole("button", { name: "Zoom in" }));
  expect(level).toHaveTextContent("125%");
  await user.click(within(area).getByRole("button", { name: "Zoom out" }));
  expect(level).toHaveTextContent("100%");
});

it("keeps the list's steps when a filter hides a prerequisite", async () => {
  const work = [...db.categories.values()].find(
    ({ ownerId, category }) =>
      ownerId === ada.user.id && category.name === "Work",
  )!.category.id;
  db.tasks.get(invites.id)!.task.category_id = work;
  renderApp(`/tasks?view=graph&category=${work}`, { as: ada });
  const area = await graph();
  expect(
    await within(area).findByRole("img", { name: "Step 2, waiting" }),
  ).toBeInTheDocument();
  expect(
    within(area).queryByRole("link", { name: /^Book the venue/ }),
  ).toBeNull();
});
