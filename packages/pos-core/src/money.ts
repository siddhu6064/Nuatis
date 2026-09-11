/**
 * All POS arithmetic is performed in integer cents.
 *
 * The database stores money as numeric(10,2) for consistency with the rest of
 * the schema (orders.balance_due is a generated numeric column), and the
 * Supabase client hands those back as strings. Converting at the boundary and
 * computing in integers avoids the penny-rounding errors that floating-point
 * dollar arithmetic produces — errors that split tender makes immediately
 * visible to a cashier counting a drawer.
 */

export function toCents(dollars: number | string): number {
  const n = typeof dollars === 'string' ? Number(dollars) : dollars
  if (!Number.isFinite(n)) {
    throw new Error(`toCents: not a finite number: ${String(dollars)}`)
  }
  // Math.round is half-UP, which for negatives means half-toward-zero
  // (-0.5 → -0). Taking the sign out first makes it half-away-from-zero in
  // both directions, so a -0.005 refund line rounds to -1 rather than 0.
  const sign = n < 0 ? -1 : 1
  const scaled = Math.abs(n) * 100
  // Multiplying by 100 can land a hair under the true value (8.285 * 100 is
  // 828.4999999999999), which would round down and lose a cent. Nudge by an
  // epsilon proportional to the magnitude before rounding.
  const corrected = scaled + Number.EPSILON * scaled
  return sign * Math.round(corrected)
}

export function toDollars(cents: number): string {
  if (!Number.isInteger(cents)) {
    throw new Error(`toDollars: expected integer cents, got ${cents}`)
  }
  const sign = cents < 0 ? '-' : ''
  const abs = Math.abs(cents)
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`
}
