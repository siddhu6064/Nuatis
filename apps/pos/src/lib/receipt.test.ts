import { buildReceipt, formatReceiptText, RECEIPT_WIDTH, type ReceiptInput } from './receipt'
import type { CartLine } from '@nuatis/pos-core'

function line(over: Partial<CartLine> = {}): CartLine {
  return {
    menuItemId: 'item-1',
    name: 'Classic Burger',
    unitPriceCents: 1200,
    quantity: 1,
    taxable: true,
    modifiers: [],
    ...over,
  }
}

function input(over: Partial<ReceiptInput> = {}): ReceiptInput {
  return {
    businessName: 'Nuatis Grill',
    locationName: 'Main Street',
    orderNumber: 'ORD-1042',
    cashierName: 'Sam',
    soldAt: new Date('2026-10-05T19:30:00Z'),
    lines: [line()],
    totals: { subtotalCents: 1200, taxCents: 105, tipCents: 200, totalCents: 1505 },
    legs: [{ method: 'cash', amountCents: 2000 }],
    changeDueCents: 495,
    ...over,
  }
}

describe('buildReceipt', () => {
  it('prices each line including its modifiers and quantity', () => {
    const receipt = buildReceipt(
      input({
        lines: [
          line({
            quantity: 2,
            modifiers: [
              { optionId: 'o1', name: 'Cheddar', priceDeltaCents: 100 },
              { optionId: 'o2', name: 'Bacon', priceDeltaCents: 150 },
            ],
          }),
        ],
      })
    )

    expect(receipt.lines).toHaveLength(1)
    // (1200 + 100 + 150) * 2
    expect(receipt.lines[0]!.lineTotalCents).toBe(2900)
    expect(receipt.lines[0]!.modifiers.map((m) => m.name)).toEqual(['Cheddar', 'Bacon'])
  })

  it('carries the totals through without recomputing them', () => {
    // The register already computed these with cartTotals; a second,
    // independent computation here is how a receipt comes to disagree with the
    // card the customer was charged on.
    const receipt = buildReceipt(input())

    expect(receipt.subtotalCents).toBe(1200)
    expect(receipt.taxCents).toBe(105)
    expect(receipt.tipCents).toBe(200)
    expect(receipt.totalCents).toBe(1505)
  })

  it('records every tender leg so a split sale shows both payments', () => {
    const receipt = buildReceipt(
      input({
        legs: [
          { method: 'card', amountCents: 1000 },
          { method: 'cash', amountCents: 600 },
        ],
        changeDueCents: 95,
      })
    )

    expect(receipt.tenders).toEqual([
      { method: 'card', amountCents: 1000 },
      { method: 'cash', amountCents: 600 },
    ])
    expect(receipt.changeDueCents).toBe(95)
  })

  it('falls back to placeholders when the business or cashier name is missing', () => {
    const receipt = buildReceipt(
      input({ businessName: null, locationName: null, cashierName: null })
    )

    expect(receipt.businessName).toBe('Receipt')
    expect(receipt.locationName).toBeNull()
    expect(receipt.cashierName).toBeNull()
  })
})

describe('formatReceiptText', () => {
  it('fits every line within the printable width', () => {
    const text = formatReceiptText(
      buildReceipt(
        input({
          lines: [
            line({
              name: 'The Extremely Long Sandwich Name That Will Not Fit',
              quantity: 3,
              modifiers: [
                { optionId: 'o1', name: 'Extra pickles, double sauce', priceDeltaCents: 75 },
              ],
            }),
          ],
        })
      )
    )

    for (const l of text.split('\n')) {
      expect(l.length).toBeLessThanOrEqual(RECEIPT_WIDTH)
    }
  })

  it('shows item quantity, name and money for each line', () => {
    const text = formatReceiptText(buildReceipt(input({ lines: [line({ quantity: 2 })] })))

    expect(text).toContain('2x Classic Burger')
    expect(text).toContain('24.00')
  })

  it('prints a modifier under its item with the price delta', () => {
    const text = formatReceiptText(
      buildReceipt(
        input({
          lines: [line({ modifiers: [{ optionId: 'o1', name: 'Cheddar', priceDeltaCents: 100 }] })],
        })
      )
    )

    expect(text).toMatch(/\+ Cheddar/)
    expect(text).toContain('1.00')
  })

  it('omits the modifier price when the option is free', () => {
    const text = formatReceiptText(
      buildReceipt(
        input({
          lines: [
            line({ modifiers: [{ optionId: 'o1', name: 'Medium rare', priceDeltaCents: 0 }] }),
          ],
        })
      )
    )

    expect(text).toMatch(/\+ Medium rare$/m)
  })

  it('shows subtotal, tax, tip and total', () => {
    const text = formatReceiptText(buildReceipt(input()))

    expect(text).toMatch(/Subtotal\s+12\.00/)
    expect(text).toMatch(/Tax\s+1\.05/)
    expect(text).toMatch(/Tip\s+2\.00/)
    expect(text).toMatch(/TOTAL\s+15\.05/)
  })

  it('omits the tip line entirely when no tip was left', () => {
    const text = formatReceiptText(
      buildReceipt(
        input({ totals: { subtotalCents: 1200, taxCents: 105, tipCents: 0, totalCents: 1305 } })
      )
    )

    expect(text).not.toMatch(/Tip/)
  })

  it('names each tender method in words a customer recognises', () => {
    const text = formatReceiptText(
      buildReceipt(
        input({
          legs: [
            { method: 'card', amountCents: 1000 },
            { method: 'gift_card', amountCents: 505 },
          ],
          changeDueCents: 0,
        })
      )
    )

    expect(text).toContain('Card')
    expect(text).toContain('Gift card')
    expect(text).not.toContain('gift_card')
  })

  it('shows change due only when there is change', () => {
    expect(formatReceiptText(buildReceipt(input({ changeDueCents: 495 })))).toMatch(
      /Change\s+4\.95/
    )
    expect(formatReceiptText(buildReceipt(input({ changeDueCents: 0 })))).not.toMatch(/Change/)
  })

  it('shows the order number and the cashier', () => {
    const text = formatReceiptText(buildReceipt(input()))

    expect(text).toContain('ORD-1042')
    expect(text).toContain('Sam')
  })

  it('leaves the cashier line out when nobody is named', () => {
    const text = formatReceiptText(buildReceipt(input({ cashierName: null })))

    expect(text).not.toMatch(/Served by/)
  })
})
