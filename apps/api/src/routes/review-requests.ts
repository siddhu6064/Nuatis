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

const FALLBACK_URL = 'https://g.page/r'

// ── GET /api/review-requests/track/:id (PUBLIC) ───────────────────────────────
router.get('/track/:id', async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params as { id: string }
  const supabase = getSupabase()

  try {
    const { data: rr } = await supabase
      .from('review_requests')
      .select('id, status, review_url, tenant_id, contact_id')
      .eq('id', id)
      .maybeSingle()

    if (!rr) {
      res.redirect(302, FALLBACK_URL)
      return
    }

    const now = new Date().toISOString()
    let update: Record<string, string> = {}

    if (rr.status === 'sent') {
      update = { status: 'opened', opened_at: now, updated_at: now }
    } else if (rr.status === 'opened') {
      update = { status: 'clicked', clicked_at: now, updated_at: now }
    }

    if (Object.keys(update).length > 0) {
      await supabase.from('review_requests').update(update).eq('id', id)
    }

    const redirectUrl = (rr.review_url as string | null) ?? FALLBACK_URL
    res.redirect(302, redirectUrl)
  } catch {
    res.redirect(302, FALLBACK_URL)
  }
})

// ── POST /api/review-requests/track/:id/complete (PUBLIC) ─────────────────────
router.post('/track/:id/complete', async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params as { id: string }
  const supabase = getSupabase()

  try {
    const { data: rr } = await supabase
      .from('review_requests')
      .select('id, status')
      .eq('id', id)
      .maybeSingle()

    if (!rr) {
      res.status(404).json({ error: 'Not found' })
      return
    }

    // Only mark complete if not already completed
    if (rr.status !== 'completed') {
      const now = new Date().toISOString()
      await supabase
        .from('review_requests')
        .update({ status: 'completed', completed_at: now, updated_at: now })
        .eq('id', id)
    }

    res.json({ success: true })
  } catch (err) {
    console.error('[review-requests] complete error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// ── GET /api/review-requests/stats (authenticated) ────────────────────────────
router.get('/stats', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getSupabase()

  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()

  // Fetch all non-pending rows for tenant
  const { data: rows } = await supabase
    .from('review_requests')
    .select('status, channel, sent_at, clicked_at, completed_at')
    .eq('tenant_id', authed.tenantId)
    .in('status', ['sent', 'opened', 'clicked', 'completed'])

  const all = rows ?? []

  const statuses = new Set(['sent', 'opened', 'clicked', 'completed'])
  const inStatus = (r: { status: string }) => statuses.has(r.status)

  const totalSent = all.filter(inStatus).length
  const totalOpened = all.filter((r) =>
    ['opened', 'clicked', 'completed'].includes(r.status)
  ).length
  const totalClicked = all.filter((r) => ['clicked', 'completed'].includes(r.status)).length
  const totalCompleted = all.filter((r) => r.status === 'completed').length

  const openRate = totalSent > 0 ? Math.round((totalOpened / totalSent) * 100) : 0
  const clickRate = totalSent > 0 ? Math.round((totalClicked / totalSent) * 100) : 0
  const completionRate = totalSent > 0 ? Math.round((totalCompleted / totalSent) * 100) : 0

  function channelStats(ch: string) {
    const c = all.filter((r) => (r.channel ?? 'sms') === ch)
    return {
      sent: c.length,
      opened: c.filter((r) => ['opened', 'clicked', 'completed'].includes(r.status)).length,
      clicked: c.filter((r) => ['clicked', 'completed'].includes(r.status)).length,
      completed: c.filter((r) => r.status === 'completed').length,
    }
  }

  const last30 = all.filter((r) => r.sent_at && r.sent_at >= thirtyDaysAgo)
  const last30Days = {
    sent: last30.length,
    clicked: last30.filter((r) => ['clicked', 'completed'].includes(r.status)).length,
    completed: last30.filter((r) => r.status === 'completed').length,
  }

  res.json({
    total_sent: totalSent,
    total_opened: totalOpened,
    total_clicked: totalClicked,
    total_completed: totalCompleted,
    open_rate: openRate,
    click_rate: clickRate,
    completion_rate: completionRate,
    by_channel: {
      sms: channelStats('sms'),
      email: channelStats('email'),
    },
    last_30_days: last30Days,
  })
})

export default router
