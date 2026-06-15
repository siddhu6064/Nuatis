import { describe, it, expect } from '@jest/globals'
// These utilities live in packages/shared (no Jest runner of its own); the api
// jest config maps '@nuatis/shared' to packages/shared/src so this exercises
// the source directly.
import { formatCurrency, formatCurrencyWhole, dateAtHour, formatHHMM } from '@nuatis/shared'

describe('formatCurrency', () => {
  it('formats a standard amount', () => {
    expect(formatCurrency(1234.56)).toBe('$1,234.56')
  })
  it('formats zero', () => {
    expect(formatCurrency(0)).toBe('$0.00')
  })
  it('formats millions with separators', () => {
    expect(formatCurrency(1000000)).toBe('$1,000,000.00')
  })
  it('handles floating point sums', () => {
    expect(formatCurrency(0.1 + 0.2)).toBe('$0.30')
  })
  it('pads to two decimals', () => {
    expect(formatCurrency(1234.5)).toBe('$1,234.50')
  })
  it('rounds (not truncates) the third decimal', () => {
    expect(formatCurrency(1234.567)).toBe('$1,234.57')
  })
  it('renders negatives with leading sign', () => {
    expect(formatCurrency(-99.99)).toBe('-$99.99')
  })
})

describe('formatCurrencyWhole', () => {
  it('rounds to whole dollars with no decimals', () => {
    expect(formatCurrencyWhole(1234.56)).toBe('$1,235')
  })
  it('formats zero with no decimals', () => {
    expect(formatCurrencyWhole(0)).toBe('$0')
  })
  it('keeps thousands separators', () => {
    expect(formatCurrencyWhole(1000000)).toBe('$1,000,000')
  })
})

describe('dateAtHour', () => {
  it('resolves a UTC wall-clock hour to the same UTC instant', () => {
    expect(dateAtHour('2026-06-15', 9, 0, 'UTC')).toBe('2026-06-15T09:00:00.000Z')
  })
  it('resolves midnight', () => {
    expect(dateAtHour('2026-06-15', 0, 0, 'UTC')).toBe('2026-06-15T00:00:00.000Z')
  })
  it('resolves a late hour with minutes', () => {
    expect(dateAtHour('2026-06-15', 23, 30, 'UTC')).toBe('2026-06-15T23:30:00.000Z')
  })
  it('applies the timezone offset (9am CDT → 14:00 UTC)', () => {
    expect(dateAtHour('2026-06-15', 9, 0, 'America/Chicago')).toBe('2026-06-15T14:00:00.000Z')
  })
})

describe('formatHHMM', () => {
  it('formats with zero-padded minutes', () => {
    expect(formatHHMM(new Date('2026-06-15T09:05:00Z'), 'UTC')).toBe('09:05')
  })
  it('formats an afternoon time', () => {
    expect(formatHHMM(new Date('2026-06-15T14:30:00Z'), 'UTC')).toBe('14:30')
  })
  it('formats midnight', () => {
    expect(formatHHMM(new Date('2026-06-15T00:00:00Z'), 'UTC')).toBe('00:00')
  })
  it('formats in a non-UTC timezone (14:00 UTC → 09:00 CDT)', () => {
    expect(formatHHMM(new Date('2026-06-15T14:00:00Z'), 'America/Chicago')).toBe('09:00')
  })
})
