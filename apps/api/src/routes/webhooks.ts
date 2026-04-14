import { Router, type Request, type Response } from 'express'
import { randomUUID } from 'crypto'
import { createClient } from '@supabase/supabase-js'
import { requireAuth, type AuthenticatedRequest } from '../lib/auth.js'

const router = Router()

function getSupabase() {
  const url = process.env['SUPABASE_URL']
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY']
  if (!url || !key) throw new Error('Supabase env vars not set')
  return createClient(url, key)
}

const ALLOWED_EVENT_TYPES = [
  'call.completed',
  'appointment.booked',
  'appointment.no_show',
  'contact.created',
  'follow_up.sent',
]

const URL_REGEX = /^https?:\/\/.+/

// ── POST /api/webhooks — create subscription ─────────────────────────────────
router.post('/', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getSupabase()
  const body = req.body as Record<string, unknown>

  const url = typeof body['url'] === 'string' ? body['url'] : ''
  const eventTypes = Array.isArray(body['event_types']) ? (body['event_types'] as string[]) : []

  if (!URL_REGEX.test(url)) {
    res.status(400).json({ error: 'Invalid URL format' })
    return
  }

  const invalid = eventTypes.filter((e) => !ALLOWED_EVENT_TYPES.includes(e))
  if (invalid.length > 0) {
    res.status(400).json({ error: `Invalid event types: ${invalid.join(', ')}` })
    return
  }

  if (eventTypes.length === 0) {
    res.status(400).json({ error: 'At least one event_type is required' })
    return
  }

  const secret = randomUUID()

  try {
    const { data, error } = await supabase
      .from('webhook_subscriptions')
      .insert({
        tenant_id: authed.tenantId,
        url,
        event_types: eventTypes,
        secret,
      })
      .select('id, url, event_types, secret')
      .single()

    if (error) {
      console.error(`[webhooks] create error: ${error.message}`)
      res.status(500).json({ error: 'Failed to create webhook subscription' })
      return
    }

    res.status(201).json(data)
  } catch (err) {
    console.error('[webhooks] create error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// ── GET /api/webhooks — list subscriptions ───────────────────────────────────
router.get('/', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getSupabase()

  try {
    const { data, error } = await supabase
      .from('webhook_subscriptions')
      .select('id, url, event_types, is_active, created_at')
      .eq('tenant_id', authed.tenantId)
      .order('created_at', { ascending: false })

    if (error) {
      console.error(`[webhooks] list error: ${error.message}`)
      res.status(500).json({ error: 'Failed to fetch webhook subscriptions' })
      return
    }

    res.json({ subscriptions: data ?? [] })
  } catch (err) {
    console.error('[webhooks] list error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// ── DELETE /api/webhooks/:id — deactivate subscription ───────────────────────
router.delete('/:id', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getSupabase()
  const subId = req.params['id']

  try {
    const { error } = await supabase
      .from('webhook_subscriptions')
      .update({ is_active: false })
      .eq('id', subId)
      .eq('tenant_id', authed.tenantId)

    if (error) {
      console.error(`[webhooks] delete error: ${error.message}`)
      res.status(500).json({ error: 'Failed to deactivate webhook' })
      return
    }

    res.json({ deactivated: true })
  } catch (err) {
    console.error('[webhooks] delete error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

export default router
