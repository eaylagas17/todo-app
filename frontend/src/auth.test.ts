import { expect, it, vi } from "vitest";
import { clearAuth, getAuth, saveAuth } from "./auth.ts";

const ada = { user: { id: "u", email: "ada@example.com" }, token: "abc" };

it("saves, reads and clears the session", () => {
  saveAuth(ada);
  expect(getAuth()).toEqual(ada);
  expect(JSON.parse(localStorage.getItem("todo.auth")!)).toEqual(ada);
  clearAuth();
  expect(getAuth()).toBeNull();
});

it("reads a session saved by an earlier visit", async () => {
  localStorage.setItem("todo.auth", JSON.stringify(ada));
  vi.resetModules();
  expect((await import("./auth.ts")).getAuth()).toEqual(ada);
});

it("treats corrupt saved data as signed out", async () => {
  localStorage.setItem("todo.auth", "{not json");
  vi.resetModules();
  expect((await import("./auth.ts")).getAuth()).toBeNull();
});

it("keeps working in memory when storage is blocked", () => {
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new DOMException("blocked");
  });
  saveAuth(ada);
  expect(getAuth()).toEqual(ada);
});
