import { QueryClient } from "@tanstack/react-query";

/**
 * Single shared QueryClient instance.
 *
 * Retry policy: retry once on 5xx (server error), never on 4xx (client
 * error). A 409 (stale row_version) should surface immediately so the
 * mutation handler can refetch and notify the user.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000, // 30 s — server data is stable; avoid flash on nav
      retry: (failureCount, error) => {
        const status = (error as { status?: number })?.status;
        if (status && status >= 400 && status < 500) return false;
        return failureCount < 1;
      },
    },
    mutations: {
      retry: false,
    },
  },
});
