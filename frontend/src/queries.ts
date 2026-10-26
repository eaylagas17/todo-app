import { QueryClient } from "@tanstack/react-query";

// networkMode "always": TanStack Query's default ("online") pauses every request while the
// browser reports being offline, which leaves a spinner and no message. We send anyway, fail
// fast, and show "Can't reach the server" with a way to try again.
export const createQueryClient = (retry = 3) =>
  new QueryClient({
    defaultOptions: {
      queries: { retry, networkMode: "always" },
      mutations: { networkMode: "always" },
    },
  });
