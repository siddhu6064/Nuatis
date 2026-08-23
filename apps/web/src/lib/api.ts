/**
 * Shared fetch wrapper for client-side API calls.
 *
 * Auth is injected server-side by `apps/web/src/proxy.ts`, so call sites
 * only need relative `/api/...` paths — no manual auth header, same as
 * every existing `fetch(...)` call in this app.
 *
 * This module is purely additive: it does NOT replace any existing
 * `fetch(` call site. It exists so future code has a shared mechanic to
 * reach for instead of hand-rolling the same res.ok / JSON parsing /
 * error-shape logic again. Migrate existing call sites incrementally.
 *
 * Deliberately does NOT show a toast or otherwise present the error —
 * that stays the caller's responsibility, since UX (toast vs. inline
 * field error vs. silent swallow) varies by call site in this codebase.
 */

/**
 * Error thrown by `apiFetch` when the response status is not ok (2xx).
 * Carries the HTTP status and, when the backend sent one, the parsed
 * `{ error: string }` body (per the shape used throughout
 * `apps/api/src/routes/*.ts`, e.g. `res.status(400).json({ error: '...' })`).
 */
export class ApiError extends Error {
  status: number
  body: unknown

  constructor(message: string, status: number, body?: unknown) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.body = body
  }
}

function isErrorBody(value: unknown): value is { error: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'error' in value &&
    typeof (value as { error?: unknown }).error === 'string'
  )
}

/**
 * Performs a fetch against a (typically relative `/api/...`) URL, checks
 * `res.ok`, and either:
 *  - throws an `ApiError` (status + parsed `{error}` body, when present)
 *    on failure, or
 *  - resolves with the parsed JSON body typed as `T` on success.
 *
 * A 204 No Content response (used by several DELETE endpoints, e.g.
 * `apps/api/src/routes/appointments.ts`) resolves to `undefined` — type
 * the call as `apiFetch<void>(...)` in that case.
 */
export async function apiFetch<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, options)

  if (!res.ok) {
    const body = await res
      .clone()
      .json()
      .catch(() => null)
    const message = isErrorBody(body) ? body.error : `Request failed with status ${res.status}`
    throw new ApiError(message, res.status, body)
  }

  if (res.status === 204) {
    return undefined as T
  }

  return (await res.json()) as T
}
