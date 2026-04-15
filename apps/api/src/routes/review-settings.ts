import { Router, type Request, type Response } from 'express'
import { createClient } from '@supabase/supabase-js'
import { requireAuth, type AuthenticatedRequest } from '../lib/auth.js'
import { logActivity } from '../lib/activity.js'

// ── Authenticated router (default export) ────────────────────────────────────
const router = Router()

// ── Public tracking router (named export) ────────────────────────────────────
export const reviewTrackingRouter = Router()

function getSupabase() {
  const url = process.env['SUPABASE_URL']
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY']
  if (!url || !key) throw new Error('Supabase env vars not set')
  return createClient(url, key)
}

// ── GET /api/review-settings ──────────────────────────────────────────────────
router.get('/', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getSupabase()

  const { data: tenant, error } = await supabase
    .from('tenants')
    .select(
      'review_automation_enabled, review_delay_minutes, review_message_template, booking_google_review_url'
    )
    .eq('id', authed.tenantId)
    .single()

  if (error || !tenant) {
    res.status(404).json({ error: 'Tenant not found' })
    return
  }

  res.json({
    enabled: tenant.review_automation_enabled ?? false,
    delayMinutes: tenant.review_delay_minutes ?? 60,
    messageTemplate:
      tenant.review_message_template ??
      'Hi {{first_name}}, thank you for your recent visit! We would love your feedback. Leave us a review here: {{review_url}}',
    googleReviewUrl: tenant.booking_google_review_url ?? null,
  })
})

// ── PUT /api/review-settings ──────────────────────────────────────────────────
router.put('/', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getSupabase()
  const b = req.body as Record<string, unknown>

  const updates: Record<string, unknown> = {}

  if (typeof b['enabled'] === 'boolean') {
    updates['review_automation_enabled'] = b['enabled']
  }

  if (typeof b['delayMinutes'] === 'number') {
    const delay = Math.round(b['delayMinutes'])
    if (delay < 15 || delay > 1440) {
      res.status(400).json({ error: 'delayMinutes must be between 15 and 1440' })
      return
    }
    updates['review_delay_minutes'] = delay
  }

  if (typeof b['messageTemplate'] === 'string') {
    const template = b['messageTemplate'].trim()
    if (!template.includes('{{review_url}}')) {
      res.status(400).json({ error: "messageTemplate must contain '{{review_url}}'" })
      return
    }
    updates['review_message_template'] = template
  }

  if (b['googleReviewUrl'] !== undefined) {
    updates['booking_google_review_url'] =
      typeof b['googleReviewUrl'] === 'string' && b['googleReviewUrl'].trim()
        ? b['googleReviewUrl'].trim()
        : null
  }

  if (Object.keys(updates).length === 0) {
    res.status(400).json({ error: 'No valid fields provided' })
    return
  }

  const { error } = await supabase.from('tenants').update(updates).eq('id', authed.tenantId)

  if (error) {
    res.status(500).json({ error: error.message })
    return
  }

  console.info(`[review-settings] updated for tenant=${authed.tenantId}`)

  const { data: tenant } = await supabase
    .from('tenants')
    .select(
      'review_automation_enabled, review_delay_minutes, review_message_template, booking_google_review_url'
    )
    .eq('id', authed.tenantId)
    .single()

  res.json({
    enabled: tenant?.review_automation_enabled ?? false,
    delayMinutes: tenant?.review_delay_minutes ?? 60,
    messageTemplate:
      tenant?.review_message_template ??
      'Hi {{first_name}}, thank you for your recent visit! We would love your feedback. Leave us a review here: {{review_url}}',
    googleReviewUrl: tenant?.booking_google_review_url ?? null,
  })
})

// ── GET /api/review-settings/stats ───────────────────────────────────────────
router.get('/stats', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getSupabase()

  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()

  const [totalSentResult, totalClickedResult, last30SentResult, last30ClickedResult] =
    await Promise.all([
      supabase
        .from('review_requests')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', authed.tenantId)
        .in('status', ['sent', 'clicked']),
      supabase
        .from('review_requests')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', authed.tenantId)
        .eq('status', 'clicked'),
      supabase
        .from('review_requests')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', authed.tenantId)
        .in('status', ['sent', 'clicked'])
        .gte('sent_at', thirtyDaysAgo),
      supabase
        .from('review_requests')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', authed.tenantId)
        .eq('status', 'clicked')
        .gte('clicked_at', thirtyDaysAgo),
    ])

  const totalSent = totalSentResult.count ?? 0
  const totalClicked = totalClickedResult.count ?? 0
  const last30Sent = last30SentResult.count ?? 0
  const last30Clicked = last30ClickedResult.count ?? 0
  const clickRate = totalSent > 0 ? Math.round((totalClicked / totalSent) * 100) : 0

  res.json({
    totalSent,
    totalClicked,
    clickRate,
    last30Days: {
      sent: last30Sent,
      clicked: last30Clicked,
    },
  })
})

// ── GET /api/review-tracking/:id (PUBLIC, no auth) ───────────────────────────
reviewTrackingRouter.get('/:id', async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params
  const supabase = getSupabase()

  try {
    const { data: reviewRequest } = await supabase
      .from('review_requests')
      .select('id, tenant_id, contact_id, clicked_at, status')
      .eq('id', id)
      .maybeSingle()

    if (!reviewRequest) {
      res.redirect(302, 'https://nuatis.com')
      return
    }

    // Mark as clicked if not already clicked
    if (!reviewRequest.clicked_at) {
      await supabase
        .from('review_requests')
        .update({ status: 'clicked', clicked_at: new Date().toISOString() })
        .eq('id', reviewRequest.id)

      if (reviewRequest.contact_id) {
        logActivity({
          tenantId: reviewRequest.tenant_id,
          contactId: reviewRequest.contact_id,
          type: 'system',
          body: 'Review request link clicked',
          metadata: { review_request_id: reviewRequest.id },
        })
      }
    }

    // Fetch Google review URL for this tenant
    const { data: tenant } = await supabase
      .from('tenants')
      .select('booking_google_review_url')
      .eq('id', reviewRequest.tenant_id)
      .single()

    const googleReviewUrl =
      (tenant?.booking_google_review_url as string | null) ?? 'https://nuatis.com'

    res.redirect(302, googleReviewUrl)
  } catch (err) {
    console.error('[review-tracking] error:', err)
    res.redirect(302, 'https://nuatis.com')
  }
})

export default router
