import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { http } from "msw";
import { beforeEach, expect, it, vi } from "vitest";
import type { AuthResult, Task } from "../api.ts";
import {
  db,
  fail,
  gate,
  requests,
  savedOrder,
  seedTasks,
  seedUser,
  server,
} from "../test/fakeApi.ts";
import { findPanel, renderApp, row, titlesIn } from "../test/render.tsx";

let ada: AuthResult;
let venue: Task;
let invites: Task;
let cake: Task;

beforeEach(() => {
  ada = seedUser();
  [venue, invites, cake] = seedTasks(ada, [
    "Book the venue",
    "Send invitations",
    "Order the cake",
  ]);
  db.tasks.get(invites.id)!.task.waits_for = [venue.id];
});

const cakeDot = () =>
  screen.findByRole("button", { name: "Link Order the cake to another task" });
// jsdom has no hit-testing: say which element the pointer is over.
const pointAt = (element: Element | null) =>
  vi.spyOn(document, "elementFromPoint").mockReturnValue(element);

async function moveVenueDown(user: ReturnType<typeof renderApp>["user"]) {
  (
    await screen.findByRole("button", { name: "Reorder Book the venue" })
  ).focus();
  await user.keyboard("[Space][ArrowDown][ArrowDown][Space]");
}

it("shows step numbers and Waits for", async () => {
  renderApp("/tasks", { as: ada });
  expect(
    await screen.findByRole("img", { name: "Step 2, waiting" }),
  ).toBeInTheDocument();
  expect(
    within(row("Send invitations")).getByText("Waits for: Book the venue"),
  ).toBeInTheDocument();
  expect(
    within(row("Book the venue")).getByRole("img", { name: "Step 1, ready" }),
  ).toBeInTheDocument();
  expect(within(row("Order the cake")).queryByRole("img")).toBeNull();
});

it("links two tasks from the panel", async () => {
  const { user } = renderApp(`/tasks?task=${cake.id}`, { as: ada });
  const details = await findPanel();
  await user.selectOptions(
    within(details).getByLabelText("Add a task it waits for"),
    "Book the venue",
  );
  await waitFor(() =>
    expect(requests).toContainEqual({
      method: "POST",
      path: `/api/tasks/${cake.id}/links`,
      body: { depends_on_id: venue.id },
    }),
  );
  expect(
    await within(row("Order the cake")).findByText("Waits for: Book the venue"),
  ).toBeInTheDocument();
});

it("refuses a loop and says why", async () => {
  const message =
    "That would make a loop: Book the venue → Send invitations → Book the venue";
  server.use(
    http.post("/api/tasks/:id/links", () => fail(409, "LINK_CYCLE", message)),
  );
  const { user } = renderApp(`/tasks?task=${venue.id}`, { as: ada });
  const details = await findPanel();
  await user.selectOptions(
    within(details).getByLabelText("Add a task it waits for"),
    "Send invitations",
  );
  expect(await within(details).findByRole("alert")).toHaveTextContent(message);
});

it("unlinks from the panel", async () => {
  const { user } = renderApp(`/tasks?task=${invites.id}`, { as: ada });
  const details = await findPanel();
  await user.click(
    within(details).getByRole("button", {
      name: "Stop waiting for Book the venue",
    }),
  );
  await waitFor(() =>
    expect(
      within(row("Send invitations")).queryByText(/Waits for/),
    ).not.toBeInTheDocument(),
  );
  expect(requests).toContainEqual({
    method: "DELETE",
    path: `/api/tasks/${invites.id}/links/${venue.id}`,
    body: undefined,
  });
});

it("links by dragging the edge dot onto another task", async () => {
  renderApp("/tasks", { as: ada });
  const dot = await cakeDot();
  pointAt(row("Book the venue"));
  fireEvent.pointerDown(dot, { clientX: 10, clientY: 110, pointerId: 1 });
  fireEvent.pointerMove(dot, { clientX: 10, clientY: 20, pointerId: 1 });
  fireEvent.pointerUp(dot, { clientX: 10, clientY: 20, pointerId: 1 });
  await waitFor(() =>
    expect(requests).toContainEqual({
      method: "POST",
      path: `/api/tasks/${cake.id}/links`,
      body: { depends_on_id: venue.id },
    }),
  );
  expect(document.querySelector(".link-arrow")).toBeNull();
});

it("draws an arrow while linking and removes it on release anywhere", async () => {
  renderApp("/tasks", { as: ada });
  const dot = await cakeDot();
  fireEvent.pointerDown(dot, { clientX: 10, clientY: 110, pointerId: 1 });
  expect(document.querySelector(".link-arrow")).not.toBeNull();
  fireEvent.pointerMove(dot, { clientX: 40, clientY: 30, pointerId: 1 });
  expect(
    document.querySelector(".link-arrow .line")?.getAttribute("d"),
  ).toMatch(/L 40 30$/);
  fireEvent.pointerUp(dot, { clientX: 40, clientY: 30, pointerId: 1 });
  expect(document.querySelector(".link-arrow")).toBeNull();
  expect(requests.filter((r) => r.method === "POST")).toEqual([]);
});

