import { screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { seedUser } from "./test/fakeApi.ts";
import { renderApp } from "./test/render.tsx";

const theme = () => document.documentElement.dataset.theme;

it("switches between light and dark from the header, and remembers it", async () => {
  const { user } = renderApp("/tasks", { as: seedUser() });
  // jsdom has no system preference, so the app starts light.
  const toggle = await screen.findByRole("button", { name: "Dark mode" });
  expect(toggle).toHaveAttribute("aria-pressed", "false");
  await user.click(toggle);
  expect(theme()).toBe("dark");
  expect(localStorage.getItem("todo.theme")).toBe("dark");
  expect(toggle).toHaveAttribute("aria-pressed", "true");
  await user.click(toggle);
  expect(theme()).toBe("light");
  expect(localStorage.getItem("todo.theme")).toBe("light");
});

it("starts from the theme already on the page", async () => {
  // index.html sets it from the saved choice before the first paint.
  document.documentElement.dataset.theme = "dark";
  renderApp("/tasks", { as: seedUser() });
  expect(
    await screen.findByRole("button", { name: "Dark mode" }),
  ).toHaveAttribute("aria-pressed", "true");
});
