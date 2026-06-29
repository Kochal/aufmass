/**
 * Runtime API client — wraps the openapi-typescript generated schema.ts types.
 *
 * Layer contract (directive 10): the frontend talks only to this client, which
 * talks only to the backend. It never calls Postgres, the model server, the
 * validator, or M365 directly.
 *
 * Auth: in dev the backend reads X-Tenant-Id / X-User-Id headers (deps.py
 * get_principal stub). This middleware injects them from the auth store on
 * every request. Real Entra SSO (directive 09) replaces this middleware only.
 */
import createClient, { type Middleware } from "openapi-fetch";
import type { paths } from "@/api/schema";

const AUTH_STORAGE_KEY = "dev-auth";

/** Read auth headers from localStorage (synchronous, works outside React). */
export function getAuthHeaders(): Record<string, string> {
  try {
    const stored = localStorage.getItem(AUTH_STORAGE_KEY);
    if (!stored) return {};
    const parsed = JSON.parse(stored) as { tenantId: string; userId: string };
    if (!parsed.tenantId || !parsed.userId) return {};
    return {
      "x-tenant-id": parsed.tenantId,
      "x-user-id": parsed.userId,
    };
  } catch {
    return {};
  }
}

/** Write auth to localStorage (called by AuthContext.login). */
export function persistAuth(tenantId: string, userId: string): void {
  localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify({ tenantId, userId }));
}

/** Clear auth from localStorage (called by AuthContext.logout). */
export function clearAuth(): void {
  localStorage.removeItem(AUTH_STORAGE_KEY);
}

const authMiddleware: Middleware = {
  async onRequest({ request }) {
    const headers = getAuthHeaders();
    for (const [key, value] of Object.entries(headers)) {
      request.headers.set(key, value);
    }
    return request;
  },
};

export const apiClient = createClient<paths>({
  baseUrl: import.meta.env.VITE_API_URL ?? "",
  credentials: "include",
});

apiClient.use(authMiddleware);

/**
 * Helper: unwrap an openapi-fetch response and throw on error.
 * Use inside TanStack Query queryFn and mutationFn so errors surface
 * through the react-query error boundary rather than being swallowed.
 */
export function unwrap<T>({
  data,
  error,
  response,
}: {
  data?: T;
  error?: unknown;
  response: Response;
}): T {
  if (!response.ok) {
    const err = error as { detail?: string } | string | undefined;
    const detail =
      typeof err === "string"
        ? err
        : typeof err === "object" && err?.detail
          ? err.detail
          : `HTTP ${response.status}`;
    throw Object.assign(new Error(detail), { status: response.status });
  }
  return data as T;
}
