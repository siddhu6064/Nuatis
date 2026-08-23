import { useCallback, useState } from 'react'
import { ApiError, apiFetch } from '@/lib/api'

/**
 * Wraps `apiFetch` with the `useState<boolean>(false)` loading flag +
 * `useState<string | null>(null)` error message pair used throughout this
 * codebase's existing components (e.g. `smsSending`/`smsError` in
 * `apps/web/src/app/(dashboard)/contacts/[id]/ContactDetailClient.tsx`,
 * or the `msgLoading`/`webchatLoading` flags in
 * `apps/web/src/app/(dashboard)/conversations/ConversationsClient.tsx`).
 *
 * Kept intentionally close to that existing shape so an incremental
 * migration of a call site is a small, mechanical diff rather than a
 * restructuring: swap a hand-rolled `setLoading`/`try`/`catch`/`setError`
 * block for a call to `execute`.
 *
 * Does not show a toast or otherwise present the error — same as
 * `apiFetch`, presentation stays the caller's responsibility.
 */
export interface UseApiState<T> {
  data: T | null
  loading: boolean
  error: string | null
}

export interface UseApiResult<T> extends UseApiState<T> {
  /** Runs the request, updating loading/data/error. Returns the parsed
   *  body on success, or `null` if the request failed (the error is
   *  available via `error` / the thrown `ApiError`, whichever the caller
   *  finds more convenient). */
  execute: (url: string, options?: RequestInit) => Promise<T | null>
  /** Resets `data`/`error` back to their initial values. Does not touch `loading`. */
  reset: () => void
}

export function useApi<T = unknown>(): UseApiResult<T> {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const execute = useCallback(async (url: string, options?: RequestInit): Promise<T | null> => {
    setLoading(true)
    setError(null)
    try {
      const result = await apiFetch<T>(url, options)
      setData(result)
      return result
    } catch (err) {
      const message =
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Request failed'
      setError(message)
      return null
    } finally {
      setLoading(false)
    }
  }, [])

  const reset = useCallback(() => {
    setData(null)
    setError(null)
  }, [])

  return { data, loading, error, execute, reset }
}
