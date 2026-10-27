import { screen, waitFor, within } from "@testing-library/react";
import { beforeEach, expect, it } from "vitest";
import type { AuthResult, Task } from "../api.ts";
import {
  complete,
  db,
  savedOrder,
  seedTasks,
  seedUser,
} from "../test/fakeApi.ts";
import {
  advance,
  findPanel,
  renderApp,
  row,
  titlesIn,
} from "../test/render.tsx";
import { LEAVE_MS } from "../useLeaving.ts";
import { LINGER_MS } from "../useLinger.tsx";

let ada: AuthResult;

beforeEach(() => {
  ada = seedUser();
});

const list = (name: string) => screen.queryByRole("list", { name });
const checkbox = (title: string) =>
  screen.findByRole("checkbox", { name: `Complete ${title}` });
// Completed tasks, oldest first, a minute apart and before now.
const completeInOrder = (tasks: Task[]) =>
  tasks.forEach((task, i) =>
    complete(task, new Date(Date.now() - (tasks.length - i) * 60_000)),
  );

it("a ticked task stays for five seconds with a draining bar, then moves to Recently completed", async () => {
  seedTasks(ada, ["a", "b"]);
  const { user } = renderApp("/tasks", { as: ada, fakeTimers: true });
  await user.click(await checkbox("a"));
  expect(row("a").querySelector(".undo-bar")).not.toBeNull();
  // The fake clock also runs on its own, so leave a second of slack either side.
  await advance(LINGER_MS - 1000);
  expect(titlesIn()).toEqual(["a", "b"]);
  await advance(1000 + LEAVE_MS);
  expect(titlesIn()).toEqual(["b"]);
  expect(titlesIn("Recently completed")).toEqual(["a"]);
});

it("unticking within five seconds keeps the task in the list", async () => {
  seedTasks(ada, ["a"]);
  const { user } = renderApp("/tasks", { as: ada, fakeTimers: true });
  await user.click(await checkbox("a"));
  await advance(2000);
  await user.click(await checkbox("a"));
  await advance(LINGER_MS + LEAVE_MS + 1000);
  expect(titlesIn()).toEqual(["a"]);
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
  expect(titlesIn()).toEqual(["b", "c"]);
  await advance(3000);
  expect(titlesIn()).toEqual(["c"]);
});

