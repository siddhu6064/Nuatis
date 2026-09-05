import { Router, type Request, type Response } from 'express'
import { randomUUID } from 'crypto'
import { getServiceClient } from '../lib/supabase.js'
import { type AuthenticatedRequest } from '../lib/auth.js'
import { requireAuthOrApiKey } from '../lib/api-key-auth.js'
import { WEBHOOK_EVENT_TYPES } from '../lib/webhook-dispatcher.js'

const router = Router()

const URL_REGEX = /^https?:\/\/.+/

// ── GET /api/webhooks/event-types — list subscribable events ─────────────────
router.get('/event-types', requireAuthOrApiKey, (_req: Request, res: Response): void => {
  res.json({ event_types: WEBHOOK_EVENT_TYPES })
})

// ── POST /api/webhooks — create subscription ─────────────────────────────────
router.post('/', requireAuthOrApiKey, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getServiceClient()
  const body = req.body as Record<string, unknown>

  const url = typeof body['url'] === 'string' ? body['url'] : ''
  const eventTypes = Array.isArray(body['event_types']) ? (body['event_types'] as string[]) : []

  if (!URL_REGEX.test(url)) {
    res.status(400).json({ error: 'Invalid URL format' })
    return
  }

  const invalid = eventTypes.filter((e) => !(WEBHOOK_EVENT_TYPES as readonly string[]).includes(e))
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
router.get('/', requireAuthOrApiKey, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getServiceClient()

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

// ── GET /api/webhooks/:id/deliveries — recent delivery log ───────────────────
router.get(
  '/:id/deliveries',
  requireAuthOrApiKey,
  async (req: Request, res: Response): Promise<void> => {
    const authed = req as AuthenticatedRequest
    const supabase = getServiceClient()
    const subId = req.params['id']

    try {
      // Confirm the subscription belongs to this tenant before returning
      // anything — the deliveries table alone doesn't guarantee that (a
      // stale/forged subscription_id from another tenant should 404, not leak
      // a row count of zero silently).
      const { data: sub } = await supabase
        .from('webhook_subscriptions')
        .select('id')
        .eq('id', subId)
        .eq('tenant_id', authed.tenantId)
        .maybeSingle()

      if (!sub) {
        res.status(404).json({ error: 'Webhook subscription not found' })
        return
      }

      const { data, error } = await supabase
        .from('webhook_deliveries')
        .select(
          'id, event_type, status, attempt_count, last_attempted_at, response_status, error_message, created_at'
        )
        .eq('subscription_id', subId)
        .order('created_at', { ascending: false })
        .limit(50)

      if (error) {
        console.error(`[webhooks] deliveries list error: ${error.message}`)
        res.status(500).json({ error: 'Failed to fetch delivery log' })
        return
      }

      res.json({ deliveries: data ?? [] })
    } catch (err) {
      console.error('[webhooks] deliveries list error:', err)
      res.status(500).json({ error: 'Internal server error' })
    }
  }
)

// ── DELETE /api/webhooks/:id — deactivate subscription ───────────────────────
router.delete('/:id', requireAuthOrApiKey, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getServiceClient()
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
