/**
 * In-memory TTL cache for the self-serve trial-expiry flag, keyed by tenant.
 * Follows the shape of lib/staff-cache.ts. Used by the enforce-trial
 * middleware so the date-boundary check doesn't cost an uncached tenant
 * read on every authenticated request. TTL is 60s — staleness on a 3-day
 * grace window is irrelevant.
 *
 * FAIL OPEN, unlike every other gate in this codebase: a Supabase timeout,
 * a DB error, or a missing row must ALLOW the request. Locking a small
 * business out of their own phone line over a DB blip is worse than three
 * extra days of free access. Fail-open results are NOT cached, so a blip
 * doesn't pin the tenant open for the full TTL.
 */
import { createClient } from '@supabase/supabase-js'
import { isTrialExpired } from './trial-status.js'

interface TrialCacheEntry {
  expired: boolean
  trialEndsAt: string | null
  cachedAt: number
}

interface TenantTrialRow {
  stripe_subscription_id: string | null
  trial_ends_at: string | null
}

const TTL_MS = 60 * 1000
const LOOKUP_TIMEOUT_MS = 2000

const cache = new Map<string, TrialCacheEntry>()

export function invalidateTrialCache(tenantId: string): void {
  cache.delete(tenantId)
}

/** trial_ends_at from the cache entry, for the 402 response body. */
export function getCachedTrialEndsAt(tenantId: string): string | null {
  return cache.get(tenantId)?.trialEndsAt ?? null
}

export async function getTrialExpired(tenantId: string): Promise<boolean> {
  const entry = cache.get(tenantId)
  if (entry && Date.now() - entry.cachedAt <= TTL_MS) return entry.expired

  const url = process.env['SUPABASE_URL']
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY']
  if (!url || !key) return false

  const supabase = createClient(url, key)

  let timerHandle: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<null>((resolve) => {
    timerHandle = setTimeout(() => {
      console.warn(
        `[trial-cache] tenant lookup timed out after 2s — failing open tenant=${tenantId}`
      )
      resolve(null)
    }, LOOKUP_TIMEOUT_MS)
    // unref so this timer never prevents the process from exiting cleanly
    timerHandle.unref()
  })

  const lookup: Promise<TenantTrialRow | null> = Promise.resolve(
    supabase
      .from('tenants')
      .select('stripe_subscription_id, trial_ends_at')
      .eq('id', tenantId)
      .maybeSingle<TenantTrialRow>()
  ).then(
    (result) => {
      if (result.error) {
        console.warn('[trial-cache] tenant lookup error — failing open:', result.error.message)
        return null
      }
      return result.data ?? null
    },
    (err: unknown) => {
      console.warn('[trial-cache] tenant lookup threw — failing open:', err)
      return null
    }
  )

  const row = await Promise.race([lookup, timeout])
  // Always clear — no-op if timer already fired, cancels it if lookup won
  clearTimeout(timerHandle)

  if (!row) return false

  const expired = isTrialExpired(row)
  cache.set(tenantId, { expired, trialEndsAt: row.trial_ends_at, cachedAt: Date.now() })
  return expired
}
