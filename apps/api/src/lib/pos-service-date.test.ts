import { describe, it, expect } from '@jest/globals'
import { serviceDateFor } from './pos-service-date.js'

describe('serviceDateFor', () => {
  it('returns YYYY-MM-DD', () => {
    expect(serviceDateFor('UTC', new Date('2026-09-11T12:00:00Z'))).toBe('2026-09-11')
  })

  it('uses the tenant timezone, not UTC — 8pm Eastern is still the same day', () => {
    // 2026-09-12T00:30:00Z is 2026-09-11 20:30 in New York. A UTC-derived day
    // would roll the ticket sequence over mid dinner service.
    const utcDay = new Date('2026-09-12T00:30:00Z').toISOString().slice(0, 10)
    expect(utcDay).toBe('2026-09-12')
    expect(serviceDateFor('America/New_York', new Date('2026-09-12T00:30:00Z'))).toBe('2026-09-11')
  })

  it('handles the default tenant zone', () => {
    // 2026-09-12T02:30:00Z is 2026-09-11 21:30 in Chicago.
    expect(serviceDateFor('America/Chicago', new Date('2026-09-12T02:30:00Z'))).toBe('2026-09-11')
  })

  it('rolls to the next day once the tenant zone passes midnight', () => {
    // 2026-09-12T05:30:00Z is 2026-09-12 00:30 in Chicago.
    expect(serviceDateFor('America/Chicago', new Date('2026-09-12T05:30:00Z'))).toBe('2026-09-12')
  })

  it('handles a zone ahead of UTC', () => {
    // 2026-09-11T23:00:00Z is 2026-09-12 08:00 in Tokyo.
    expect(serviceDateFor('Asia/Tokyo', new Date('2026-09-11T23:00:00Z'))).toBe('2026-09-12')
  })

  it('falls back to UTC rather than throwing on an unknown zone', () => {
    expect(serviceDateFor('Not/AZone', new Date('2026-09-11T12:00:00Z'))).toBe('2026-09-11')
  })
})
