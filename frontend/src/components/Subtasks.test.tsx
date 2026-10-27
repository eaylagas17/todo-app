import { screen, waitFor, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { beforeEach, expect, it } from "vitest";
import type { AuthResult, Task } from "../api.ts";
import { db, seedTasks, seedUser, server } from "../test/fakeApi.ts";
import { renderApp } from "../test/render.tsx";

let ada: AuthResult;
let venue: Task;

beforeEach(() => {
  ada = seedUser();
  [venue] = seedTasks(ada, ["Book the venue"]);
});

const panel = () =>
  screen.findByRole("complementary", { name: "Task details" });

it("adds, ticks and deletes subtasks in the panel", async () => {
  const { user } = renderApp(`/tasks?task=${venue.id}`, { as: ada });
  const details = await panel();
  await user.type(
    within(details).getByLabelText("Add subtask"),
    "Shortlist{Enter}",
  );
  expect(await within(details).findByText("0 of 1")).toBeInTheDocument();
  expect(within(details).getByLabelText("Add subtask")).toHaveValue("");

  await user.click(
    within(details).getByRole("checkbox", { name: "Shortlist" }),
  );
  expect(await within(details).findByText("1 of 1")).toBeInTheDocument();

  await user.click(
    within(details).getByRole("button", { name: "Delete Shortlist" }),
  );
  await waitFor(() =>
    expect(
      within(details).queryByRole("checkbox", { name: "Shortlist" }),
    ).not.toBeInTheDocument(),
  );
  await waitFor(() =>
    expect(db.tasks.get(venue.id)?.task.subtasks).toEqual([]),
  );
});

it("shows subtask progress in the list", async () => {
  db.tasks.get(venue.id)!.task.subtasks = [
    { id: "s1", title: "Shortlist", completed: true },
    { id: "s2", title: "Visit", completed: false },
    { id: "s3", title: "Sign", completed: false },
  ];
  renderApp("/tasks", { as: ada });
  const list = await screen.findByRole("list", { name: "Tasks" });
  expect(within(list).getByText("1 of 3")).toBeInTheDocument();
});

it("restores a subtask when ticking fails", async () => {
  db.tasks.get(venue.id)!.task.subtasks = [
    { id: "s1", title: "Shortlist", completed: false },
  ];
  server.use(
    http.patch("/api/tasks/:id/subtasks/:subtaskId", () =>
      HttpResponse.json(
        { error: { code: "INTERNAL_ERROR", message: "Server exploded" } },
        { status: 500 },
      ),
    ),
  );
  const { user } = renderApp(`/tasks?task=${venue.id}`, { as: ada });
  const details = await panel();
  await user.click(
    within(details).getByRole("checkbox", { name: "Shortlist" }),
  );
  expect(await within(details).findByRole("alert")).toHaveTextContent(
    "Server exploded",
  );
  expect(
    within(details).getByRole("checkbox", { name: "Shortlist" }),
  ).not.toBeChecked();
});
