import { Router, type Request, type Response } from 'express'
import { createClient } from '@supabase/supabase-js'
import { requireAuth, type AuthenticatedRequest } from '../lib/auth.js'

const router = Router()

function getSupabase() {
  const url = process.env['SUPABASE_URL']
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY']
  if (!url || !key) throw new Error('Supabase env vars not set')
  return createClient(url, key)
}

// POST /api/analytics/event — fire-and-forget event tracking
router.post('/event', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const eventName = typeof req.body?.event_name === 'string' ? req.body.event_name : ''

  if (!eventName) {
    res.status(400).json({ error: 'event_name is required' })
    return
  }

  // Fire-and-forget insert — respond immediately
  res.json({ tracked: true })

  try {
    const supabase = getSupabase()
    await supabase.from('analytics_events').insert({
      tenant_id: authed.tenantId,
      event_name: eventName,
      properties: req.body?.properties ?? {},
    })
  } catch (err) {
    console.error('[analytics] event insert error:', err)
  }
})

export default router
