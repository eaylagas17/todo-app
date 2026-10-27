import "@testing-library/jest-dom/vitest";
import { onlineManager } from "@tanstack/react-query";
import { cleanup } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, vi } from "vitest";
import { clearAuth } from "../auth.ts";
import { resetDb, server } from "./fakeApi.ts";

// jsdom has no hit-testing or pointer capture: no-ops that tests can spy on.
document.elementFromPoint ??= () => null;
Element.prototype.setPointerCapture ??= () => {};

beforeAll(() => server.listen({ onUnhandledFrame: "error" }));

afterEach(() => {
  cleanup();
  server.resetHandlers();
  resetDb();
  clearAuth();
  localStorage.clear();
  delete document.documentElement.dataset.theme;
  vi.restoreAllMocks();
  vi.useRealTimers();
  onlineManager.setOnline(true);
});

afterAll(() => server.close());
