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

/**
 * The money columns a closed session comes back with.
 *
 * Typed `string | number` because that is what actually arrives: the columns
 * are `numeric(10,2)`, which Postgres renders as a string, but supabase-js
 * hands them to JavaScript as numbers. Typing them as strings alone is what
 * made the close-out render $0.00 across the board and call the till
 * "Balanced".
 */
export interface ClosedSessionRow {
  opening_float?: string | number | null
  expected_total?: string | number | null
  counted_total?: string | number | null
  variance?: string | number | null
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
 * visibly wrong next to the counted total. Pair it with `isCloseReadable`:
 * zeros alone are indistinguishable from a genuinely empty till, and a
 * close-out that silently reports "Balanced" because it could not read the
 * response is the one failure mode worth refusing outright.
 */
export function summariseClose(row: ClosedSessionRow): CloseSummary {
  return {
    openingFloatCents: centsOf(row.opening_float),
    expectedCents: centsOf(row.expected_total),
    countedCents: centsOf(row.counted_total),
    varianceCents: centsOf(row.variance),
  }
}

/**
 * Whether the server actually reported a variance.
 *
 * The variance is the field the whole screen turns on, so it is the one worth
 * checking. Without it the three zeros below are not a balanced till — they
 * are a close-out nobody can read, and saying so is the honest answer.
 */
export function isCloseReadable(row: ClosedSessionRow): boolean {
  const value = row.variance
  if (typeof value === 'number') return Number.isFinite(value)
  return typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))
}

function centsOf(value: string | number | null | undefined): number {
  if (value === null || value === undefined) return 0
  const text = String(value).trim()
  if (text === '' || !Number.isFinite(Number(text))) return 0
  const cents = toCents(text)
  return Number.isFinite(cents) ? cents : 0
}
