import { Router, type Request, type Response } from 'express'
import { getServiceClient } from '../lib/supabase.js'
import { requireAuth, type AuthenticatedRequest } from '../lib/auth.js'
import { sendPushNotification } from '../lib/push-client.js'

const router = Router()

// ── POST /api/push/subscribe ─────────────────────────────────────────────────
router.post('/subscribe', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const sub = req.body?.subscription as
    | {
        endpoint?: string
        keys?: { p256dh?: string; auth?: string }
      }
    | undefined

  if (!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth) {
    res.status(400).json({ error: 'Invalid push subscription' })
    return
  }

  try {
    const supabase = getServiceClient()
    await supabase.from('push_subscriptions').upsert(
      {
        tenant_id: authed.tenantId,
        user_id: authed.userId,
        endpoint: sub.endpoint,
        p256dh: sub.keys.p256dh,
        auth: sub.keys.auth,
      },
      // MASS-01: scope conflict resolution to the tenant so a tenant cannot
      // overwrite another tenant's subscription row (see migration 0132).
      { onConflict: 'tenant_id,endpoint' }
    )

    console.info(`[push] subscription saved for tenant=${authed.tenantId}`)
    res.json({ subscribed: true })
  } catch (err) {
    console.error('[push] subscribe error:', err)
    res.status(500).json({ error: 'Failed to save subscription' })
  }
})

// ── POST /api/push/unsubscribe ───────────────────────────────────────────────
router.post('/unsubscribe', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const endpoint = typeof req.body?.endpoint === 'string' ? req.body.endpoint : ''

  if (!endpoint) {
    res.status(400).json({ error: 'Missing endpoint' })
    return
  }

  try {
    const supabase = getServiceClient()
    await supabase
      .from('push_subscriptions')
      .delete()
      .eq('tenant_id', authed.tenantId)
      .eq('endpoint', endpoint)

    res.json({ unsubscribed: true })
  } catch (err) {
    console.error('[push] unsubscribe error:', err)
    res.status(500).json({ error: 'Failed to remove subscription' })
  }
})

// ── POST /api/push/test ──────────────────────────────────────────────────────
router.post('/test', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest

  await sendPushNotification(authed.tenantId, {
    title: 'Nuatis',
    body: 'Push notifications are working!',
    url: '/calls',
  })

  res.json({ sent: true })
})

export default router
