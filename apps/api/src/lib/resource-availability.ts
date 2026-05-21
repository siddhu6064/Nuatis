import { createClient } from '@supabase/supabase-js'
import type { ResourceAvailabilitySlot } from '@nuatis/shared'

function getSupabase() {
  const url = process.env['SUPABASE_URL']
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY']
  if (!url || !key) throw new Error('Supabase env vars not set')
  return createClient(url, key)
}

/**
 * Returns true if the resource has no confirmed bookings overlapping [startTime, endTime).
 * Overlap condition: existing.start_time < endTime AND existing.end_time > startTime
 */
export async function checkResourceAvailable(params: {
  resourceId: string
  startTime: Date
  endTime: Date
  excludeBookingId?: string
}): Promise<boolean> {
  const { resourceId, startTime, endTime, excludeBookingId } = params
  const supabase = getSupabase()

  let query = supabase
    .from('resource_bookings')
    .select('id')
    .eq('resource_id', resourceId)
    .neq('status', 'cancelled')
    .lt('start_time', endTime.toISOString())
    .gt('end_time', startTime.toISOString())

  if (excludeBookingId) {
    query = query.neq('id', excludeBookingId)
  }

  const { data, error } = await query.limit(1).maybeSingle()

  if (error) {
    console.error('[checkResourceAvailable] DB error:', error)
    throw error
  }

  return data === null
}

/**
 * For each resourceId, returns all confirmed/completed bookings on the given date (YYYY-MM-DD).
 * Uses UTC date boundaries: date 00:00:00Z to date+1 00:00:00Z.
 */
export async function getResourceAvailability(params: {
  tenantId: string
  resourceIds: string[]
  date: string // YYYY-MM-DD
}): Promise<ResourceAvailabilitySlot[]> {
  const { tenantId, resourceIds, date } = params

  if (resourceIds.length === 0) return []

  const dayStart = new Date(`${date}T00:00:00.000Z`)
  const dayEnd = new Date(dayStart)
  dayEnd.setUTCDate(dayEnd.getUTCDate() + 1)

  const supabase = getSupabase()

  const { data, error } = await supabase
    .from('resource_bookings')
    .select('resource_id, start_time, end_time, appointment_id')
    .eq('tenant_id', tenantId)
    .in('resource_id', resourceIds)
    .neq('status', 'cancelled')
    .gte('start_time', dayStart.toISOString())
    .lt('start_time', dayEnd.toISOString())
    .order('start_time', { ascending: true })

  if (error) {
    console.error('[getResourceAvailability] DB error:', error)
    return resourceIds.map((id) => ({ resource_id: id, booked_slots: [] }))
  }

  const grouped = new Map<string, ResourceAvailabilitySlot>()

  for (const id of resourceIds) {
    grouped.set(id, { resource_id: id, booked_slots: [] })
  }

  for (const row of data ?? []) {
    const slot = grouped.get(row.resource_id)
    if (slot) {
      slot.booked_slots.push({
        start_time: row.start_time,
        end_time: row.end_time,
        appointment_id: row.appointment_id ?? null,
      })
    }
  }

  return Array.from(grouped.values())
}
