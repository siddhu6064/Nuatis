import { describe, it, expect } from '@jest/globals'
import { calcOverageMinutes } from './call-session-logger.js'

describe('calcOverageMinutes — Scale (unlimited)', () => {
  it('returns 0 regardless of usage when limit is null', () => {
    expect(calcOverageMinutes(0, 10, null)).toBe(0)
    expect(calcOverageMinutes(10_000, 600, null)).toBe(0)
  })
})

describe('calcOverageMinutes — Core/Pro (capped)', () => {
  it('returns 0 when call stays inside the limit', () => {
    // Core: 300m included, used 250, called 30 → still under
    expect(calcOverageMinutes(250, 30, 300)).toBe(0)
  })

  it('returns 0 when call lands exactly at the limit', () => {
    expect(calcOverageMinutes(290, 10, 300)).toBe(0)
  })

  it('returns just the portion that crossed the boundary', () => {
    // Used 290, called 20 → 290+20=310; only 10 minutes over limit.
    expect(calcOverageMinutes(290, 20, 300)).toBe(10)
  })

  it('returns the full call duration when already past the limit', () => {
    // Used 305, called 15 → call entirely above limit
    expect(calcOverageMinutes(305, 15, 300)).toBe(15)
  })

  it('handles the exact-limit-then-overage edge', () => {
    // Used 300, called 5 → 5m of overage
    expect(calcOverageMinutes(300, 5, 300)).toBe(5)
  })
})
