import { PostHog } from 'posthog-node'

/**
 * Lazy singleton PostHog node client for server-side activation events.
 *
 * Reads POSTHOG_KEY + POSTHOG_HOST from the SERVER env (no NEXT_PUBLIC prefix).
 * When POSTHOG_KEY is unset the client is never created and capture() is a
 * no-op — the API runs identically with zero PostHog calls. Every capture is
 * wrapped so a PostHog failure can never throw into a request/voice path.
 */

let client: PostHog | null = null

function getClient(): PostHog | null {
  if (client) return client
  const key = process.env['POSTHOG_KEY']
  if (!key) return null
  const host = process.env['POSTHOG_HOST']
  client = new PostHog(key, host ? { host } : undefined)
  return client
}

/**
 * Fire-and-forget event capture. Never throws, never blocks meaningfully
 * (posthog-node batches in-memory and flushes in the background). No-ops when
 * POSTHOG_KEY is unset.
 */
export function capture(
  distinctId: string,
  event: string,
  properties?: Record<string, unknown>
): void {
  try {
    const ph = getClient()
    if (!ph) return
    ph.capture({ distinctId, event, properties })
  } catch (err) {
    console.warn('[posthog] capture failed:', err)
  }
}

/**
 * Flush queued events on shutdown so they survive a container recycle. Safe to
 * call when no client exists (no key). Never throws.
 */
export async function shutdownPostHog(): Promise<void> {
  if (!client) return
  try {
    await client.flush()
  } catch (err) {
    console.warn('[posthog] flush on shutdown failed:', err)
  }
}

/** Test-only: drop the memoized client so env changes take effect. */
export function __resetPostHogClientForTests(): void {
  client = null
}
