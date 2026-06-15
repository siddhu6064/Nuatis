import { describe, it, expect } from '@jest/globals'
// getFirstName lives in packages/shared. packages/shared has no Jest runner of
// its own, so the unit test runs here — the api jest config maps
// '@nuatis/shared' to packages/shared/src so this exercises the source directly.
import { getFirstName } from '@nuatis/shared'

describe('getFirstName', () => {
  it('returns the first segment of a two-word name', () => {
    expect(getFirstName('John Doe')).toBe('John')
  })

  it('returns only the first segment of a multi-word name', () => {
    expect(getFirstName('María José García')).toBe('María')
  })

  it('returns the whole string when there is no space', () => {
    expect(getFirstName('Madonna')).toBe('Madonna')
  })

  it('returns the default fallback for null', () => {
    expect(getFirstName(null)).toBe('there')
  })

  it('returns the default fallback for undefined', () => {
    expect(getFirstName(undefined)).toBe('there')
  })

  it('returns the default fallback for an empty string', () => {
    expect(getFirstName('')).toBe('there')
  })

  it('returns the default fallback for a whitespace-only string', () => {
    expect(getFirstName('  ')).toBe('there')
  })

  it('returns the explicit fallback when provided and fullName is falsy', () => {
    expect(getFirstName(null, 'friend')).toBe('friend')
  })

  // Decision: getFirstName trims the input before splitting (matching the
  // canonical helper that previously lived in campaign-sender.ts). A leading
  // space therefore yields the real first name, not an empty string.
  it('trims leading whitespace before splitting', () => {
    expect(getFirstName('  John Doe')).toBe('John')
  })
})
