import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import type { AuthResult } from "../api.ts";
import {
  db,
  requests,
  savedOrder,
  seedTasks,
  seedUser,
} from "../test/fakeApi.ts";
import { advance, renderApp, row, titlesIn } from "../test/render.tsx";
import { LEAVE_MS } from "../useLeaving.ts";
import { LINGER_MS } from "../useLinger.tsx";

let ada: AuthResult;

beforeEach(() => {
  ada = seedUser();
});

const handle = (title: string) =>
  screen.findByRole("button", { name: `Reorder ${title}` });
const announced = () => screen.getByRole("status");
const puts = () => requests.filter((r) => r.method === "PUT");

// jsdom has no layout: rows sit one under the other from the list's top (0), 50px tall unless
// `tall` says otherwise.
function layOutRows(tall: Record<number, number> = {}) {
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
    function (this: Element) {
      const item = this.closest("li");
      if (!item?.parentElement) return new DOMRect(0, 0, 300, 50);
      const index = [...item.parentElement.children].indexOf(item);
      const height = (i: number) => tall[i] ?? 50;
      let top = 0;
      for (let i = 0; i < index; i++) top += height(i);
      return new DOMRect(0, top, 300, height(index));
    },
  );
}

// A pointer drag on a handle: press at `from`, then move through `to` (clientY values).
async function pointerDrag(title: string, from: number, ...to: number[]) {
  const grip = await handle(title);
  fireEvent.pointerDown(grip, { clientY: from, pointerId: 1 });
  for (const y of to) fireEvent.pointerMove(grip, { clientY: y, pointerId: 1 });
  return grip;
}

it("gives each task a labelled drag handle", async () => {
  seedTasks(ada, ["a", "b"]);
  renderApp("/tasks", { as: ada });
  expect(await handle("a")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Reorder b" })).toBeInTheDocument();
});

it("hides drag handles while searching", async () => {
  seedTasks(ada, ["Buy milk", "Call mom"]);
  const { user } = renderApp("/tasks", { as: ada });
  await handle("Buy milk");
  await user.type(screen.getByLabelText("Search tasks"), "milk");
  expect(screen.getByRole("link", { name: "Buy milk" })).toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: /^Reorder/ }),
  ).not.toBeInTheDocument();
});

it("moves a task with the keyboard", async () => {
  const [a, b, c] = seedTasks(ada, ["a", "b", "c"]);
  const { user } = renderApp("/tasks", { as: ada });
  (await handle("a")).focus();
  await user.keyboard("[Space]");
  await waitFor(() => expect(announced()).toHaveTextContent("Picked up a."));
  await user.keyboard("[ArrowDown]");
  await waitFor(() =>
    expect(announced()).toHaveTextContent("a is at position 2 of 3."),
  );
  await user.keyboard("[Space]");
  await waitFor(() => expect(announced()).toHaveTextContent("a was moved."));
  await waitFor(() => expect(titlesIn()).toEqual(["b", "a", "c"]));
  await savedOrder([b, a, c], [a, b, c]);
});

it("says nothing moved when a task is dropped where it started", async () => {
  seedTasks(ada, ["a", "b"]);
  const { user } = renderApp("/tasks", { as: ada });
  (await handle("a")).focus();
  await user.keyboard("[Space]");
  await waitFor(() => expect(announced()).toHaveTextContent("Picked up a."));
  await user.keyboard("[Space]");
  await waitFor(() =>
    expect(announced()).toHaveTextContent("Moving a was cancelled."),
  );
  expect(puts()).toEqual([]);
});

it("Escape cancels a keyboard drag", async () => {
  seedTasks(ada, ["a", "b", "c"]);
  const { user } = renderApp("/tasks", { as: ada });
  (await handle("a")).focus();
  await user.keyboard("[Space][ArrowDown]");
  await waitFor(() =>
    expect(announced()).toHaveTextContent("a is at position 2 of 3."),
  );
  await user.keyboard("[Escape]");
  await waitFor(() =>
    expect(announced()).toHaveTextContent("Moving a was cancelled."),
  );
  expect(titlesIn()).toEqual(["a", "b", "c"]);
  expect(puts()).toEqual([]);
});

it("drags with the pointer, keeps the rows where it showed them, and saves that order", async () => {
  layOutRows();
  const [a, b, c] = seedTasks(ada, ["a", "b", "c"]);
  renderApp("/tasks", { as: ada });
  const grip = await pointerDrag("a", 20, 125);
  fireEvent.pointerUp(grip, { clientY: 125, pointerId: 1 });
  // The cache gets the new order a moment later (the optimistic update awaits): until then the
  // rows stay drawn where the drag left them, instead of snapping back to where it started.
  if (titlesIn().join() === "a,b,c")
    expect(row("a").style.transform).toBe("translateY(100px)");
  await savedOrder([b, c, a], [a, b, c]);
  await waitFor(() => expect(titlesIn()).toEqual(["b", "c", "a"]));
  await waitFor(() => expect(row("a").style.transform).toBe(""));
});

it("keeps the dragged row inside the list", async () => {
  layOutRows();
  seedTasks(ada, ["a", "b", "c"]);
  renderApp("/tasks", { as: ada });
  const grip = await pointerDrag("b", 70, -500);
  expect(row("b").style.transform).toBe("translateY(-50px)");
  fireEvent.pointerMove(grip, { clientY: 5000, pointerId: 1 });
  expect(row("b").style.transform).toBe("translateY(50px)");
});

