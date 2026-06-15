export function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
}

export function formatTime(hhmm: string): string {
  const [hStr, mStr] = hhmm.split(':')
  const h = parseInt(hStr ?? '0', 10)
  const m = parseInt(mStr ?? '0', 10)
  const ampm = h >= 12 ? 'PM' : 'AM'
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h
  return `${h12}:${String(m).padStart(2, '0')} ${ampm}`
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/**
 * Extracts the first name from a full_name string.
 * Trims input, then splits on the first space; returns the whole (trimmed)
 * string when no space is present. Returns the fallback when fullName is
 * null, undefined, empty, or whitespace-only.
 *
 * @param fullName - The full name string (from contacts.full_name column)
 * @param fallback - Returned when fullName is falsy/blank. Defaults to 'there'.
 */
export function getFirstName(fullName: string | null | undefined, fallback = 'there'): string {
  if (!fullName?.trim()) return fallback
  return fullName.trim().split(' ')[0] ?? fallback
}

/**
 * Formats a numeric amount as a currency string with 2 decimal places.
 * Output: "$1,234.56" (comma thousands separator, standard sign placement).
 *
 * @param amount - The numeric value to format (dollars, not cents).
 * @param currency - ISO 4217 currency code. Defaults to 'USD'.
 * @param locale - BCP 47 locale string. Defaults to 'en-US'.
 */
export function formatCurrency(amount: number, currency = 'USD', locale = 'en-US'): string {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount)
}

/**
 * Formats a numeric amount as a whole-dollar currency string (no decimals).
 * Output: "$1,235" (rounds to nearest whole unit). For compact summary/chart
 * displays where cents are intentionally omitted.
 *
 * @param amount - The numeric value to format (dollars, not cents).
 * @param currency - ISO 4217 currency code. Defaults to 'USD'.
 * @param locale - BCP 47 locale string. Defaults to 'en-US'.
 */
export function formatCurrencyWhole(amount: number, currency = 'USD', locale = 'en-US'): string {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount)
}

/**
 * Resolves the ISO instant for a given wall-clock hour:minute on a calendar date
 * within an IANA timezone. Returns a UTC ISO 8601 string.
 *
 * @param dateStr - Calendar date as "YYYY-MM-DD".
 * @param hour - Wall-clock hour (0-23) in the target timezone.
 * @param minute - Wall-clock minute (0-59) in the target timezone.
 * @param tz - IANA timezone identifier (e.g. "America/Chicago").
 */
export function dateAtHour(dateStr: string, hour: number, minute: number, tz: string): string {
  // Start with an UTC guess treating the local wall-clock time as if it were UTC
  const utcGuess = new Date(
    `${dateStr}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00Z`
  )
  // Find what local time that UTC instant maps to in `tz`
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
  const parts = formatter.formatToParts(utcGuess)
  const getPart = (t: string) => parts.find((p) => p.type === t)?.value ?? '0'
  const localHour = parseInt(getPart('hour'), 10)
  const localMinute = parseInt(getPart('minute'), 10)
  // offsetMinutes = local - utc (so we can back-solve for the correct UTC instant)
  const offsetMinutes =
    localHour * 60 + localMinute - (utcGuess.getUTCHours() * 60 + utcGuess.getUTCMinutes())
  return new Date(utcGuess.getTime() - offsetMinutes * 60_000).toISOString()
}

/**
 * Formats a Date as "HH:MM" (24-hour, zero-padded) in the given IANA timezone.
 *
 * @param d - The Date to format.
 * @param tz - IANA timezone identifier (e.g. "America/Chicago").
 */
export function formatHHMM(d: Date, tz: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(d)
  const h = parts.find((p) => p.type === 'hour')?.value ?? '00'
  const m = parts.find((p) => p.type === 'minute')?.value ?? '00'
  return `${h}:${m}`
}
