import { Router, type Request, type Response } from 'express'
import { createClient } from '@supabase/supabase-js'
import { requireAuth, type AuthenticatedRequest } from '../lib/auth.js'

const router = Router()

const MONTH_ABBREVS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
]

function getSupabase() {
  const url = process.env['SUPABASE_URL']
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY']
  if (!url || !key) throw new Error('Supabase env vars not set')
  return createClient(url, key)
}

// ── GET /api/email/health ─────────────────────────────────────────────────────
router.get('/health', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getSupabase()

  try {
    const now = new Date()
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
    const thirtyDaysAgoIso = thirtyDaysAgo.toISOString()

    // Build the 7-day window (today is day 7, 6 days ago is day 1) — UTC midnight
    const sevenDaysAgo = new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000)
    const sevenDaysAgoIso = new Date(
      Date.UTC(sevenDaysAgo.getUTCFullYear(), sevenDaysAgo.getUTCMonth(), sevenDaysAgo.getUTCDate())
    ).toISOString()

    // Run all DB queries in parallel
    const [
      sentResult,
      deliveredResult,
      hardBouncedResult,
      softBouncedResult,
      complainedResult,
      unsubscribedResult,
      suppressedHardResult,
      suppressedComplainedResult,
      atRiskResult,
      trendRowsResult,
    ] = await Promise.all([
      // total_sent
      supabase
        .from('email_events')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', authed.tenantId)
        .eq('event_type', 'sent')
        .gte('created_at', thirtyDaysAgoIso),

      // total_delivered
      supabase
        .from('email_events')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', authed.tenantId)
        .eq('event_type', 'delivered')
        .gte('created_at', thirtyDaysAgoIso),

      // total_hard_bounced
      supabase
        .from('email_events')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', authed.tenantId)
        .eq('event_type', 'bounced_hard')
        .gte('created_at', thirtyDaysAgoIso),

      // total_soft_bounced
      supabase
        .from('email_events')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', authed.tenantId)
        .eq('event_type', 'bounced_soft')
        .gte('created_at', thirtyDaysAgoIso),

      // total_complained
      supabase
        .from('email_events')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', authed.tenantId)
        .eq('event_type', 'complained')
        .gte('created_at', thirtyDaysAgoIso),

      // total_unsubscribed
      supabase
        .from('email_events')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', authed.tenantId)
        .eq('event_type', 'unsubscribed')
        .gte('created_at', thirtyDaysAgoIso),

      // suppressed_contacts (hard_bounce) — all time
      supabase
        .from('contacts')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', authed.tenantId)
        .eq('email_status', 'hard_bounce'),

      // suppressed_contacts (complained) — all time
      supabase
        .from('contacts')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', authed.tenantId)
        .eq('email_status', 'complained'),

      // at_risk_contacts: email_risk_score BETWEEN 31 AND 89
      supabase
        .from('contacts')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', authed.tenantId)
        .gte('email_risk_score', 31)
        .lte('email_risk_score', 89),

      // trend_7d rows (last 7 days)
      supabase
        .from('email_events')
        .select('created_at, event_type')
        .eq('tenant_id', authed.tenantId)
        .in('event_type', ['sent', 'delivered', 'bounced_hard', 'bounced_soft'])
        .gte('created_at', sevenDaysAgoIso),
    ])

    // Surface errors on critical queries
    if (
      sentResult.error ||
      deliveredResult.error ||
      hardBouncedResult.error ||
      softBouncedResult.error ||
      complainedResult.error
    ) {
      res.status(500).json({ error: 'Failed to fetch email metrics' })
      return
    }
    if (unsubscribedResult.error) {
      console.error('[email-health] unsubscribed query error:', unsubscribedResult.error)
    }
    if (suppressedHardResult.error) {
      console.error('[email-health] suppressedHard query error:', suppressedHardResult.error)
    }
    if (suppressedComplainedResult.error) {
      console.error(
        '[email-health] suppressedComplained query error:',
        suppressedComplainedResult.error
      )
    }
    if (atRiskResult.error) {
      console.error('[email-health] atRisk query error:', atRiskResult.error)
    }
    if (trendRowsResult.error) {
      console.error('[email-health] trendRows query error:', trendRowsResult.error)
    }

    const totalSent = sentResult.count ?? 0
    const totalDelivered = deliveredResult.count ?? 0
    const totalHardBounced = hardBouncedResult.count ?? 0
    const totalSoftBounced = softBouncedResult.count ?? 0
    const totalComplained = complainedResult.count ?? 0
    const totalUnsubscribed = unsubscribedResult.count ?? 0
    const suppressedContacts =
      (suppressedHardResult.count ?? 0) + (suppressedComplainedResult.count ?? 0)
    const atRiskContacts = atRiskResult.count ?? 0

    const deliveryRate =
      totalSent === 0 ? 100.0 : Math.round((totalDelivered / totalSent) * 1000) / 10

    const hardBounceRate =
      totalSent === 0 ? 0.0 : Math.round((totalHardBounced / totalSent) * 1000) / 10

    const complaintRate =
      totalSent === 0 ? 0.0 : Math.round((totalComplained / totalSent) * 1000) / 10

    // Alert thresholds
    let alertLevel: 'ok' | 'warning' | 'critical' = 'ok'
    let alertMessage: string | null = null

    if (hardBounceRate > 5) {
      alertLevel = 'critical'
      alertMessage = `Email hard bounce rate is ${hardBounceRate}% — check list quality`
    } else if (complaintRate > 0.3) {
      alertLevel = 'critical'
      alertMessage = `Complaint rate is ${complaintRate}% — ISP threshold exceeded`
    } else if (hardBounceRate > 2) {
      alertLevel = 'warning'
      alertMessage = `Email hard bounce rate elevated at ${hardBounceRate}% — monitor closely`
    } else if (complaintRate > 0.1) {
      alertLevel = 'warning'
      alertMessage = `Complaint rate elevated at ${complaintRate}% — monitor closely`
    }

    // Build trend_7d — 7 days oldest-first
    const days: { isoKey: string; label: string }[] = []
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000)
      const isoKey = d.toISOString().slice(0, 10) // e.g. "2025-05-19"
      const label = `${MONTH_ABBREVS[d.getUTCMonth()]} ${d.getUTCDate()}` // e.g. "May 19"
      days.push({ isoKey, label })
    }

    // Bucket trend rows into day slots — key by ISO date string
    const buckets = new Map<string, { sent: number; delivered: number; bounced: number }>()
    for (const d of days) {
      buckets.set(d.isoKey, { sent: 0, delivered: 0, bounced: 0 })
    }

    const trendRows = trendRowsResult.data ?? []
    for (const row of trendRows) {
      const rowDate = new Date(row.created_at as string)
      const isoKey = rowDate.toISOString().slice(0, 10)
      const bucket = buckets.get(isoKey)
      if (!bucket) continue
      if (row.event_type === 'sent') bucket.sent++
      if (row.event_type === 'delivered') bucket.delivered++
      if (row.event_type === 'bounced_hard' || row.event_type === 'bounced_soft') bucket.bounced++
    }

    const trend7d = days.map((d) => {
      const b = buckets.get(d.isoKey) ?? { sent: 0, delivered: 0, bounced: 0 }
      return { date: d.label, sent: b.sent, delivered: b.delivered, bounced: b.bounced }
    })

    res.json({
      period_days: 30,
      total_sent: totalSent,
      total_delivered: totalDelivered,
      total_hard_bounced: totalHardBounced,
      total_soft_bounced: totalSoftBounced,
      total_complained: totalComplained,
      total_unsubscribed: totalUnsubscribed,
      delivery_rate: deliveryRate,
      hard_bounce_rate: hardBounceRate,
      complaint_rate: complaintRate,
      suppressed_contacts: suppressedContacts,
      at_risk_contacts: atRiskContacts,
      alert: {
        level: alertLevel,
        message: alertMessage,
      },
      trend_7d: trend7d,
    })
  } catch (err) {
    console.error('[email-health] error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

export default router
