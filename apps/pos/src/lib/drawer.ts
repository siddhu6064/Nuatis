import { toCents, toDollars } from '@nuatis/pos-core'

/**
 * Cash drawer arithmetic and payload shapes, kept pure.
 *
 * The API owns the reconciliation — it sums `cash_events` and computes the
 * variance at close time, in integer cents. This module only prepares what is
 * sent and reads back what came out, and it does both in integer cents for the
 * same reason: a drawer reconciled through floats produces phantom one-cent
 * variances a cashier cannot explain to a manager.
 */

export interface OpenDrawerPayload {
  location_id: string
  /** Dollars, because the API speaks numeric(10,2). */
  opening_float: number
}

export interface CloseDrawerPayload {
  counted_total: number
  notes: string | null
}

export type VarianceTone = 'balanced' | 'over' | 'short'

export interface VarianceDescription {
  tone: VarianceTone
  text: string
}

/** The numeric columns a closed session comes back with, as strings. */
export interface ClosedSessionRow {
  opening_float?: string | null
  expected_total?: string | null
  counted_total?: string | null
  variance?: string | null
}

export interface CloseSummary {
  openingFloatCents: number
  expectedCents: number
  countedCents: number
  varianceCents: number
}

/**
 * Read what a cashier typed as integer cents, or null if it is not a usable
 * amount.
 *
 * Tolerant of `$`, thousands separators and surrounding spaces, because those
 * are what people type at a till and rejecting them teaches a cashier the
 * field is broken. Strict about everything else: a negative drawer count is
 * not a thing, and `12.34.56` is a typo rather than an amount to guess at.
 */
export function parseMoneyInput(text: string): number | null {
  const cleaned = text.replace(/[$,\s]/g, '')
  if (cleaned === '') return null
  // Deliberately not parseFloat: that reads "12.34.56" as 12.34 and "12abc" as
  // 12, turning a typo into a silently wrong drawer count.
  if (!/^\d+(\.\d+)?$/.test(cleaned)) return null

  const value = Number(cleaned)
  if (!Number.isFinite(value) || value < 0) return null

  // toCents, not value * 100 — it carries the half-up rounding fix for values
  // like 8.285, which floats round down and quietly lose a cent.
  return toCents(cleaned)
}

export function openDrawerPayload(
  locationId: string,
  openingFloatCents: number
): OpenDrawerPayload {
  return { location_id: locationId, opening_float: Number(toDollars(openingFloatCents)) }
}

export function closeDrawerPayload(countedCents: number, note: string): CloseDrawerPayload {
  const trimmed = note.trim()
  return {
    counted_total: Number(toDollars(countedCents)),
    notes: trimmed === '' ? null : trimmed,
  }
}

/**
 * The variance in words.
 *
 * A shortfall is stated as a positive amount under the word "Short" rather
 * than as a negative number: "Short by $-2.50" is how a cashier ends up
 * arguing with the screen instead of recounting the till.
 */
export function describeVariance(varianceCents: number): VarianceDescription {
  if (varianceCents === 0) return { tone: 'balanced', text: 'Balanced' }
  if (varianceCents > 0) return { tone: 'over', text: `Over by $${toDollars(varianceCents)}` }
  return { tone: 'short', text: `Short by $${toDollars(-varianceCents)}` }
}

/**
 * Read a closed session's money columns into cents.
 *
 * An absent or unparseable column reads as zero rather than NaN — this ends up
 * on a close-out a manager signs off, and "$NaN" is worse than a zero that is
 * visibly wrong next to the counted total.
 */
export function summariseClose(row: ClosedSessionRow): CloseSummary {
  return {
    openingFloatCents: centsOf(row.opening_float),
    expectedCents: centsOf(row.expected_total),
    countedCents: centsOf(row.counted_total),
    varianceCents: centsOf(row.variance),
  }
}

function centsOf(value: string | null | undefined): number {
  if (typeof value !== 'string' || value.trim() === '') return 0
  const cents = toCents(value)
  return Number.isFinite(cents) ? cents : 0
}
