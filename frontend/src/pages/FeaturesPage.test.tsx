import { screen, within } from "@testing-library/react";
import { beforeEach, expect, it } from "vitest";
import type { AuthResult } from "../api.ts";
import { requests, seedTasks, seedUser } from "../test/fakeApi.ts";
import { renderApp } from "../test/render.tsx";

let ada: AuthResult;

beforeEach(() => {
  ada = seedUser();
});

// One card per feature in spec §12.
const FEATURES = [
  "Linked tasks",
  "The chain pull",
  "The graph view",
  "Subtasks",
  "AI categories",
  "Search",
  "Drag to reorder",
  "Completed tasks",
  "Side panel and full page",
  "Status page",
  "Offline and error handling",
];

it("lists every feature with a Show me link", async () => {
  renderApp("/features", { as: ada });
  for (const title of FEATURES) {
    const card = await screen.findByRole("article", { name: title });
    expect(
      within(card).getByRole("link", { name: `Show me: ${title}` }),
    ).toBeInTheDocument();
  }
  expect(screen.getAllByRole("article")).toHaveLength(FEATURES.length);
});

it("Show me opens the right screen", async () => {
  seedTasks(ada, ["Book the venue"]);
  const { user } = renderApp("/features", { as: ada });
  await user.click(
    await screen.findByRole("link", { name: "Show me: The graph view" }),
  );
  expect(
    await screen.findByRole("region", { name: "Task graph" }),
  ).toBeInTheDocument();
  expect(screen.getByTestId("location")).toHaveTextContent("/tasks?view=graph");
});

it("loads the example and goes to the list", async () => {
  const { user } = renderApp("/features", { as: ada });
  await user.click(
    await screen.findByRole("button", { name: "Load example tasks" }),
  );
  expect(await screen.findByText("Send invitations")).toBeInTheDocument();
  expect(screen.getByTestId("location")).toHaveTextContent(/^\/tasks$/);
  expect(requests).toContainEqual({
    method: "POST",
    path: "/api/examples",
    body: undefined,
  });
});

it("the header shows Tasks, Features and Status", async () => {
  const { user } = renderApp("/tasks", { as: ada });
  const nav = await screen.findByRole("navigation", { name: "Main" });
  expect(within(nav).getByRole("link", { name: "Tasks" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await user.click(within(nav).getByRole("link", { name: "Features" }));
  expect(
    await screen.findByRole("heading", { name: "Features", level: 1 }),
  ).toBeInTheDocument();
  await user.click(within(nav).getByRole("link", { name: "Status" }));
  expect(
    await screen.findByRole("heading", { name: "Status", level: 1 }),
  ).toBeInTheDocument();
});

it("Show me for completed tasks opens the Completed page", async () => {
  renderApp("/features", { as: ada });
  expect(
    await screen.findByRole("link", { name: "Show me: Completed tasks" }),
  ).toHaveAttribute("href", "/tasks?list=completed");
});
