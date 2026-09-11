import { describe, it, expect } from '@jest/globals'
import { lineTotalCents, cartTotals, type CartLine } from './cart.js'

function line(overrides: Partial<CartLine> = {}): CartLine {
  return {
    menuItemId: 'item-1',
    name: 'Burger',
    unitPriceCents: 1200,
    quantity: 1,
    taxable: true,
    modifiers: [],
    ...overrides,
  }
}

describe('lineTotalCents', () => {
  it('multiplies unit price by quantity', () => {
    expect(lineTotalCents(line({ quantity: 3 }))).toBe(3600)
  })

  it('adds modifier deltas before multiplying by quantity', () => {
    const withCheese = line({
      quantity: 2,
      modifiers: [{ optionId: 'opt-1', name: 'Cheese', priceDeltaCents: 150 }],
    })
    expect(lineTotalCents(withCheese)).toBe((1200 + 150) * 2)
  })

  it('supports a negative modifier delta', () => {
    const noBun = line({
      modifiers: [{ optionId: 'opt-2', name: 'No bun', priceDeltaCents: -100 }],
    })
    expect(lineTotalCents(noBun)).toBe(1100)
  })

  it('sums multiple modifiers', () => {
    const loaded = line({
      modifiers: [
        { optionId: 'o1', name: 'Cheese', priceDeltaCents: 150 },
        { optionId: 'o2', name: 'Bacon', priceDeltaCents: 250 },
      ],
    })
    expect(lineTotalCents(loaded)).toBe(1600)
  })

  it('rejects a fractional quantity — cents arithmetic assumes integers', () => {
    expect(() => lineTotalCents(line({ quantity: 1.5 }))).toThrow()
  })

  it('rejects a negative quantity', () => {
    expect(() => lineTotalCents(line({ quantity: -1 }))).toThrow()
  })
})

describe('cartTotals', () => {
  it('returns zeros for an empty cart', () => {
    expect(cartTotals([], 875, 0)).toEqual({
      subtotalCents: 0,
      taxCents: 0,
      tipCents: 0,
      totalCents: 0,
    })
  })

  it('taxes only taxable lines', () => {
    const lines = [
      line({ unitPriceCents: 1000, taxable: true }),
      line({ menuItemId: 'item-2', name: 'Gift card', unitPriceCents: 2000, taxable: false }),
    ]
    // taxable base 1000 cents at 8.75% = 87.5 → 88 (half away from zero)
    const totals = cartTotals(lines, 875, 0)
    expect(totals.subtotalCents).toBe(3000)
    expect(totals.taxCents).toBe(88)
    expect(totals.totalCents).toBe(3088)
  })

  it('adds the tip to the total but never to the tax base', () => {
    const totals = cartTotals([line({ unitPriceCents: 1000 })], 1000, 500)
    expect(totals.taxCents).toBe(100)
    expect(totals.tipCents).toBe(500)
    expect(totals.totalCents).toBe(1000 + 100 + 500)
  })

  it('computes tax on the summed base, not per line, so rounding happens once', () => {
    // Three lines of 3.33 each: per-line 10% rounding would give 33+33+33=99,
    // but the correct single-rounding answer on 9.99 is 100.
    const lines = [
      line({ unitPriceCents: 333 }),
      line({ menuItemId: 'i2', unitPriceCents: 333 }),
      line({ menuItemId: 'i3', unitPriceCents: 333 }),
    ]
    expect(cartTotals(lines, 1000, 0).taxCents).toBe(100)
  })

  it('applies zero tax at a zero rate', () => {
    expect(cartTotals([line({ unitPriceCents: 1000 })], 0, 0).taxCents).toBe(0)
  })

  it('returns an integer number of cents for tax', () => {
    const totals = cartTotals([line({ unitPriceCents: 1333 })], 825, 0)
    expect(Number.isInteger(totals.taxCents)).toBe(true)
  })

  it('rejects a negative tip', () => {
    expect(() => cartTotals([], 0, -1)).toThrow()
  })

  it('rejects a negative tax rate', () => {
    expect(() => cartTotals([], -1, 0)).toThrow()
  })
})
