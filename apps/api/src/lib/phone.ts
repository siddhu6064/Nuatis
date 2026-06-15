/**
 * Normalizes a raw phone string to E.164-ish form: strips all non-digit
 * characters (except a leading +) and ensures a leading +.
 */
export function normalizePhone(raw: string): string {
  const digits = raw.replace(/[^\d+]/g, '')
  return digits.startsWith('+') ? digits : `+${digits}`
}
