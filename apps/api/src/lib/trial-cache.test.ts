import { describe, it, expect, jest, beforeAll, beforeEach, afterEach } from '@jest/globals'

beforeAll(() => {
  process.env['SUPABASE_URL'] = 'https://example.supabase.co'
  process.env['SUPABASE_SERVICE_ROLE_KEY'] = 'service-role-test'
})

interface TrialRow {
  stripe_subscription_id: string | null
  trial_ends_at: string | null
}

type MaybeSingleResult = { data: TrialRow | null; error: { message: string } | null }

const EXPIRED_ROW: TrialRow = {
  stripe_subscription_id: null,
  trial_ends_at: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(),
}

const ACTIVE_ROW: TrialRow = {
  stripe_subscription_id: null,
  trial_ends_at: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString(),
}

beforeEach(() => {
  jest.resetModules()
})

afterEach(() => {
  jest.useRealTimers()
  jest.restoreAllMocks()
})

/** Loads a fresh trial-cache with a supabase mock whose maybeSingle we control. */
async function loadWith(maybeSingle: () => Promise<MaybeSingleResult>) {
  const maybeSingleMock = jest.fn(maybeSingle)
  jest.unstable_mockModule('@supabase/supabase-js', () => ({
    createClient: () => ({
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: maybeSingleMock,
          }),
        }),
      }),
    }),
  }))
  const mod = await import('./trial-cache.js')
  return { ...mod, maybeSingleMock }
}

describe('getTrialExpired', () => {
  it('cache miss reads the DB and computes; hit within TTL skips the DB', async () => {
    const { getTrialExpired, maybeSingleMock } = await loadWith(() =>
      Promise.resolve({ data: EXPIRED_ROW, error: null })
    )
    expect(await getTrialExpired('t1')).toBe(true)
    expect(await getTrialExpired('t1')).toBe(true)
    expect(maybeSingleMock).toHaveBeenCalledTimes(1)
  })

  it('returns false for an active trial', async () => {
    const { getTrialExpired } = await loadWith(() =>
      Promise.resolve({ data: ACTIVE_ROW, error: null })
    )
    expect(await getTrialExpired('t1')).toBe(false)
  })

  it('re-reads after the 60s TTL expires', async () => {
    const { getTrialExpired, maybeSingleMock } = await loadWith(() =>
      Promise.resolve({ data: EXPIRED_ROW, error: null })
    )
    const t0 = Date.now()
    await getTrialExpired('t1')
    jest.spyOn(Date, 'now').mockReturnValue(t0 + 61_000)
    await getTrialExpired('t1')
    expect(maybeSingleMock).toHaveBeenCalledTimes(2)
  })

  it('invalidateTrialCache forces a fresh read', async () => {
    const { getTrialExpired, invalidateTrialCache, maybeSingleMock } = await loadWith(() =>
      Promise.resolve({ data: EXPIRED_ROW, error: null })
    )
    await getTrialExpired('t1')
    invalidateTrialCache('t1')
    await getTrialExpired('t1')
    expect(maybeSingleMock).toHaveBeenCalledTimes(2)
  })

  it('fails open on DB error and does NOT cache the fail-open result', async () => {
    const { getTrialExpired, maybeSingleMock } = await loadWith(() =>
      Promise.resolve({ data: null, error: { message: 'boom' } })
    )
    expect(await getTrialExpired('t1')).toBe(false)
    expect(await getTrialExpired('t1')).toBe(false)
    // Both calls hit the DB — nothing was cached by the failure path.
    expect(maybeSingleMock).toHaveBeenCalledTimes(2)
  })

  it('fails open on a missing row without caching', async () => {
    const { getTrialExpired, maybeSingleMock } = await loadWith(() =>
      Promise.resolve({ data: null, error: null })
    )
    expect(await getTrialExpired('t1')).toBe(false)
    expect(await getTrialExpired('t1')).toBe(false)
    expect(maybeSingleMock).toHaveBeenCalledTimes(2)
  })

  it('fails open when the lookup exceeds the 2s timeout', async () => {
    jest.useFakeTimers()
    const { getTrialExpired } = await loadWith(
      () => new Promise<MaybeSingleResult>(() => undefined) // never resolves
    )
    const pending = getTrialExpired('t1')
    await jest.advanceTimersByTimeAsync(2001)
    expect(await pending).toBe(false)
  })

  it('exposes the cached trial_ends_at for the 402 body', async () => {
    const { getTrialExpired, getCachedTrialEndsAt } = await loadWith(() =>
      Promise.resolve({ data: EXPIRED_ROW, error: null })
    )
    await getTrialExpired('t1')
    expect(getCachedTrialEndsAt('t1')).toBe(EXPIRED_ROW.trial_ends_at)
  })
})
