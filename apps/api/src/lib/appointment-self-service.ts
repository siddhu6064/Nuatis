import type { SupabaseClient } from '@supabase/supabase-js'
import { getServiceClient } from './supabase.js'
import { getTenantCalendarCredentials, isSlotAvailable } from './booking-availability.js'
import { logActivity } from './activity.js'
import { applyLateCancellationFee } from './cancellation-fee.js'

// Shared reschedule/cancel core, used by both the public manage-booking link
// (booking-manage.ts, keyed by an opaque manage_token) and the client portal
// (portal.ts, keyed by a portal session token + contact_id scoping). Neither
// caller's lookup key lives here — each loads its own AppointmentRow and
// passes it in, so this file has no opinion on how the caller authenticated.

export interface SelfServiceAppointment {
  id: string
  tenant_id: string
  contact_id?: string | null
  title: string
  start_time: string
  end_time: string
  status: string
}

export async function minNoticeHours(tenantId: string): Promise<number> {
  const supabase = getServiceClient()
  const { data } = await supabase
    .from('tenants')
    .select('booking_min_notice_hours')
    .eq('id', tenantId)
    .maybeSingle()
  return (data?.booking_min_notice_hours as number | null) ?? 2
}

export function canModifyAppointment(
  appt: Pick<SelfServiceAppointment, 'status' | 'start_time'>,
  noticeHours: number
): boolean {
  if (appt.status === 'canceled' || appt.status === 'completed') return false
  const msUntil = new Date(appt.start_time).getTime() - Date.now()
  return msUntil >= noticeHours * 3600_000
}

export interface RescheduleResult {
  ok: boolean
  error?: string
  status?: number
  data?: { start_time: string; end_time: string; status: string }
}

export async function rescheduleAppointment(
  appt: SelfServiceAppointment,
  date: string,
  startTime: string,
  actorType: 'contact'
): Promise<RescheduleResult> {
  const creds = await getTenantCalendarCredentials(appt.tenant_id)
  if (!creds) return { ok: false, status: 503, error: 'Booking not available' }

  const durationMinutes = Math.round(
    (new Date(appt.end_time).getTime() - new Date(appt.start_time).getTime()) / 60000
  )
  const available = await isSlotAvailable(creds, date, startTime, durationMinutes)
  if (!available) return { ok: false, status: 409, error: 'That time is no longer available' }

  const newStart = new Date(`${date}T${startTime}:00.000Z`)
  const newEnd = new Date(newStart.getTime() + durationMinutes * 60000)

  const supabase = getServiceClient()
  const { data: updated, error } = await supabase
    .from('appointments')
    .update({
      start_time: newStart.toISOString(),
      end_time: newEnd.toISOString(),
      status: 'scheduled',
    })
    .eq('id', appt.id)
    .select('start_time, end_time, status')
    .single()

  if (error || !updated)
    return { ok: false, status: 500, error: error?.message ?? 'Failed to reschedule' }

  void logActivity({
    tenantId: appt.tenant_id,
    contactId: appt.contact_id ?? undefined,
    type: 'appointment',
    body: `Customer self-rescheduled "${appt.title}"`,
    metadata: { appointment_id: appt.id },
    actorType,
  })

  return { ok: true, data: updated as RescheduleResult['data'] }
}

export interface CancelResult {
  ok: boolean
  error?: string
  status?: number
}

export async function cancelAppointment(
  appt: SelfServiceAppointment,
  actorType: 'contact',
  supabaseOverride?: SupabaseClient
): Promise<CancelResult> {
  const supabase = supabaseOverride ?? getServiceClient()
  const { data: updated, error } = await supabase
    .from('appointments')
    .update({ status: 'canceled' })
    .eq('id', appt.id)
    .select('status')
    .single()

  if (error || !updated)
    return { ok: false, status: 500, error: error?.message ?? 'Failed to cancel' }

  void logActivity({
    tenantId: appt.tenant_id,
    contactId: appt.contact_id ?? undefined,
    type: 'appointment',
    body: `Customer self-canceled "${appt.title}"`,
    metadata: { appointment_id: appt.id },
    actorType,
  })

  void applyLateCancellationFee(supabase, {
    tenantId: appt.tenant_id,
    appointmentId: appt.id,
    contactId: appt.contact_id,
    startTime: appt.start_time,
  })

  return { ok: true }
}
