import { Router, type Request, type Response } from 'express'
import { createClient } from '@supabase/supabase-js'
import { requireAuth, type AuthenticatedRequest } from '../lib/auth.js'

const router = Router()

const EVENT_KEYS = [
  'new_contact',
  'appointment_booked',
  'appointment_completed',
  'quote_viewed',
  'quote_accepted',
  'deposit_paid',
  'new_sms',
  'task_due',
  'review_sent',
  'form_submitted',
  'low_lead_score',
  'contact_assigned',
] as const

type EventKey = (typeof EVENT_KEYS)[number]

interface ChannelPrefs {
  push: boolean
  sms: boolean
  email: boolean
}

type NotificationPrefs = Record<EventKey, ChannelPrefs>

const DEFAULT_PREFS: NotificationPrefs = {
  new_contact: { push: true, sms: false, email: false },
  appointment_booked: { push: true, sms: false, email: true },
  appointment_completed: { push: false, sms: false, email: false },
  quote_viewed: { push: true, sms: false, email: true },
  quote_accepted: { push: true, sms: false, email: true },
  deposit_paid: { push: true, sms: false, email: true },
  new_sms: { push: true, sms: false, email: false },
  task_due: { push: true, sms: false, email: false },
  review_sent: { push: false, sms: false, email: false },
  form_submitted: { push: true, sms: false, email: false },
  low_lead_score: { push: true, sms: false, email: false },
  contact_assigned: { push: true, sms: false, email: false },
}

function getSupabase() {
  const url = process.env['SUPABASE_URL']
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY']
  if (!url || !key) throw new Error('Supabase env vars not set')
  return createClient(url, key)
}

function isChannelPrefs(val: unknown): val is ChannelPrefs {
  if (!val || typeof val !== 'object') return false
  const v = val as Record<string, unknown>
  return (
    typeof v['push'] === 'boolean' &&
    typeof v['sms'] === 'boolean' &&
    typeof v['email'] === 'boolean'
  )
}

function isValidPrefs(body: unknown): body is NotificationPrefs {
  if (!body || typeof body !== 'object') return false
  const b = body as Record<string, unknown>
  for (const key of EVENT_KEYS) {
    if (!isChannelPrefs(b[key])) return false
  }
  return true
}

// ── GET /api/settings/notifications ─────────────────────────────────────────
router.get('/', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getSupabase()

  const { data: tenant, error } = await supabase
    .from('tenants')
    .select('notification_prefs')
    .eq('id', authed.tenantId)
    .single()

  if (error || !tenant) {
    res.status(404).json({ error: 'Tenant not found' })
    return
  }

  const prefs = tenant.notification_prefs ?? DEFAULT_PREFS
  res.json(prefs)
})

// ── PUT /api/settings/notifications ─────────────────────────────────────────
router.put('/', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getSupabase()
  const body = req.body as unknown

  if (!isValidPrefs(body)) {
    res.status(400).json({
      error:
        'Invalid notification_prefs: must be an object with all event type keys, each having push/sms/email booleans',
    })
    return
  }

  const { error } = await supabase
    .from('tenants')
    .update({ notification_prefs: body })
    .eq('id', authed.tenantId)

  if (error) {
    res.status(500).json({ error: error.message })
    return
  }

  console.info(`[notification-settings] updated for tenant=${authed.tenantId}`)
  res.json(body)
})

export default router
