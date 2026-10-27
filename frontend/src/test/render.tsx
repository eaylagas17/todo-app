import { QueryClientProvider } from "@tanstack/react-query";
import { render, renderHook } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { MemoryRouter, useLocation, useNavigate } from "react-router";
import { vi } from "vitest";
import type { AuthResult } from "../api.ts";
import App from "../App.tsx";
import { saveAuth } from "../auth.ts";
import { ErrorBoundary } from "../ErrorBoundary.tsx";
import { createQueryClient } from "../queries.ts";

/** Shows the current URL, and goes back a step the way the browser's back button would. */
function LocationProbe() {
  const location = useLocation();
  const navigate = useNavigate();
  return (
    <>
      {/* A span, not <output>: output has the role "status", which the Saved message uses. */}
      <span data-testid="location">{location.pathname + location.search}</span>
      <button type="button" onClick={() => navigate(-1)}>
        Browser back
      </button>
    </>
  );
}

// The whole app at one URL, as `as` if given, with a fresh cache that never retries,
// so a failing request fails the test at once. fakeTimers: the test moves the clock itself
// (vi.advanceTimersByTime), for the 5-second undo window; it still runs on its own meanwhile.
export function renderApp(
  path: string,
  { as, fakeTimers = false }: { as?: AuthResult; fakeTimers?: boolean } = {},
) {
  if (as) saveAuth(as);
  if (fakeTimers) vi.useFakeTimers({ shouldAdvanceTime: true });
  const queryClient = createQueryClient(0);
  const user = userEvent.setup(
    fakeTimers ? { advanceTimers: vi.advanceTimersByTime } : {},
  );
  render(
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[path]}>
          <App />
          <LocationProbe />
        </MemoryRouter>
      </QueryClientProvider>
    </ErrorBoundary>,
  );
  return { user };
}

/** A hook on its own, with a fresh cache the test can inspect. */
export function renderHookWithClient<T>(hook: () => T) {
  const queryClient = createQueryClient(0);
  const { result } = renderHook(hook, {
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    ),
  });
  return { result, queryClient };
}
