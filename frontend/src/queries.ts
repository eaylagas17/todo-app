import { QueryClient } from "@tanstack/react-query";

export const createQueryClient = (retry = 3) =>
  new QueryClient({ defaultOptions: { queries: { retry } } });
