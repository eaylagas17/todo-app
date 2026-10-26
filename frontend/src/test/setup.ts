import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, vi } from "vitest";
import { clearAuth } from "../auth.ts";
import { resetDb, server } from "./fakeApi.ts";

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));

afterEach(() => {
  cleanup();
  server.resetHandlers();
  resetDb();
  clearAuth();
  localStorage.clear();
  vi.restoreAllMocks();
});

afterAll(() => server.close());
