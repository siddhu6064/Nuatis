export type TenderMethod = 'cash' | 'card' | 'gift_card'

export interface TenderLeg {
  method: TenderMethod
  amountCents: number
}

/**
 * Remaining balance after the supplied legs. Negative means over-tender (cash
 * back is owed); the caller decides what to do about it rather than having the
 * sign clamped away here.
 */
export function tenderBalanceCents(totalCents: number, legs: TenderLeg[]): number {
  let paid = 0
  for (const leg of legs) {
    if (!Number.isInteger(leg.amountCents) || leg.amountCents < 0) {
      throw new Error(
        `tenderBalanceCents: leg amountCents must be a non-negative integer, got ${leg.amountCents}`
      )
    }
    paid += leg.amountCents
  }
  return totalCents - paid
}

export function changeDueCents(amountDueCents: number, tenderedCents: number): number {
  return Math.max(0, tenderedCents - amountDueCents)
}