it("Recently completed shows the five newest, loaded from the server", async () => {
  const tasks = seedTasks(ada, ["t1", "t2", "t3", "t4", "t5", "t6", "open"]);
  completeInOrder(tasks.slice(0, 6));
  renderApp("/tasks", { as: ada });
  await checkbox("open");
  expect(titlesIn()).toEqual(["open"]);
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

it("unticking from Recently completed puts the task back in its slot, keeping focus", async () => {
  const [, b] = seedTasks(ada, ["a", "b", "c"]);
  complete(b, new Date());
  const { user } = renderApp("/tasks", { as: ada });
  await checkbox("a");
  expect(titlesIn()).toEqual(["a", "c"]);
  within(list("Recently completed")!)
    .getByRole("checkbox", { name: "Complete b" })
    .focus();
  await user.keyboard("[Space]");
  expect(titlesIn()).toEqual(["a", "b", "c"]);
  // The section stays while its last row closes, and focus follows b back into the list.
  expect(
    list("Recently completed")?.querySelector("li.closing"),
  ).not.toBeNull();
  await waitFor(() =>
    expect(
      within(list("Tasks")!).getByRole("checkbox", { name: "Complete b" }),
    ).toHaveFocus(),
  );
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
  expect(titlesIn()).toEqual([
    "Book the venue",
    "Send invitations",
    "Order the cake",
  ]);
  await user.click(await checkbox("Send invitations"));
  expect(document.querySelectorAll(".undo-bar")).toHaveLength(1);
  expect(row("Send invitations").querySelector(".undo-bar")).not.toBeNull();
  await advance(LINGER_MS + LEAVE_MS);
  expect(titlesIn()).toEqual(["Order the cake"]);
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
  expect(titlesIn()).toEqual([]);
  expect(document.querySelector(".undo-bar")).toBeNull();
  expect(titlesIn("Recently completed")).toEqual(["Book the venue"]);
});

it("deleting a task during its window just removes it", async () => {
  seedTasks(ada, ["a", "b"]);
  const { user } = renderApp("/tasks", { as: ada, fakeTimers: true });
  await user.click(await checkbox("a"));
  await user.click(screen.getByRole("button", { name: "Delete a" }));
  await advance(LINGER_MS + LEAVE_MS + 1000);
  expect(titlesIn()).toEqual(["b"]);
  expect(list("Recently completed")).toBeNull();
  expect(screen.queryByRole("alert")).toBeNull();
});

it("reorders with completed tasks hidden, keeping their slots", async () => {
  const [a, h, b, c] = seedTasks(ada, ["a", "h", "b", "c"]);
  complete(h, new Date());
  const { user } = renderApp("/tasks", { as: ada });
  (await screen.findByRole("button", { name: "Reorder c" })).focus();
  await user.keyboard("[Space][ArrowUp][ArrowUp][Space]");
  await savedOrder([c, h, a, b], [a, h, b, c]);
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
  const panel = await findPanel();
  await user.click(within(panel).getByRole("checkbox", { name: "Done" }));
  expect(titlesIn()).toEqual(["a", "b"]);
  await advance(LINGER_MS + LEAVE_MS);
  expect(titlesIn()).toEqual(["b"]);
  expect(titlesIn("Recently completed")).toEqual(["a"]);
});

it("says All done. when every task is completed", async () => {
  completeInOrder(seedTasks(ada, ["a", "b"]));
  renderApp("/tasks", { as: ada });
  expect(await screen.findByText("All done.")).toBeInTheDocument();
  expect(titlesIn("Recently completed")).toEqual(["b", "a"]);
});

it("lists every completed task newest first on the Completed page, and search filters it", async () => {
  const [venue, invites, cake, milk] = seedTasks(ada, [
    "Book the venue",
    "Send invitations",
    "Order the cake",
    "Buy milk",
  ]);
  db.tasks.get(invites.id)!.task.waits_for = [venue.id];
  // The venue's chain is unfinished, so it's still greyed in the list; it's listed here too.
  completeInOrder([venue, cake, milk]);
  const { user } = renderApp("/tasks?list=completed", { as: ada });
  expect(
    await screen.findByRole("heading", { name: "Completed" }),
  ).toBeInTheDocument();
  await checkbox("Buy milk");
  expect(titlesIn("Completed")).toEqual([
    "Buy milk",
    "Order the cake",
    "Book the venue",
  ]);
  expect(screen.queryByLabelText("New task")).toBeNull();
  expect(screen.queryByRole("group", { name: "View" })).toBeNull();
  await user.type(screen.getByLabelText("Search tasks"), "milk");
  expect(titlesIn("Completed")).toEqual(["Buy milk"]);
});

it("unticking on the Completed page sends the task back", async () => {
  const [, b] = seedTasks(ada, ["a", "b"]);
  complete(b, new Date());
  const { user } = renderApp("/tasks?list=completed", { as: ada });
  await checkbox("b");
  expect(titlesIn("Completed")).toEqual(["b"]);
  await user.click(await checkbox("b"));
  expect(titlesIn("Completed")).toEqual([]);
  await user.click(screen.getByRole("link", { name: /^All/ }));
  expect(titlesIn()).toEqual(["a", "b"]);
});

it("shows an empty state when nothing is completed", async () => {
  seedTasks(ada, ["a"]);
  renderApp("/tasks?list=completed", { as: ada });
  expect(
    await screen.findByText("No completed tasks yet."),
  ).toBeInTheDocument();
});

it("unticking a task in a finished chain brings the whole chain back", async () => {
  const [venue, invites] = seedTasks(ada, [
    "Book the venue",
    "Send invitations",
    "Order the cake",
  ]);
  db.tasks.get(invites.id)!.task.waits_for = [venue.id];
  completeInOrder([venue, invites]);
  const { user } = renderApp("/tasks", { as: ada });
  await checkbox("Order the cake");
  expect(titlesIn()).toEqual(["Order the cake"]);
  await user.click(
    within(list("Recently completed")!).getByRole("checkbox", {
      name: "Complete Book the venue",
    }),
  );
  expect(titlesIn()).toEqual([
    "Book the venue",
    "Send invitations",
    "Order the cake",
  ]);
  expect(
    within(list("Tasks")!).getByRole("checkbox", {
      name: "Complete Send invitations",
    }),
  ).toBeChecked();
});

it("linking to a completed task brings it back", async () => {
  const [venue, cake] = seedTasks(ada, ["Book the venue", "Order the cake"]);
  complete(venue, new Date());
  const { user } = renderApp(`/tasks?task=${cake.id}`, { as: ada });
  const panel = await findPanel();
  expect(titlesIn()).toEqual(["Order the cake"]);
  await user.selectOptions(
    within(panel).getByLabelText("Add a task it waits for"),
    "Book the venue",
  );
  await waitFor(() =>
    expect(titlesIn()).toEqual(["Book the venue", "Order the cake"]),
  );
});

it("choosing a category leaves the Completed page", async () => {
  seedTasks(ada, ["a"]);
  const { user } = renderApp("/tasks?list=completed", { as: ada });
  await user.click(await screen.findByRole("link", { name: /^Work/ }));
  expect(screen.getByTestId("location")).not.toHaveTextContent("list=");
  expect(
    await screen.findByRole("heading", { name: "My tasks" }),
  ).toBeInTheDocument();
});

it("deleting the last task closes its row up", async () => {
  seedTasks(ada, ["a"]);
  const { user } = renderApp("/tasks", { as: ada });
  await user.click(await screen.findByRole("button", { name: "Delete a" }));
  expect(document.querySelector("li.closing .title")?.textContent).toBe("a");
  expect(
    screen.getByText("No tasks yet. Add your first one above."),
  ).toBeInTheDocument();
});
