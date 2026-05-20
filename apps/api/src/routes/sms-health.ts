import { Router, type Request, type Response } from 'express'
import { createClient } from '@supabase/supabase-js'
import { requireAuth, type AuthenticatedRequest } from '../lib/auth.js'

const router = Router()

// Fix 4: module-level constant
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

// ── GET /api/sms/health ───────────────────────────────────────────────────────
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
      failedResult,
      optedOutResult,
      errorRowsResult,
      trendRowsResult,
    ] = await Promise.all([
      // total_sent
      supabase
        .from('sms_messages')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', authed.tenantId)
        .eq('direction', 'outbound')
        .neq('status', 'queued')
        .gte('created_at', thirtyDaysAgoIso),

      // total_delivered
      supabase
        .from('sms_messages')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', authed.tenantId)
        .eq('direction', 'outbound')
        .eq('status', 'delivered')
        .gte('created_at', thirtyDaysAgoIso),

      // total_failed
      supabase
        .from('sms_messages')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', authed.tenantId)
        .eq('direction', 'outbound')
        .eq('status', 'failed')
        .gte('created_at', thirtyDaysAgoIso),

      // total_opted_out (all time)
      supabase
        .from('contacts')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', authed.tenantId)
        .eq('sms_opt_in', false),

      // error_breakdown rows (last 30d) — group in JS
      supabase
        .from('sms_delivery_errors')
        .select('error_code, error_title')
        .eq('tenant_id', authed.tenantId)
        .gte('created_at', thirtyDaysAgoIso),

      // trend_7d rows (last 7 days) — Fix 5: exclude queued to match total_sent definition
      supabase
        .from('sms_messages')
        .select('created_at, status')
        .eq('tenant_id', authed.tenantId)
        .eq('direction', 'outbound')
        .neq('status', 'queued')
        .gte('created_at', sevenDaysAgoIso),
    ])

    // Fix 3: surface errors on critical queries
    if (sentResult.error || deliveredResult.error || failedResult.error) {
      res.status(500).json({ error: 'Failed to fetch SMS metrics' })
      return
    }
    if (optedOutResult.error) {
      console.error('[sms-health] optedOut query error:', optedOutResult.error)
    }
    if (trendRowsResult.error) {
      console.error('[sms-health] trendRows query error:', trendRowsResult.error)
    }

    const totalSent = sentResult.count ?? 0
    const totalDelivered = deliveredResult.count ?? 0
    const totalFailed = failedResult.count ?? 0
    const totalOptedOut = optedOutResult.count ?? 0

    const deliveryRate =
      totalSent === 0 ? 100.0 : Math.round((totalDelivered / totalSent) * 1000) / 10

    const failureRate = totalSent === 0 ? 0.0 : Math.round((totalFailed / totalSent) * 1000) / 10

    // Build error_breakdown — group by (error_code, error_title), top 5
    const errorRows = errorRowsResult.data ?? []
    const errorMap = new Map<string, { error_code: string; error_title: string; count: number }>()
    for (const row of errorRows) {
      const key = `${row.error_code}::${row.error_title}`
      const existing = errorMap.get(key)
      if (existing) {
        existing.count++
      } else {
        errorMap.set(key, {
          error_code: String(row.error_code ?? ''),
          error_title: String(row.error_title ?? ''),
          count: 1,
        })
      }
    }
    const errorBreakdown = Array.from(errorMap.values())
      .sort((a, b) => b.count - a.count)
      .slice(0, 5)

    // Build trend_7d — 7 days oldest-first
    // Fix 1 + 2: use ISO date as bucket key (avoids cross-year collision); use UTC for all date math
    const days: { isoKey: string; label: string }[] = []
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000)
      const isoKey = d.toISOString().slice(0, 10) // e.g. "2025-05-19"
      const label = `${MONTH_ABBREVS[d.getUTCMonth()]} ${d.getUTCDate()}` // e.g. "May 19"
      days.push({ isoKey, label })
    }

    // Bucket trend rows into day slots — key by ISO date string
    const buckets = new Map<string, { sent: number; delivered: number; failed: number }>()
    for (const d of days) {
      buckets.set(d.isoKey, { sent: 0, delivered: 0, failed: 0 })
    }

    const trendRows = trendRowsResult.data ?? []
    for (const row of trendRows) {
      const rowDate = new Date(row.created_at as string)
      const isoKey = rowDate.toISOString().slice(0, 10)
      const bucket = buckets.get(isoKey)
      if (!bucket) continue
      bucket.sent++
      if (row.status === 'delivered') bucket.delivered++
      if (row.status === 'failed') bucket.failed++
    }

    const trend7d = days.map((d) => {
      const b = buckets.get(d.isoKey) ?? { sent: 0, delivered: 0, failed: 0 }
      return { date: d.label, sent: b.sent, delivered: b.delivered, failed: b.failed }
    })

    // Alert thresholds
    let alertLevel: 'ok' | 'warning' | 'critical' = 'ok'
    let alertMessage: string | null = null
    if (failureRate > 10) {
      alertLevel = 'critical'
      alertMessage = `SMS failure rate is ${failureRate}% — check 10DLC campaign status`
    } else if (failureRate > 5) {
      alertLevel = 'warning'
      alertMessage = `SMS failure rate elevated at ${failureRate}% — monitor closely`
    }

    res.json({
      period_days: 30,
      total_sent: totalSent,
      total_delivered: totalDelivered,
      total_failed: totalFailed,
      total_opted_out: totalOptedOut,
      delivery_rate: deliveryRate,
      failure_rate: failureRate,
      error_breakdown: errorBreakdown,
      trend_7d: trend7d,
      alert: {
        level: alertLevel,
        message: alertMessage,
      },
    })
  } catch (err) {
    console.error('[sms-health] error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

export default router
