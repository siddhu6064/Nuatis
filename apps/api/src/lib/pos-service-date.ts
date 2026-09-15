/**
 * The business day a POS ticket belongs to, in the tenant's timezone.
 *
 * Kitchen ticket numbers restart per location per service day. Deriving that
 * day from UTC would reset the sequence at 7-8pm US Eastern — in the middle of
 * dinner service — so the day is always computed in the tenant's own zone and
 * stored explicitly on the row.
 *
 * Uses Intl with an explicit timeZone, matching how the voice handler resolves
 * tenant-local time (voice/telnyx-handler.ts).
 */
export function serviceDateFor(timezone: string, now: Date = new Date()): string {
  try {
    // en-CA formats as YYYY-MM-DD, which is the shape Postgres `date` wants.
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(now)
  } catch {
    // An unknown or malformed zone must not take the register down; fall back
    // to UTC and accept a possibly-wrong day rather than failing the sale.
    return now.toISOString().slice(0, 10)
  }
}
