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

// GET /api/nps/status — check if NPS should be shown
router.get('/status', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getSupabase()

  const { data } = await supabase
    .from('tenants')
    .select('created_at, nps_submitted_at, nps_dismissed')
    .eq('id', authed.tenantId)
    .single()

  if (!data) {
    res.json({ show: false })
    return
  }

  const thirtyDaysAgo = Date.now() - 30 * 86400000
  const createdAt = new Date(data.created_at).getTime()
  const eligible = createdAt <= thirtyDaysAgo
  const show = eligible && !data.nps_submitted_at && !data.nps_dismissed

  res.json({ show, created_at: data.created_at })
})

// POST /api/nps/submit
router.post('/submit', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getSupabase()
  const score = typeof req.body?.score === 'number' ? req.body.score : null
  const feedback = typeof req.body?.feedback === 'string' ? req.body.feedback : null

  if (score == null || score < 0 || score > 10) {
    res.status(400).json({ error: 'score must be 0-10' })
    return
  }

  await supabase
    .from('tenants')
    .update({ nps_score: score, nps_submitted_at: new Date().toISOString() })
    .eq('id', authed.tenantId)

  // Also log as analytics event
  await supabase.from('analytics_events').insert({
    tenant_id: authed.tenantId,
    event_name: 'nps_submitted',
    properties: { score, feedback },
  })

  console.info(`[nps] submitted score=${score} tenant=${authed.tenantId}`)
  res.json({ submitted: true })
})

// POST /api/nps/dismiss
router.post('/dismiss', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getSupabase()

  await supabase.from('tenants').update({ nps_dismissed: true }).eq('id', authed.tenantId)

  res.json({ dismissed: true })
})

export default router
