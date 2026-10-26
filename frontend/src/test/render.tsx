import { QueryClientProvider } from "@tanstack/react-query";
import { render, renderHook } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router";
import type { AuthResult } from "../api.ts";
import App from "../App.tsx";
import { saveAuth } from "../auth.ts";
import { ErrorBoundary } from "../ErrorBoundary.tsx";
import { createQueryClient } from "../queries.ts";

// The whole app at one URL, as `as` if given, with a fresh cache that never retries,
// so a failing request fails the test at once.
export function renderApp(path: string, { as }: { as?: AuthResult } = {}) {
  if (as) saveAuth(as);
  const queryClient = createQueryClient(0);
  const user = userEvent.setup();
  render(
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[path]}>
          <App />
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
