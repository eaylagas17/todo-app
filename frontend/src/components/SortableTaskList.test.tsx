import { screen, waitFor, within } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import type { AuthResult } from "../api.ts";
import { requests, seedTasks, seedUser } from "../test/fakeApi.ts";
import { renderApp } from "../test/render.tsx";

let ada: AuthResult;

beforeEach(() => {
  ada = seedUser();
});

const taskLinks = () =>
  within(screen.getByRole("list", { name: "Tasks" }))
    .getAllByRole("link")
    .map((link) => link.textContent);

it("gives each task a labelled drag handle", async () => {
  seedTasks(ada, ["a", "b"]);
  renderApp("/tasks", { as: ada });
  expect(
    await screen.findByRole("button", { name: "Reorder a" }),
  ).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Reorder b" })).toBeInTheDocument();
});

it("hides drag handles while searching", async () => {
  seedTasks(ada, ["Buy milk", "Call mom"]);
  const { user } = renderApp("/tasks", { as: ada });
  await screen.findByRole("button", { name: "Reorder Buy milk" });
  await user.type(screen.getByLabelText("Search tasks"), "milk");
  expect(screen.getByRole("link", { name: "Buy milk" })).toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: /^Reorder/ }),
  ).not.toBeInTheDocument();
});

it("moves a task with the keyboard", async () => {
  // jsdom has no layout, so give each row a place: row n sits at top = n × 50, 40px tall.
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
    function (this: Element) {
      const row = this.closest("li");
      const index = row?.parentElement
        ? [...row.parentElement.children].indexOf(row)
        : 0;
      const top = index * 50;
      return new DOMRect(0, top, 300, 40);
    },
  );
  const [a] = seedTasks(ada, ["a", "b", "c"]);
  const { user } = renderApp("/tasks", { as: ada });
  (await screen.findByRole("button", { name: "Reorder a" })).focus();
  const announced = () => screen.getByRole("status");
  await user.keyboard("[Space]");
  await waitFor(() => expect(announced()).toHaveTextContent("Picked up a."));
  await user.keyboard("[ArrowDown]");
  await waitFor(() => expect(announced()).toHaveTextContent("a is over b."));
  await user.keyboard("[Space]");
  await waitFor(() => expect(announced()).toHaveTextContent("a was moved."));
  await waitFor(() => expect(taskLinks()).toEqual(["b", "a", "c"]));
  // a now sits between b (2) and c (3).
  await waitFor(() =>
    expect(requests).toContainEqual({
      method: "PATCH",
      path: `/api/tasks/${a.id}`,
      body: { position: 2.5 },
    }),
  );
});

it("says nothing moved when a task is dropped where it started", async () => {
  seedTasks(ada, ["a", "b"]);
  const { user } = renderApp("/tasks", { as: ada });
  (await screen.findByRole("button", { name: "Reorder a" })).focus();
  await user.keyboard("[Space]");
  await waitFor(() =>
    expect(screen.getByRole("status")).toHaveTextContent("Picked up a."),
  );
  await user.keyboard("[Space]");
  await waitFor(() =>
    expect(screen.getByRole("status")).toHaveTextContent(
      "Moving a was cancelled.",
    ),
  );
  expect(requests.filter((r) => r.method === "PATCH")).toEqual([]);
});
