import { act, screen, within } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import type { AuthResult, Task } from "../api.ts";
import {
  complete,
  db,
  requests,
  seedTasks,
  seedUser,
} from "../test/fakeApi.ts";
import { renderApp } from "../test/render.tsx";
import { LEAVE_MS } from "../useLeaving.ts";
import { LINGER_MS } from "../useLinger.tsx";

let ada: AuthResult;

beforeEach(() => {
  ada = seedUser();
});

const list = (name: string) => screen.queryByRole("list", { name });
// Titles in a list, leaving out rows that are closing (they're on their way out).
const titlesIn = (name: string) =>
  [...(list(name)?.querySelectorAll("li:not(.closing) .title") ?? [])].map(
    (title) => title.textContent,
  );
const rowIn = (name: string, title: string) =>
  [...list(name)!.querySelectorAll("li:not(.closing)")].find(
    (row) => row.querySelector(".title")?.textContent === title,
  )!;
const checkbox = (title: string) =>
  screen.findByRole("checkbox", { name: `Complete ${title}` });
const advance = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
// Completed tasks, oldest first, a minute apart and before now.
const completeInOrder = (tasks: Task[]) =>
  tasks.forEach((task, i) =>
    complete(task, new Date(Date.now() - (tasks.length - i) * 60_000)),
  );

it("a ticked task stays for five seconds with a draining bar, then moves to Recently completed", async () => {
  seedTasks(ada, ["a", "b"]);
  const { user } = renderApp("/tasks", { as: ada, fakeTimers: true });
  await user.click(await checkbox("a"));
  expect(rowIn("Tasks", "a").querySelector(".undo-bar")).not.toBeNull();
  await advance(LINGER_MS - 100);
  expect(titlesIn("Tasks")).toEqual(["a", "b"]);
  await advance(200 + LEAVE_MS);
  expect(titlesIn("Tasks")).toEqual(["b"]);
  expect(titlesIn("Recently completed")).toEqual(["a"]);
});

it("unticking within five seconds keeps the task in the list", async () => {
  seedTasks(ada, ["a"]);
  const { user } = renderApp("/tasks", { as: ada, fakeTimers: true });
  await user.click(await checkbox("a"));
  await advance(2000);
  await user.click(await checkbox("a"));
  await advance(LINGER_MS + LEAVE_MS + 1000);
  expect(titlesIn("Tasks")).toEqual(["a"]);
  expect(document.querySelector(".undo-bar")).toBeNull();
  expect(list("Recently completed")).toBeNull();
});

it("each tick has its own five seconds", async () => {
  seedTasks(ada, ["a", "b", "c"]);
  const { user } = renderApp("/tasks", { as: ada, fakeTimers: true });
  await user.click(await checkbox("a"));
  await advance(3000);
  await user.click(await checkbox("b"));
  await advance(2500);
  expect(titlesIn("Tasks")).toEqual(["b", "c"]);
  await advance(3000);
  expect(titlesIn("Tasks")).toEqual(["c"]);
});

it("a task completed before a reload is under Recently completed", async () => {
  const [, b] = seedTasks(ada, ["a", "b"]);
  complete(b, new Date());
  renderApp("/tasks", { as: ada });
  await checkbox("a");
  expect(titlesIn("Tasks")).toEqual(["a"]);
  expect(titlesIn("Recently completed")).toEqual(["b"]);
});

it("Recently completed shows the five newest", async () => {
  const tasks = seedTasks(ada, ["t1", "t2", "t3", "t4", "t5", "t6", "open"]);
  completeInOrder(tasks.slice(0, 6));
  renderApp("/tasks", { as: ada });
  await checkbox("open");
  expect(titlesIn("Recently completed")).toEqual([
    "t6",
    "t5",
    "t4",
    "t3",
    "t2",
  ]);
});

it("Recently completed follows the category filter and search", async () => {
  const tasks = seedTasks(ada, ["Pay rent", "Buy milk", "open"]);
  const work = [...db.categories.values()].find(
    ({ category }) => category.name === "Work",
  )!.category;
  db.tasks.get(tasks[0].id)!.task.category_id = work.id;
  completeInOrder(tasks.slice(0, 2));
  const { user } = renderApp(`/tasks?category=${work.id}`, { as: ada });
  await screen.findByText("Pay rent");
  expect(titlesIn("Recently completed")).toEqual(["Pay rent"]);
  await user.click(screen.getByRole("link", { name: /^All/ }));
  await user.type(screen.getByLabelText("Search tasks"), "milk");
  expect(titlesIn("Recently completed")).toEqual(["Buy milk"]);
});

it("Recently completed is hidden when empty", async () => {
  seedTasks(ada, ["a"]);
  renderApp("/tasks", { as: ada });
  await checkbox("a");
  expect(list("Recently completed")).toBeNull();
  expect(
    screen.queryByRole("heading", { name: "Recently completed" }),
  ).toBeNull();
});

