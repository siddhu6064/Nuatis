import { describe, it, expect } from '@jest/globals'
import { hashPin, verifyPin } from './pos-pin.js'

describe('pos pin hashing', () => {
  it('verifies a correct pin', async () => {
    const stored = await hashPin('4821')
    expect(await verifyPin('4821', stored)).toBe(true)
  })

  it('rejects an incorrect pin', async () => {
    const stored = await hashPin('4821')
    expect(await verifyPin('0000', stored)).toBe(false)
  })

  it('salts — the same pin hashes differently every time', async () => {
    expect(await hashPin('4821')).not.toBe(await hashPin('4821'))
  })

  it('does not store the pin in the clear', async () => {
    expect(await hashPin('4821')).not.toContain('4821')
  })

  it('returns false rather than throwing on a malformed stored value', async () => {
    expect(await verifyPin('4821', 'not-a-real-hash')).toBe(false)
  })

  it('returns false rather than throwing on a truncated hash', async () => {
    const stored = await hashPin('4821')
    expect(await verifyPin('4821', stored.slice(0, stored.length - 10))).toBe(false)
  })

  it('returns false on an empty stored value', async () => {
    expect(await verifyPin('4821', '')).toBe(false)
  })

  it('rejects a pin that differs only by a trailing space', async () => {
    const stored = await hashPin('4821')
    expect(await verifyPin('4821 ', stored)).toBe(false)
  })
})