it("brings the tasks it reaches while dragging", async () => {
  layOutRows();
  const [venue, invites, cake] = seedTasks(ada, [
    "Book the venue",
    "Send invitations",
    "Order the cake",
  ]);
  db.tasks.get(invites.id)!.task.waits_for = [venue.id];
  renderApp("/tasks", { as: ada });
  const grip = await pointerDrag("Book the venue", 20, 140);
  expect(row("Send invitations")).toHaveClass("swept");
  expect(row("Book the venue")).toHaveClass("lifted");
  expect(announced().textContent).toMatch(/Send invitations moves with it\.$/);
  fireEvent.pointerUp(grip, { clientY: 140, pointerId: 1 });
  await savedOrder([cake, venue, invites], [venue, invites, cake]);
  await waitFor(() =>
    expect(titlesIn()).toEqual([
      "Order the cake",
      "Book the venue",
      "Send invitations",
    ]),
  );
});

it("Escape cancels a pointer drag", async () => {
  layOutRows();
  seedTasks(ada, ["a", "b", "c"]);
  renderApp("/tasks", { as: ada });
  const grip = await pointerDrag("a", 20, 125);
  expect(row("a").style.transform).not.toBe("");
  fireEvent.keyDown(window, { key: "Escape" });
  await waitFor(() =>
    expect(
      screen.getAllByRole("listitem").filter((item) => item.style.transform),
    ).toEqual([]),
  );
  fireEvent.pointerUp(grip, { clientY: 125, pointerId: 1 });
  expect(puts()).toEqual([]);
});

it("drags past a taller row by its middle", async () => {
  layOutRows({ 1: 100 });
  const [a, b, c] = seedTasks(ada, ["a", "b", "c"]);
  renderApp("/tasks", { as: ada });
  // a's top at 40: b's middle, in the list without a, is at 50, so nothing moves yet.
  const grip = await pointerDrag("a", 20, 60);
  expect(row("b").style.transform).toBe("translateY(0px)");
  // a's top at 60: past b's middle, so b moves up into the first slot.
  fireEvent.pointerMove(grip, { clientY: 80, pointerId: 1 });
  expect(row("b").style.transform).toBe("translateY(-50px)");
  fireEvent.pointerUp(grip, { clientY: 80, pointerId: 1 });
  await savedOrder([b, a, c], [a, b, c]);
});

it("a row leaving the list mid-drag waits until the drop", async () => {
  layOutRows();
  const [a, b, c] = seedTasks(ada, ["a", "b", "c"]);
  const { user } = renderApp("/tasks", { as: ada, fakeTimers: true });
  await user.click(await screen.findByRole("checkbox", { name: "Complete c" }));
  const grip = await pointerDrag("a", 20, 60);
  expect(row("a").style.transform).toBe("translateY(40px)");
  // c's 5-second window ends mid-drag: the rows the drag measured stay put, so nothing shifts
  // under the pointer.
  await advance(LINGER_MS + LEAVE_MS + 100);
  expect(titlesIn()).toEqual(["a", "b", "c"]);
  expect(
    screen.getByRole("list", { name: "Tasks" }).querySelector("li.closing"),
  ).toBeNull();
  expect(row("a").style.transform).toBe("translateY(40px)");
  // c is held in the list and already in Recently completed: only one of them may carry its
  // view-transition-name, or the browser aborts the drop's transition.
  const names = [...document.querySelectorAll<HTMLElement>("li.task")]
    .map((item) => item.style.viewTransitionName)
    .filter(Boolean);
  expect(new Set(names).size).toBe(names.length);
  fireEvent.pointerUp(grip, { clientY: 60, pointerId: 1 });
  await savedOrder([b, a, c], [a, b, c]);
  // After the drop, c leaves as it should.
  await advance(LEAVE_MS + 100);
  expect(titlesIn()).toEqual(["b", "a"]);
});

it("a tall task travelling with the dragged one counts as part of the group", async () => {
  // a (50px), then b (100px, waits for a), c and d (50px each).
  layOutRows({ 1: 100 });
  const [a, b, c, d] = seedTasks(ada, ["a", "b", "c", "d"]);
  db.tasks.get(b.id)!.task.waits_for = [a.id];
  renderApp("/tasks", { as: ada });
  // a's top at 80: b travels with it, so the rows it has passed are c and d (d's middle is at
  // 75 once b is out of the way). Counting b's height as if b were still above would leave d
  // below the group and draw the group over it.
  const grip = await pointerDrag("a", 20, 100);
  expect(row("d").style.transform).toBe("translateY(-150px)");
  fireEvent.pointerUp(grip, { clientY: 100, pointerId: 1 });
  await savedOrder([c, d, a, b], [a, b, c, d]);
});

it("the handle captures the pointer, so a release outside the window still ends the drag", async () => {
  const capture = vi.spyOn(Element.prototype, "setPointerCapture");
  seedTasks(ada, ["a", "b"]);
  renderApp("/tasks", { as: ada });
  fireEvent.pointerDown(await handle("a"), { clientY: 20, pointerId: 7 });
  expect(capture).toHaveBeenCalledWith(7);
});
