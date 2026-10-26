import { screen } from "@testing-library/react";
import type { UserEvent } from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { expect, it } from "vitest";
import { NETWORK_MESSAGE } from "../api.ts";
import { seedUser, server } from "../test/fakeApi.ts";
import { renderApp } from "../test/render.tsx";

async function fillIn(
  user: UserEvent,
  email = "ada@example.com",
  password = "correct-horse",
) {
  await user.type(screen.getByLabelText("Email"), email);
  await user.type(screen.getByLabelText("Password"), password);
}

it("sends signed-out visitors to the sign-in page", async () => {
  renderApp("/tasks");
  expect(
    await screen.findByRole("heading", { name: "Sign in" }),
  ).toBeInTheDocument();
});

it("skips sign-in when already signed in", async () => {
  renderApp("/login", { as: seedUser() });
  expect(
    await screen.findByRole("heading", { name: "My tasks" }),
  ).toBeInTheDocument();
});

it("signs in and shows the task list", async () => {
  seedUser();
  const { user } = renderApp("/login");
  await fillIn(user);
  await user.click(screen.getByRole("button", { name: "Sign in" }));
  expect(
    await screen.findByRole("heading", { name: "My tasks" }),
  ).toBeInTheDocument();
  expect(screen.getByText("ada@example.com")).toBeInTheDocument();
});

it("creates an account and shows the task list", async () => {
  const { user } = renderApp("/login");
  await fillIn(user, "grace@example.com");
  await user.click(screen.getByRole("button", { name: "Create account" }));
  expect(
    await screen.findByRole("heading", { name: "My tasks" }),
  ).toBeInTheDocument();
  expect(screen.getByText("grace@example.com")).toBeInTheDocument();
});

it("shows the server's message after a failed sign-in", async () => {
  seedUser();
  const { user } = renderApp("/login");
  await fillIn(user, "ada@example.com", "wrong-password");
  await user.click(screen.getByRole("button", { name: "Sign in" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Invalid email or password",
  );
});

it("shows the server's message for a taken email", async () => {
  seedUser();
  const { user } = renderApp("/login");
  await fillIn(user);
  await user.click(screen.getByRole("button", { name: "Create account" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Email is already registered",
  );
});

it("shows the network message when the server is unreachable", async () => {
  server.use(http.post("/api/sessions", () => HttpResponse.error()));
  const { user } = renderApp("/login");
  await fillIn(user);
  await user.click(screen.getByRole("button", { name: "Sign in" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(NETWORK_MESSAGE);
});

it("signs out and returns to sign-in", async () => {
  const { user } = renderApp("/tasks", { as: seedUser() });
  await user.click(await screen.findByRole("button", { name: "Sign out" }));
  expect(
    await screen.findByRole("heading", { name: "Sign in" }),
  ).toBeInTheDocument();
  expect(localStorage.getItem("todo.auth")).toBeNull();
});
