import { describe, it, expect } from '@jest/globals'
import { tenderBalanceCents, changeDueCents, type TenderLeg } from './tender.js'

describe('tenderBalanceCents', () => {
  it('returns the full total when nothing is tendered', () => {
    expect(tenderBalanceCents(5000, [])).toBe(5000)
  })

  it('subtracts each leg', () => {
    const legs: TenderLeg[] = [
      { method: 'cash', amountCents: 2000 },
      { method: 'card', amountCents: 1500 },
    ]
    expect(tenderBalanceCents(5000, legs)).toBe(1500)
  })

  it('returns zero on an exact split', () => {
    const legs: TenderLeg[] = [
      { method: 'cash', amountCents: 2500 },
      { method: 'card', amountCents: 2500 },
    ]
    expect(tenderBalanceCents(5000, legs)).toBe(0)
  })

  it('handles a five-leg split without drift', () => {
    const legs: TenderLeg[] = [
      { method: 'card', amountCents: 1001 },
      { method: 'card', amountCents: 1001 },
      { method: 'cash', amountCents: 1001 },
      { method: 'gift_card', amountCents: 1001 },
      { method: 'cash', amountCents: 996 },
    ]
    expect(tenderBalanceCents(5000, legs)).toBe(0)
  })

  it('returns a negative balance on over-tender rather than clamping', () => {
    expect(tenderBalanceCents(5000, [{ method: 'cash', amountCents: 6000 }])).toBe(-1000)
  })

  it('rejects a negative leg amount', () => {
    expect(() => tenderBalanceCents(5000, [{ method: 'cash', amountCents: -1 }])).toThrow()
  })

  it('rejects a fractional leg amount', () => {
    expect(() => tenderBalanceCents(5000, [{ method: 'cash', amountCents: 10.5 }])).toThrow()
  })
})

describe('changeDueCents', () => {
  it('returns the over-tendered amount', () => {
    expect(changeDueCents(4750, 6000)).toBe(1250)
  })

  it('returns zero on exact tender', () => {
    expect(changeDueCents(4750, 4750)).toBe(0)
  })

  it('returns zero on under-tender — change is never negative', () => {
    expect(changeDueCents(4750, 2000)).toBe(0)
  })
})