it("outlines the task under the pointer, never the one dragged from", async () => {
  renderApp("/tasks", { as: ada });
  const dot = await cakeDot();
  pointAt(row("Book the venue"));
  fireEvent.pointerDown(dot, { clientX: 10, clientY: 110, pointerId: 1 });
  fireEvent.pointerMove(dot, { clientX: 10, clientY: 20, pointerId: 1 });
  expect(row("Book the venue")).toHaveClass("link-target");
  pointAt(row("Order the cake"));
  fireEvent.pointerMove(dot, { clientX: 10, clientY: 110, pointerId: 1 });
  expect(document.querySelector(".link-target")).toBeNull();
  pointAt(row("Book the venue"));
  fireEvent.pointerMove(dot, { clientX: 10, clientY: 20, pointerId: 1 });
  fireEvent.pointerUp(dot, { clientX: 10, clientY: 20, pointerId: 1 });
  expect(document.querySelector(".link-target")).toBeNull();
});

it("draws the arrow in the graph too", async () => {
  renderApp("/tasks?view=graph", { as: ada });
  const dot = await cakeDot();
  fireEvent.pointerDown(dot, { clientX: 10, clientY: 110, pointerId: 1 });
  // In the body, not inside the zoomed canvas: a transformed ancestor would break position: fixed.
  expect(document.querySelector("body > .link-arrow")).not.toBeNull();
  fireEvent.pointerUp(dot, { clientX: 10, clientY: 110, pointerId: 1 });
  expect(document.querySelector(".link-arrow")).toBeNull();
});

it("moving a task below the task waiting for it pulls that task along", async () => {
  const { user } = renderApp("/tasks", { as: ada });
  await moveVenueDown(user);
  await savedOrder([cake, venue, invites], [venue, invites, cake]);
  expect(titlesIn()).toEqual([
    "Order the cake",
    "Book the venue",
    "Send invitations",
  ]);
});

it("refreshes the list when the order was stale", async () => {
  const listReads = () =>
    requests.filter((r) => r.method === "GET" && r.path === "/api/tasks")
      .length;
  const { user } = renderApp("/tasks", { as: ada });
  await screen.findByRole("button", { name: "Reorder Order the cake" });
  const before = listReads();
  seedTasks(ada, ["Added elsewhere"]);
  await moveVenueDown(user);
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Your list changed elsewhere",
  );
  await waitFor(() => expect(listReads()).toBeGreaterThan(before));
});

it("unlinks dependents when their prerequisite is deleted", async () => {
  const { user } = renderApp("/tasks", { as: ada });
  await screen.findByRole("img", { name: "Step 2, waiting" });
  await user.click(
    screen.getByRole("button", { name: "Delete Book the venue" }),
  );
  await waitFor(() =>
    expect(
      within(row("Send invitations")).queryByText(/Waits for/),
    ).not.toBeInTheDocument(),
  );
  expect(within(row("Send invitations")).queryByRole("img")).toBeNull();
  await waitFor(() =>
    expect(db.tasks.get(invites.id)?.task.waits_for).toEqual([]),
  );
});

it("marks a waiting task ready when its prerequisite is ticked", async () => {
  const { user } = renderApp("/tasks", { as: ada });
  await screen.findByRole("img", { name: "Step 2, waiting" });
  await user.click(
    screen.getByRole("checkbox", { name: "Complete Book the venue" }),
  );
  expect(
    await screen.findByRole("img", { name: "Step 2, ready" }),
  ).toBeInTheDocument();
});

it("applies changes instantly without View Transitions", async () => {
  expect("startViewTransition" in document).toBe(false);
  const { wait, release } = gate();
  server.use(
    http.put("/api/task-order", async () => {
      await wait;
    }),
  );
  const { user } = renderApp("/tasks", { as: ada });
  await moveVenueDown(user);
  await waitFor(() =>
    expect(titlesIn()).toEqual([
      "Order the cake",
      "Book the venue",
      "Send invitations",
    ]),
  );
  // Let the held request finish inside this test: a late answer after cleanup would be a 401
  // that signs the next test out.
  const reads = requests.filter((r) => r.method === "GET").length;
  release();
  await waitFor(() =>
    expect(requests.filter((r) => r.method === "GET").length).toBeGreaterThan(
      reads,
    ),
  );
});

it("a second finger turns a link drag into a pinch, not a link", async () => {
  renderApp("/tasks", { as: ada });
  const dot = await cakeDot();
  const target = row("Book the venue");
  pointAt(target);
  fireEvent.pointerDown(dot, { clientX: 10, clientY: 110, pointerId: 1 });
  fireEvent.pointerDown(target, { clientX: 10, clientY: 20, pointerId: 2 });
  fireEvent.pointerUp(dot, { clientX: 10, clientY: 20, pointerId: 1 });
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(requests.filter((r) => r.path.endsWith("/links"))).toEqual([]);
});
