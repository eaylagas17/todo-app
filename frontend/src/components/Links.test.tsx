import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { beforeEach, expect, it, vi } from "vitest";
import type { AuthResult, Task } from "../api.ts";
import {
  db,
  gate,
  requests,
  seedTasks,
  seedUser,
  server,
} from "../test/fakeApi.ts";
import { renderApp } from "../test/render.tsx";

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

const row = (title: string) =>
  screen
    .getAllByRole("listitem")
    .find((item) => item.querySelector(".title")?.textContent === title)!;
const titles = () =>
  [...document.querySelectorAll(".tasks .title")].map((t) => t.textContent);
const panel = () =>
  screen.findByRole("complementary", { name: "Task details" });

// jsdom has no layout: row n sits at top = n × 50, 40px tall, so dnd-kit can move by keyboard.
function layOutRows() {
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
    function (this: Element) {
      const item = this.closest("li");
      const index = item?.parentElement
        ? [...item.parentElement.children].indexOf(item)
        : 0;
      return new DOMRect(0, index * 50, 300, 40);
    },
  );
}

async function dragDown(
  user: ReturnType<typeof renderApp>["user"],
  title: string,
  steps: number,
) {
  (await screen.findByRole("button", { name: `Reorder ${title}` })).focus();
  await user.keyboard("[Space]");
  for (let i = 0; i < steps; i++) await user.keyboard("[ArrowDown]");
  await user.keyboard("[Space]");
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
  const details = await panel();
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
    http.post("/api/tasks/:id/links", () =>
      HttpResponse.json(
        { error: { code: "LINK_CYCLE", message } },
        { status: 409 },
      ),
    ),
  );
  const { user } = renderApp(`/tasks?task=${venue.id}`, { as: ada });
  const details = await panel();
  await user.selectOptions(
    within(details).getByLabelText("Add a task it waits for"),
    "Send invitations",
  );
  expect(await within(details).findByRole("alert")).toHaveTextContent(message);
});

it("unlinks from the panel", async () => {
  const { user } = renderApp(`/tasks?task=${invites.id}`, { as: ada });
  const details = await panel();
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
  const dot = await screen.findByRole("button", {
    name: "Link Order the cake to another task",
  });
  const target = row("Book the venue");
  const original = document.elementFromPoint;
  document.elementFromPoint = () => target;
  try {
    fireEvent.pointerDown(dot, { clientX: 10, clientY: 110, pointerId: 1 });
    fireEvent.pointerMove(dot, { clientX: 10, clientY: 20, pointerId: 1 });
    fireEvent.pointerUp(dot, { clientX: 10, clientY: 20, pointerId: 1 });
  } finally {
    document.elementFromPoint = original;
  }
  await waitFor(() =>
    expect(requests).toContainEqual({
      method: "POST",
      path: `/api/tasks/${cake.id}/links`,
      body: { depends_on_id: venue.id },
    }),
  );
});

it("moving a task below the task waiting for it pulls that task along", async () => {
  layOutRows();
  const { user } = renderApp("/tasks", { as: ada });
  await dragDown(user, "Book the venue", 2);
  await waitFor(() =>
    expect(requests).toContainEqual({
      method: "PUT",
      path: "/api/task-order",
      body: { ids: [cake.id, venue.id, invites.id] },
    }),
  );
  expect(titles()).toEqual([
    "Order the cake",
    "Book the venue",
    "Send invitations",
  ]);
});

it("refreshes the list when the order was stale", async () => {
  layOutRows();
  server.use(
    http.put("/api/task-order", () =>
      HttpResponse.json(
        {
          error: {
            code: "ORDER_STALE",
            message: "Your list changed elsewhere. Refresh and try again.",
          },
        },
        { status: 409 },
      ),
    ),
  );
  const listReads = () =>
    requests.filter((r) => r.method === "GET" && r.path === "/api/tasks")
      .length;
  const { user } = renderApp("/tasks", { as: ada });
  await screen.findByRole("button", { name: "Reorder Order the cake" });
  const before = listReads();
  await dragDown(user, "Book the venue", 2);
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
  layOutRows();
  const { wait, release } = gate();
  server.use(
    http.put("/api/task-order", async () => {
      await wait;
    }),
  );
  const { user } = renderApp("/tasks", { as: ada });
  await dragDown(user, "Book the venue", 2);
  await waitFor(() =>
    expect(titles()).toEqual([
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
  const dot = await screen.findByRole("button", {
    name: "Link Order the cake to another task",
  });
  const target = row("Book the venue");
  const original = document.elementFromPoint;
  document.elementFromPoint = () => target;
  try {
    fireEvent.pointerDown(dot, { clientX: 10, clientY: 110, pointerId: 1 });
    fireEvent.pointerDown(target, { clientX: 10, clientY: 20, pointerId: 2 });
    fireEvent.pointerUp(dot, { clientX: 10, clientY: 20, pointerId: 1 });
  } finally {
    document.elementFromPoint = original;
  }
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(requests.filter((r) => r.path.endsWith("/links"))).toEqual([]);
});