it("unticking from Recently completed puts the task back in its slot", async () => {
  const [, b] = seedTasks(ada, ["a", "b", "c"]);
  complete(b, new Date());
  const { user } = renderApp("/tasks", { as: ada });
  await checkbox("a");
  expect(titlesIn("Tasks")).toEqual(["a", "c"]);
  await user.click(
    within(list("Recently completed")!).getByRole("checkbox", {
      name: "Complete b",
    }),
  );
  expect(titlesIn("Tasks")).toEqual(["a", "b", "c"]);
});

it("a finished chain leaves together after the last tick", async () => {
  const [venue, invites] = seedTasks(ada, [
    "Book the venue",
    "Send invitations",
    "Order the cake",
  ]);
  db.tasks.get(invites.id)!.task.waits_for = [venue.id];
  complete(venue, new Date(Date.now() - 60_000));
  const { user } = renderApp("/tasks", { as: ada, fakeTimers: true });
  await checkbox("Send invitations");
  // Its chain isn't finished, so the done venue stays, greyed.
  expect(titlesIn("Tasks")).toEqual([
    "Book the venue",
    "Send invitations",
    "Order the cake",
  ]);
  await user.click(await checkbox("Send invitations"));
  expect(document.querySelectorAll(".undo-bar")).toHaveLength(1);
  expect(
    rowIn("Tasks", "Send invitations").querySelector(".undo-bar"),
  ).not.toBeNull();
  await advance(LINGER_MS + LEAVE_MS);
  expect(titlesIn("Tasks")).toEqual(["Order the cake"]);
  expect(titlesIn("Recently completed")).toEqual([
    "Send invitations",
    "Book the venue",
  ]);
});

it("deleting the last open task of a chain lets the done ones leave", async () => {
  const [venue, invites] = seedTasks(ada, [
    "Book the venue",
    "Send invitations",
  ]);
  db.tasks.get(invites.id)!.task.waits_for = [venue.id];
  complete(venue, new Date());
  const { user } = renderApp("/tasks", { as: ada });
  await user.click(
    await screen.findByRole("button", { name: "Delete Send invitations" }),
  );
  expect(titlesIn("Tasks")).toEqual([]);
  expect(document.querySelector(".undo-bar")).toBeNull();
  expect(titlesIn("Recently completed")).toEqual(["Book the venue"]);
});

it("deleting a task during its window just removes it", async () => {
  seedTasks(ada, ["a", "b"]);
  const { user } = renderApp("/tasks", { as: ada, fakeTimers: true });
  await user.click(await checkbox("a"));
  await user.click(screen.getByRole("button", { name: "Delete a" }));
  await advance(LINGER_MS + LEAVE_MS + 1000);
  expect(titlesIn("Tasks")).toEqual(["b"]);
  expect(list("Recently completed")).toBeNull();
  expect(screen.queryByRole("alert")).toBeNull();
});

it("reorders with completed tasks hidden, keeping their slots", async () => {
  const [a, h, b, c] = seedTasks(ada, ["a", "h", "b", "c"]);
  complete(h, new Date());
  const { user } = renderApp("/tasks", { as: ada });
  (await screen.findByRole("button", { name: "Reorder c" })).focus();
  await user.keyboard("[Space][ArrowUp][ArrowUp][Space]");
  expect(requests).toContainEqual({
    method: "PUT",
    path: "/api/task-order",
    body: { ids: [c.id, h.id, a.id, b.id], previous: [a.id, h.id, b.id, c.id] },
  });
});

it("moves focus to the task in Recently completed when its row closes", async () => {
  seedTasks(ada, ["a", "b"]);
  const { user } = renderApp("/tasks", { as: ada, fakeTimers: true });
  (await checkbox("a")).focus();
  await user.keyboard("[Space]");
  await advance(LINGER_MS + LEAVE_MS);
  expect(
    within(list("Recently completed")!).getByRole("checkbox", {
      name: "Complete a",
    }),
  ).toHaveFocus();
});

it("the panel's Done box has the same five seconds", async () => {
  const [a] = seedTasks(ada, ["a", "b"]);
  const { user } = renderApp(`/tasks?task=${a.id}`, {
    as: ada,
    fakeTimers: true,
  });
  const panel = await screen.findByRole("complementary", {
    name: "Task details",
  });
  await user.click(within(panel).getByRole("checkbox", { name: "Done" }));
  expect(titlesIn("Tasks")).toEqual(["a", "b"]);
  await advance(LINGER_MS + LEAVE_MS);
  expect(titlesIn("Tasks")).toEqual(["b"]);
  expect(titlesIn("Recently completed")).toEqual(["a"]);
});

it("says All done. when every task is completed", async () => {
  completeInOrder(seedTasks(ada, ["a", "b"]));
  renderApp("/tasks", { as: ada });
  expect(await screen.findByText("All done.")).toBeInTheDocument();
  expect(titlesIn("Recently completed")).toEqual(["b", "a"]);
});
