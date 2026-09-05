/**
 * Public self-service reschedule/cancel — reached via the opaque
 * `manage_token` link sent in the booking confirmation SMS (booking-public.ts).
 * No auth: the token itself is the credential, same trust model as a
 * calendar-invite link. Mirrors the staff-side reschedule logic in
 * appointments.ts's PATCH /:id, minus auth, plus a minimum-notice window.
 */
import { Router, type Request, type Response } from 'express'
import { getServiceClient } from '../lib/supabase.js'
import {
  getTenantCalendarCredentials,
  getAvailableSlotsForDate,
} from '../lib/booking-availability.js'
import { bookingLimiter } from '../middleware/rate-limit.js'
import {
  type SelfServiceAppointment,
  minNoticeHours,
  canModifyAppointment,
  rescheduleAppointment,
  cancelAppointment,
} from '../lib/appointment-self-service.js'

const router = Router()
router.use(bookingLimiter)

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const TIME_RE = /^\d{2}:\d{2}$/

async function loadAppointment(token: string): Promise<SelfServiceAppointment | null> {
  const supabase = getServiceClient()
  const { data } = await supabase
    .from('appointments')
    .select('id, tenant_id, contact_id, title, start_time, end_time, status')
    .eq('manage_token', token)
    .maybeSingle()
  return (data as SelfServiceAppointment | null) ?? null
}

// ── GET /api/booking-manage/:token ───────────────────────────────────────────
router.get('/:token', async (req: Request, res: Response): Promise<void> => {
  const appt = await loadAppointment(req.params['token'] as string)
  if (!appt) {
    res.status(404).json({ error: 'Not found' })
    return
  }
  const noticeHours = await minNoticeHours(appt.tenant_id)

  const supabase = getServiceClient()
  const { data: tenant } = await supabase
    .from('tenants')
    .select('name')
    .eq('id', appt.tenant_id)
    .maybeSingle()

  res.json({
    title: appt.title,
    start_time: appt.start_time,
    end_time: appt.end_time,
    status: appt.status,
    business_name: (tenant?.name as string | undefined) ?? null,
    min_notice_hours: noticeHours,
    can_modify: canModifyAppointment(appt, noticeHours),
  })
})

// ── GET /api/booking-manage/:token/available-slots?date= ────────────────────
router.get('/:token/available-slots', async (req: Request, res: Response): Promise<void> => {
  const appt = await loadAppointment(req.params['token'] as string)
  if (!appt) {
    res.status(404).json({ error: 'Not found' })
    return
  }
  const date = typeof req.query['date'] === 'string' ? req.query['date'] : ''
  if (!DATE_RE.test(date)) {
    res.status(400).json({ error: 'date must be YYYY-MM-DD' })
    return
  }

  const creds = await getTenantCalendarCredentials(appt.tenant_id)
  if (!creds) {
    res.status(503).json({ error: 'Booking not available' })
    return
  }

  const durationMinutes = Math.round(
    (new Date(appt.end_time).getTime() - new Date(appt.start_time).getTime()) / 60000
  )

  // Same-day reschedule may under-offer: the appointment's own current slot
  // reads as busy against itself (the busy-period query has no "exclude this
  // appointment" concept). Deliberate — safer to under-offer than risk a
  // double-book via a flawed self-exclusion.
  const { slots, closed } = await getAvailableSlotsForDate(creds, date, durationMinutes)
  res.json({ slots, closed })
})

// ── POST /api/booking-manage/:token/reschedule ───────────────────────────────
router.post('/:token/reschedule', async (req: Request, res: Response): Promise<void> => {
  const appt = await loadAppointment(req.params['token'] as string)
  if (!appt) {
    res.status(404).json({ error: 'Not found' })
    return
  }
  const noticeHours = await minNoticeHours(appt.tenant_id)
  if (!canModifyAppointment(appt, noticeHours)) {
    res.status(409).json({
      error: `This appointment can no longer be changed online — it starts in less than ${noticeHours}h, or is already canceled/completed`,
    })
    return
  }

  const b = req.body as Record<string, unknown>
  const date = typeof b['date'] === 'string' ? b['date'] : ''
  const startTime = typeof b['start_time'] === 'string' ? b['start_time'] : ''
  if (!DATE_RE.test(date) || !TIME_RE.test(startTime)) {
    res.status(400).json({ error: 'date (YYYY-MM-DD) and start_time (HH:MM) are required' })
    return
  }

  const result = await rescheduleAppointment(appt, date, startTime, 'contact')
  if (!result.ok) {
    res.status(result.status ?? 500).json({ error: result.error })
    return
  }
  res.json(result.data)
})

// ── POST /api/booking-manage/:token/cancel ───────────────────────────────────
router.post('/:token/cancel', async (req: Request, res: Response): Promise<void> => {
  const appt = await loadAppointment(req.params['token'] as string)
  if (!appt) {
    res.status(404).json({ error: 'Not found' })
    return
  }
  const noticeHours = await minNoticeHours(appt.tenant_id)
  if (!canModifyAppointment(appt, noticeHours)) {
    res.status(409).json({
      error: `This appointment can no longer be canceled online — it starts in less than ${noticeHours}h, or is already canceled/completed`,
    })
    return
  }

  const result = await cancelAppointment(appt, 'contact')
  if (!result.ok) {
    res.status(result.status ?? 500).json({ error: result.error })
    return
  }
  res.json({ success: true })
})

export default router
