/**
 * Shared "race a promise against a timeout" helpers.
 *
 * A prior audit found this pattern duplicated across many call sites, but
 * with genuinely different behaviors on timeout — some resolve `null`,
 * others reject with an `Error`. Collapsing those into one signature would
 * be a real behavior change for callers, so this module intentionally
 * exposes two separate helpers, each preserving one existing behavior
 * exactly. Do NOT merge them into a single unified function.
 *
 * Sites with additional wrinkles beyond these two clean patterns (e.g. a
 * custom non-null fallback value, or extra work inside the timeout branch
 * itself) are intentionally NOT converted to use these helpers — see the
 * per-site notes where `Promise.race` is still used directly.
 */

/**
 * Resolves `null` if `ms` elapses before `promise` settles. Otherwise
 * resolves/rejects with whatever `promise` does. The internal timer is
 * always cleared once `promise` settles, so a late-firing timer never
 * lingers.
 */
export function withTimeoutOrNull<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return new Promise<T | null>((resolve, reject) => {
    const timer = setTimeout(() => resolve(null), ms)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (err: unknown) => {
        clearTimeout(timer)
        reject(err)
      }
    )
  })
}

/**
 * Rejects with `new Error(message ?? 'timeout')` if `ms` elapses before
 * `promise` settles. Otherwise resolves/rejects with whatever `promise`
 * does. The internal timer is always cleared once `promise` settles, so a
 * late-firing timer never lingers.
 */
export function withTimeoutOrThrow<T>(
  promise: Promise<T>,
  ms: number,
  message?: string
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message ?? 'timeout')), ms)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (err: unknown) => {
        clearTimeout(timer)
        reject(err)
      }
    )
  })
}
