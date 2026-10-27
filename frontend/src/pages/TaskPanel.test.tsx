import { screen, waitFor, within } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import type { AuthResult, Task } from "../api.ts";
import { db, seedTasks, seedUser } from "../test/fakeApi.ts";
import { formatDate } from "../tasks.ts";
import { findPanel, renderApp } from "../test/render.tsx";

let ada: AuthResult;
let venue: Task;

beforeEach(() => {
  ada = seedUser();
  [venue] = seedTasks(ada, ["Book the venue", "Order the cake"]);
});

const panel = () =>
  screen.queryByRole("complementary", { name: "Task details" });
const openVenue = async (user: ReturnType<typeof renderApp>["user"]) =>
  user.click(await screen.findByRole("link", { name: "Book the venue" }));

it("opens a task in the side panel", async () => {
  const { user } = renderApp("/tasks", { as: ada });
  await openVenue(user);
  expect(within(panel()!).getByLabelText("Title")).toHaveValue(
    "Book the venue",
  );
  expect(screen.getByTestId("location")).toHaveTextContent(
    `/tasks?task=${venue.id}`,
  );
});

it("closes the panel with Close, Escape and the back button", async () => {
  const { user } = renderApp("/tasks", { as: ada });
  await openVenue(user);
  await user.click(within(panel()!).getByRole("button", { name: "Close" }));
  expect(panel()).toBeNull();

  await openVenue(user);
  await user.keyboard("{Escape}");
  expect(panel()).toBeNull();

  await openVenue(user);
  await user.click(screen.getByRole("button", { name: "Browser back" }));
  expect(panel()).toBeNull();
  expect(screen.getByTestId("location")).toHaveTextContent(/^\/tasks$/);
});

it("keeps the same panel when switching tasks and focuses the new title", async () => {
  const { user } = renderApp("/tasks", { as: ada });
  await openVenue(user);
  const first = panel();
  await user.click(screen.getByRole("link", { name: "Order the cake" }));
  await waitFor(() =>
    expect(within(panel()!).getByLabelText("Title")).toHaveValue(
      "Order the cake",
    ),
  );
  // The same element: it slid in once and stays put while the task changes.
  expect(panel()).toBe(first);
  expect(within(panel()!).getByLabelText("Title")).toHaveFocus();
});

it("a link to /tasks?task=<id> opens the panel, saying when the task was added", async () => {
  renderApp(`/tasks?task=${venue.id}`, { as: ada });
  const details = await findPanel();
  expect(within(details).getByLabelText("Title")).toHaveValue("Book the venue");
  expect(
    within(details).getByText(`Added ${formatDate(venue.created_at)}`),
  ).toBeInTheDocument();
});

it("opens the full page from the panel", async () => {
  const { user } = renderApp(`/tasks?task=${venue.id}`, { as: ada });
  await user.click(await screen.findByRole("link", { name: "Open as page" }));
  expect(
    await screen.findByRole("heading", { name: "Task details" }),
  ).toBeInTheDocument();
  expect(screen.getByLabelText("Title")).toHaveValue("Book the venue");
  expect(screen.getByTestId("location")).toHaveTextContent(
    `/tasks/${venue.id}`,
  );
});

it("deleting from the panel closes it", async () => {
  vi.spyOn(window, "confirm").mockReturnValue(true);
  const { user } = renderApp(`/tasks?task=${venue.id}`, { as: ada });
  const details = await findPanel();
  await user.click(
    within(details).getByRole("button", { name: "Delete task" }),
  );
  expect(panel()).toBeNull();
  await waitFor(() => expect(db.tasks.has(venue.id)).toBe(false));
  expect(
    screen.queryByRole("link", { name: "Book the venue" }),
  ).not.toBeInTheDocument();
});
