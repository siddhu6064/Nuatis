export interface CartModifier {
  optionId: string
  name: string
  priceDeltaCents: number
}

export interface CartLine {
  menuItemId: string
  name: string
  unitPriceCents: number
  quantity: number
  taxable: boolean
  modifiers: CartModifier[]
}

export interface CartTotals {
  subtotalCents: number
  taxCents: number
  tipCents: number
  totalCents: number
}

export function lineTotalCents(line: CartLine): number {
  if (!Number.isInteger(line.quantity) || line.quantity < 0) {
    throw new Error(`lineTotalCents: quantity must be a non-negative integer, got ${line.quantity}`)
  }
  const modifierDelta = line.modifiers.reduce((sum, m) => sum + m.priceDeltaCents, 0)
  return (line.unitPriceCents + modifierDelta) * line.quantity
}

/**
 * Tax is computed once on the summed taxable base rather than per line, so a
 * cart rounds a single time. Rounding each line independently drifts by up to
 * a cent per line against what the customer expects from the printed subtotal.
 *
 * `taxRateBps` is basis points: 875 = 8.75%.
 * The tip is added to the total but never enters the tax base — and it must
 * likewise be excluded from the Stripe Connect application-fee basis upstream.
 */
export function cartTotals(lines: CartLine[], taxRateBps: number, tipCents: number): CartTotals {
  if (tipCents < 0) throw new Error('cartTotals: tipCents must not be negative')
  if (taxRateBps < 0) throw new Error('cartTotals: taxRateBps must not be negative')

  let subtotalCents = 0
  let taxableBaseCents = 0
  for (const line of lines) {
    const total = lineTotalCents(line)
    subtotalCents += total
    if (line.taxable) taxableBaseCents += total
  }

  const taxCents = Math.round((taxableBaseCents * taxRateBps) / 10000)

  return {
    subtotalCents,
    taxCents,
    tipCents,
    totalCents: subtotalCents + taxCents + tipCents,
  }
}
