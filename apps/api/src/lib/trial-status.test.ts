import { describe, it, expect } from '@jest/globals'
import { isTrialExpired, TRIAL_GRACE_DAYS } from './trial-status.js'

const NOW = new Date('2026-07-09T12:00:00.000Z')

function daysAgo(days: number): string {
  return new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000).toISOString()
}

describe('isTrialExpired', () => {
  it('returns false when stripe_subscription_id is set, even with an ancient trial date', () => {
    expect(
      isTrialExpired({ stripe_subscription_id: 'sub_123', trial_ends_at: daysAgo(365) }, NOW)
    ).toBe(false)
  })

  it('returns false when trial_ends_at is null (fail open)', () => {
    expect(isTrialExpired({ stripe_subscription_id: null, trial_ends_at: null }, NOW)).toBe(false)
  })

  it('returns false while the trial is still running', () => {
    expect(isTrialExpired({ stripe_subscription_id: null, trial_ends_at: daysAgo(-2) }, NOW)).toBe(
      false
    )
  })

  it('returns false on day 2 of the grace window', () => {
    expect(isTrialExpired({ stripe_subscription_id: null, trial_ends_at: daysAgo(2) }, NOW)).toBe(
      false
    )
  })

  it('returns true on day 4 — past trial_ends_at + grace', () => {
    expect(isTrialExpired({ stripe_subscription_id: null, trial_ends_at: daysAgo(4) }, NOW)).toBe(
      true
    )
  })

  it('flips exactly past the grace boundary', () => {
    const boundary = new Date(NOW.getTime() - TRIAL_GRACE_DAYS * 24 * 60 * 60 * 1000)
    expect(
      isTrialExpired({ stripe_subscription_id: null, trial_ends_at: boundary.toISOString() }, NOW)
    ).toBe(false)
    const justPast = new Date(boundary.getTime() - 1000)
    expect(
      isTrialExpired({ stripe_subscription_id: null, trial_ends_at: justPast.toISOString() }, NOW)
    ).toBe(true)
  })

  it('returns false on an unparseable date (fail open)', () => {
    expect(isTrialExpired({ stripe_subscription_id: null, trial_ends_at: 'not-a-date' }, NOW)).toBe(
      false
    )
  })
})
