import type { SupabaseClient } from '@supabase/supabase-js'
import { dateAtHour } from '../utils/index.js'

const DEFAULT_TIMEZONE = 'America/Chicago'

/**
 * Formats a UTC timestamp as a tenant-local, speech-friendly time string,
 * e.g. "12:00 PM" — never the raw 24-hour UTC value ("17:00").
 *
 * @param isoOrDate - UTC timestamp (ISO string or Date), e.g. an
 *   appointments.start_time value read straight from Postgres.
 * @param timezone - IANA timezone identifier (e.g. "America/Chicago").
 */
export function toTenantLocal(isoOrDate: string | Date, timezone: string): string {
  const d = typeof isoOrDate === 'string' ? new Date(isoOrDate) : isoOrDate
  return d.toLocaleString('en-US', {
    timeZone: timezone,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
}

/**
 * Returns the UTC instants for midnight-to-midnight in `timezone` on the
 * calendar day of `referenceDate`. Delegates to dateAtHour's DST-safe
 * offset-solve (same helper already used for booking slots) instead of
 * subtracting a fixed offset, so the boundary lands correctly even on a
 * day that crosses a DST transition.
 *
 * @param timezone - IANA timezone identifier.
 * @param referenceDate - Instant identifying "today" in `timezone`. Defaults to now.
 */
export function tenantDayBoundsUTC(
  timezone: string,
  referenceDate: Date = new Date()
): { startUTC: string; endUTC: string } {
  // en-CA gives YYYY-MM-DD — the tenant-local calendar date for referenceDate.
  const dateStr = new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(referenceDate)
  const nextDateStr = new Date(new Date(`${dateStr}T00:00:00Z`).getTime() + 86_400_000)
    .toISOString()
    .slice(0, 10)

  return {
    startUTC: dateAtHour(dateStr, 0, 0, timezone),
    endUTC: dateAtHour(nextDateStr, 0, 0, timezone),
  }
}

/**
 * Resolves a tenant's IANA timezone: the given location's timezone (or the
 * tenant's primary location, if no locationId is given) → the tenant's own
 * timezone column → 'America/Chicago'.
 *
 * Two timezone columns exist in the schema today: locations.timezone
 * (added later, per-location) and tenants.timezone (the original day-1
 * column, still read directly by post-call.ts's SMS/email confirmations).
 * Unifying them onto one column is a separate future cleanup, not this batch.
 */
export async function resolveTenantTimezone(
  supabase: SupabaseClient,
  tenantId: string,
  locationId?: string | null
): Promise<string> {
  try {
    let locationQuery = supabase.from('locations').select('timezone').eq('tenant_id', tenantId)
    locationQuery = locationId
      ? locationQuery.eq('id', locationId)
      : locationQuery.eq('is_primary', true)
    const { data: locationRow } = await locationQuery.maybeSingle()
    const locationTz = (locationRow as { timezone?: string | null } | null)?.timezone
    if (locationTz) return locationTz

    const { data: tenantRow } = await supabase
      .from('tenants')
      .select('timezone')
      .eq('id', tenantId)
      .maybeSingle()
    const tenantTz = (tenantRow as { timezone?: string | null } | null)?.timezone
    if (tenantTz) return tenantTz
  } catch (err) {
    console.warn('[timezone] resolveTenantTimezone lookup failed, using default:', err)
  }
  return DEFAULT_TIMEZONE
}
