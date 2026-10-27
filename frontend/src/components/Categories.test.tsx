import { screen, waitFor, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { beforeEach, expect, it, vi } from "vitest";
import type { AuthResult, Task } from "../api.ts";
import { db, requests, seedTasks, seedUser, server } from "../test/fakeApi.ts";
import { renderApp } from "../test/render.tsx";

let ada: AuthResult;

beforeEach(() => {
  ada = seedUser();
});

const categoryId = (name: string) =>
  [...db.categories.values()].find(
    (entry) => entry.ownerId === ada.user.id && entry.category.name === name,
  )!.category.id;

const file = (task: Task, name: string) => {
  db.tasks.get(task.id)!.task.category_id = categoryId(name);
};

const sidebar = () => screen.findByRole("navigation", { name: "Categories" });
const rows = () =>
  within(screen.getByRole("list", { name: "Tasks" }))
    .getAllByRole("listitem")
    .map((row) => within(row).getAllByRole("link")[0].textContent);

it("lists categories with counts in the sidebar", async () => {
  const [venue, cake] = seedTasks(ada, ["Venue", "Cake", "Report"]);
  file(venue, "Home");
  file(cake, "Home");
  renderApp("/tasks", { as: ada });
  const nav = await sidebar();
  expect(
    await within(nav).findByRole("link", { name: "All 3" }),
  ).toBeInTheDocument();
  expect(within(nav).getByRole("link", { name: "Home 2" })).toBeInTheDocument();
  expect(within(nav).getByRole("link", { name: "Work 0" })).toBeInTheDocument();
});

it("filters the list by category", async () => {
  const [venue] = seedTasks(ada, ["Venue", "Report"]);
  file(venue, "Home");
  const { user } = renderApp("/tasks", { as: ada });
  await user.click(
    await within(await sidebar()).findByRole("link", { name: "Home 1" }),
  );
  await waitFor(() => expect(rows()).toEqual(["VenueHome"]));
  expect(screen.getByTestId("location")).toHaveTextContent(
    `/tasks?category=${categoryId("Home")}`,
  );
});

it("hides drag handles while a category is selected", async () => {
  const [venue] = seedTasks(ada, ["Venue", "Report"]);
  file(venue, "Home");
  renderApp(`/tasks?category=${categoryId("Home")}`, { as: ada });
  await sidebar();
  await waitFor(() => expect(rows()).toEqual(["VenueHome"]));
  expect(
    screen.queryByRole("button", { name: /^Reorder/ }),
  ).not.toBeInTheDocument();
});

it("adds a category", async () => {
  const { user } = renderApp("/tasks", { as: ada });
  const nav = await sidebar();
  await user.type(within(nav).getByLabelText("New category"), "Wedding{Enter}");
  expect(
    await within(nav).findByRole("link", { name: "Wedding 0" }),
  ).toBeInTheDocument();
});

it("renames and deletes a category", async () => {
  vi.spyOn(window, "confirm").mockReturnValue(true);
  const { user } = renderApp("/tasks", { as: ada });
  const nav = await sidebar();
  await user.click(
    await within(nav).findByRole("button", { name: "Edit categories" }),
  );
  const name = within(nav).getByLabelText("Rename Work");
  await user.clear(name);
  await user.type(name, "Office{Enter}");
  await waitFor(() =>
    expect(within(nav).getByLabelText("Rename Office")).toBeInTheDocument(),
  );
  await user.click(within(nav).getByRole("button", { name: "Delete Office" }));
  await user.click(within(nav).getByRole("button", { name: "Done" }));
  await waitFor(() =>
    expect(
      within(nav).queryByRole("link", { name: /^Office/ }),
    ).not.toBeInTheDocument(),
  );
  expect(within(nav).getByRole("link", { name: "Home 0" })).toBeInTheDocument();
});

it("falls back to All when the filtered category is deleted", async () => {
  vi.spyOn(window, "confirm").mockReturnValue(true);
  const [venue] = seedTasks(ada, ["Venue", "Report"]);
  file(venue, "Home");
  const { user } = renderApp(`/tasks?category=${categoryId("Home")}`, {
    as: ada,
  });
  const nav = await sidebar();
  await waitFor(() => expect(rows()).toEqual(["VenueHome"]));
  await user.click(
    within(nav).getByRole("button", { name: "Edit categories" }),
  );
  await user.click(within(nav).getByRole("button", { name: "Delete Home" }));
  await user.click(within(nav).getByRole("button", { name: "Done" }));
  await waitFor(() => expect(rows()).toEqual(["Venue", "Report"]));
  expect(within(nav).getByRole("link", { name: "All 2" })).toHaveAttribute(
    "aria-current",
    "page",
  );
});

it("picks a category in the panel", async () => {
  const [venue] = seedTasks(ada, ["Venue"]);
  const { user } = renderApp(`/tasks?task=${venue.id}`, { as: ada });
  const panel = await screen.findByRole("complementary", {
    name: "Task details",
  });
  await user.selectOptions(
    await within(panel).findByLabelText("Category"),
    "Work",
  );
  await waitFor(() =>
    expect(requests).toContainEqual({
      method: "PATCH",
      path: `/api/tasks/${venue.id}`,
      body: { category_id: categoryId("Work") },
    }),
  );
  expect(rows()).toEqual(["VenueWork"]);
});

it("suggests a category after creating a task", async () => {
  server.use(
    http.post("/api/tasks/:id/category-suggestion", ({ params }) => {
      const { task } = db.tasks.get(String(params.id))!;
      task.category_id = categoryId("Errands");
      return HttpResponse.json({ ...task });
    }),
  );
  const { user } = renderApp("/tasks", { as: ada });
  await user.type(await screen.findByLabelText("New task"), "Buy stamps");
  await user.click(screen.getByRole("button", { name: "Add task" }));
  await waitFor(() => expect(rows()).toEqual(["Buy stampsErrands"]));
});

it("stays quiet when AI is unavailable", async () => {
  const { user } = renderApp("/tasks", { as: ada });
  await user.type(await screen.findByLabelText("New task"), "Buy stamps");
  await user.click(screen.getByRole("button", { name: "Add task" }));
  await waitFor(() =>
    expect(requests.some((r) => r.path.endsWith("/category-suggestion"))).toBe(
      true,
    ),
  );
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(rows()).toEqual(["Buy stamps"]);
});

it("suggests again after a title edit when still uncategorised", async () => {
  const [venue] = seedTasks(ada, ["Venue"]);
  const { user } = renderApp(`/tasks?task=${venue.id}`, { as: ada });
  const panel = await screen.findByRole("complementary", {
    name: "Task details",
  });
  await user.type(within(panel).getByLabelText("Title"), " booking");
  await user.click(within(panel).getByRole("button", { name: "Save" }));
  await waitFor(() =>
    expect(requests).toContainEqual({
      method: "POST",
      path: `/api/tasks/${venue.id}/category-suggestion`,
      body: undefined,
    }),
  );
});
