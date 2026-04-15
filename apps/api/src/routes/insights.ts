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

function getDateRange(req: Request): { from: string; to: string } {
  const now = new Date()
  const to = (req.query['to'] as string) || now.toISOString()
  const defaultFrom = new Date(now.getTime() - 30 * 86400000).toISOString()
  const from = (req.query['from'] as string) || defaultFrom
  return { from, to }
}

// ── GET /api/insights/calls ──────────────────────────────────────────────────
router.get('/calls', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getSupabase()
  const { from, to } = getDateRange(req)

  try {
    const { data: sessions } = await supabase
      .from('voice_sessions')
      .select(
        'id, started_at, duration_seconds, first_response_ms, call_quality_mos, outcome, language_detected, tool_calls_made'
      )
      .eq('tenant_id', authed.tenantId)
      .gte('started_at', from)
      .lte('started_at', to)
      .order('started_at', { ascending: true })

    const calls = sessions ?? []
    const totalCalls = calls.length

    let totalDuration = 0
    let totalLatency = 0
    let latencyCount = 0
    let totalMos = 0
    let mosCount = 0

    const outcomeBreakdown: Record<string, number> = {}
    const languageBreakdown: Record<string, number> = {}
    const dailyMap = new Map<string, { calls: number; bookings: number }>()
    const hourMap = new Map<number, number>()
    const toolUsage: Record<string, number> = {}

    for (const c of calls) {
      totalDuration += c.duration_seconds ?? 0
      if (c.first_response_ms != null) {
        totalLatency += c.first_response_ms
        latencyCount++
      }
      if (c.call_quality_mos != null) {
        totalMos += Number(c.call_quality_mos)
        mosCount++
      }

      const outcome = c.outcome ?? 'general'
      outcomeBreakdown[outcome] = (outcomeBreakdown[outcome] ?? 0) + 1

      const lang = c.language_detected ?? 'unknown'
      languageBreakdown[lang] = (languageBreakdown[lang] ?? 0) + 1

      const date = c.started_at.slice(0, 10)
      const day = dailyMap.get(date) ?? { calls: 0, bookings: 0 }
      day.calls++
      if (outcome === 'booking_made') day.bookings++
      dailyMap.set(date, day)

      const hour = new Date(c.started_at).getHours()
      hourMap.set(hour, (hourMap.get(hour) ?? 0) + 1)

      if (Array.isArray(c.tool_calls_made)) {
        for (const tc of c.tool_calls_made as Array<{ name: string }>) {
          if (tc.name) toolUsage[tc.name] = (toolUsage[tc.name] ?? 0) + 1
        }
      }
    }

    const dailyVolume = Array.from(dailyMap.entries())
      .map(([date, v]) => ({ date, ...v }))
      .sort((a, b) => a.date.localeCompare(b.date))

    const peakHours = Array.from(hourMap.entries())
      .map(([hour, calls]) => ({ hour, calls }))
      .sort((a, b) => a.hour - b.hour)

    res.json({
      total_calls: totalCalls,
      avg_duration_seconds: totalCalls > 0 ? Math.round(totalDuration / totalCalls) : 0,
      avg_first_response_ms: latencyCount > 0 ? Math.round(totalLatency / latencyCount) : null,
      avg_mos: mosCount > 0 ? Number((totalMos / mosCount).toFixed(2)) : null,
      outcome_breakdown: outcomeBreakdown,
      language_breakdown: languageBreakdown,
      daily_volume: dailyVolume,
      peak_hours: peakHours,
      tool_usage: toolUsage,
    })
  } catch (err) {
    console.error('[insights] calls error:', err)
    res.status(500).json({ error: 'Failed to fetch call insights' })
  }
})

// ── GET /api/insights/pipeline ───────────────────────────────────────────────
router.get('/pipeline', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getSupabase()
  const { from } = getDateRange(req)

  try {
    // Stage distribution from pipeline_entries
    const { data: entries } = await supabase
      .from('pipeline_entries')
      .select('status, entered_at, pipeline_stages(name)')
      .eq('tenant_id', authed.tenantId)

    const stageMap = new Map<string, number>()
    let wonCount = 0
    const totalEntries = entries?.length ?? 0

    for (const e of entries ?? []) {
      const stageName =
        e.pipeline_stages && typeof e.pipeline_stages === 'object' && 'name' in e.pipeline_stages
          ? String((e.pipeline_stages as { name: string }).name)
          : 'Unknown'
      stageMap.set(stageName, (stageMap.get(stageName) ?? 0) + 1)
      if (e.status === 'won') wonCount++
    }

    const stageDistribution = Array.from(stageMap.entries()).map(([stage, count]) => ({
      stage,
      count,
    }))

    // Source breakdown from contacts
    const { data: contacts } = await supabase
      .from('contacts')
      .select('source, created_at')
      .eq('tenant_id', authed.tenantId)
      .eq('is_archived', false)

    const sourceMap = new Map<string, number>()
    const dailyContacts = new Map<string, number>()

    for (const c of contacts ?? []) {
      const src = c.source ?? 'unknown'
      sourceMap.set(src, (sourceMap.get(src) ?? 0) + 1)
      if (c.created_at >= from) {
        const date = c.created_at.slice(0, 10)
        dailyContacts.set(date, (dailyContacts.get(date) ?? 0) + 1)
      }
    }

    const sourceBreakdown: Record<string, number> = Object.fromEntries(sourceMap)

    const newContactsTrend = Array.from(dailyContacts.entries())
      .map(([date, count]) => ({ date, count }))
      .sort((a, b) => a.date.localeCompare(b.date))

    const conversionRate =
      totalEntries > 0 ? Number(((wonCount / totalEntries) * 100).toFixed(1)) : 0

    res.json({
      stage_distribution: stageDistribution,
      source_breakdown: sourceBreakdown,
      conversion_rate: conversionRate,
      new_contacts_trend: newContactsTrend,
      total_contacts: contacts?.length ?? 0,
    })
  } catch (err) {
    console.error('[insights] pipeline error:', err)
    res.status(500).json({ error: 'Failed to fetch pipeline insights' })
  }
})

// ── GET /api/insights/revenue ────────────────────────────────────────────────
router.get('/revenue', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getSupabase()
  const { from, to } = getDateRange(req)

  try {
    // AI bookings: appointments created from a call
    const { data: aiAppts } = await supabase
      .from('appointments')
      .select('id, created_at')
      .eq('tenant_id', authed.tenantId)
      .not('created_by_call', 'is', null)
      .gte('created_at', from)
      .lte('created_at', to)

    // All appointments
    const { data: allAppts } = await supabase
      .from('appointments')
      .select('id, created_at, created_by_call')
      .eq('tenant_id', authed.tenantId)
      .gte('created_at', from)
      .lte('created_at', to)

    const aiBookings = aiAppts?.length ?? 0
    const totalBookings = allAppts?.length ?? 0
    const humanBookings = totalBookings - aiBookings

    // Total calls for cost calculation
    const { count: totalCalls } = await supabase
      .from('voice_sessions')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', authed.tenantId)
      .gte('started_at', from)
      .lte('started_at', to)

    const callCount = totalCalls ?? 0
    const costPerCall = 0.008
    const totalMayaCost = Number((callCount * costPerCall).toFixed(2))
    const receptionistCost = 2500
    const roiMultiplier =
      totalMayaCost > 0 ? Number((receptionistCost / totalMayaCost).toFixed(1)) : 0
    const monthlySavings = Number((receptionistCost - totalMayaCost).toFixed(2))

    // Booking trend
    const dailyBookings = new Map<string, { ai: number; human: number }>()
    for (const a of allAppts ?? []) {
      const date = a.created_at.slice(0, 10)
      const day = dailyBookings.get(date) ?? { ai: 0, human: 0 }
      if (a.created_by_call) day.ai++
      else day.human++
      dailyBookings.set(date, day)
    }

    const bookingTrend = Array.from(dailyBookings.entries())
      .map(([date, v]) => ({ date, ...v }))
      .sort((a, b) => a.date.localeCompare(b.date))

    res.json({
      total_bookings: totalBookings,
      ai_bookings: aiBookings,
      human_bookings: humanBookings,
      maya_booking_rate:
        totalBookings > 0 ? Number(((aiBookings / totalBookings) * 100).toFixed(1)) : 0,
      total_calls: callCount,
      cost_per_call: costPerCall,
      total_maya_cost: totalMayaCost,
      estimated_receptionist_cost: receptionistCost,
      roi_multiplier: roiMultiplier,
      monthly_savings: monthlySavings,
      booking_trend: bookingTrend,
    })
  } catch (err) {
    console.error('[insights] revenue error:', err)
    res.status(500).json({ error: 'Failed to fetch revenue insights' })
  }
})

// ── GET /api/insights/follow-ups ─────────────────────────────────────────────
router.get('/follow-ups', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getSupabase()

  try {
    const { data: contacts } = await supabase
      .from('contacts')
      .select('id, follow_up_step, created_at')
      .eq('tenant_id', authed.tenantId)
      .eq('is_archived', false)

    const allContacts = contacts ?? []
    let activeSequences = 0
    let completedSequences = 0
    let neverFollowedUp = 0
    const stepDist: Record<string, number> = {}
    const fourteenDaysAgo = new Date(Date.now() - 14 * 86400000).toISOString()

    for (const c of allContacts) {
      const step = c.follow_up_step ?? 0
      if (step > 0 && step < 3) activeSequences++
      else if (step >= 3) completedSequences++
      else if (step === 0 && c.created_at > fourteenDaysAgo) neverFollowedUp++

      if (step > 0) {
        const key = step >= 3 ? 'completed' : `step_${step}`
        stepDist[key] = (stepDist[key] ?? 0) + 1
      }
    }

    // Follow-up to booking: contacts with follow_up_step > 0 who have appointments
    const contactIds = allContacts.filter((c) => (c.follow_up_step ?? 0) > 0).map((c) => c.id)
    let followUpToBooking = 0

    if (contactIds.length > 0) {
      const { count } = await supabase
        .from('appointments')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', authed.tenantId)
        .in('contact_id', contactIds.slice(0, 100))
      followUpToBooking = count ?? 0
    }

    res.json({
      active_sequences: activeSequences,
      completed_sequences: completedSequences,
      contacts_never_followed_up: neverFollowedUp,
      follow_up_to_booking: followUpToBooking,
      follow_up_conversion_rate:
        contactIds.length > 0
          ? Number(((followUpToBooking / contactIds.length) * 100).toFixed(1))
          : 0,
      step_distribution: stepDist,
    })
  } catch (err) {
    console.error('[insights] follow-ups error:', err)
    res.status(500).json({ error: 'Failed to fetch follow-up insights' })
  }
})

// ── GET /api/insights/cpq ─────────────────────────────────────────────────────
router.get('/cpq', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getSupabase()
  const { from, to } = getDateRange(req)

  try {
    const { data: quotes } = await supabase
      .from('quotes')
      .select('id, status, total, created_by, created_at, sent_at, accepted_at, declined_at')
      .eq('tenant_id', authed.tenantId)

    const allQuotes = quotes ?? []
    const totalQuotes = allQuotes.length

    const statusMap: Record<string, number> = {}
    let acceptedCount = 0
    let declinedCount = 0
    let totalRevWon = 0
    let totalAcceptTime = 0
    let acceptTimeCount = 0
    let aiTotal = 0
    let aiAccepted = 0

    const dailyMap = new Map<string, { created: number; accepted: number; declined: number }>()

    for (const q of allQuotes) {
      const s = q.status ?? 'draft'
      statusMap[s] = (statusMap[s] ?? 0) + 1

      if (s === 'accepted') {
        acceptedCount++
        totalRevWon += Number(q.total) || 0
        if (q.sent_at && q.accepted_at) {
          const diff = new Date(q.accepted_at).getTime() - new Date(q.sent_at).getTime()
          totalAcceptTime += diff
          acceptTimeCount++
        }
      }
      if (s === 'declined') declinedCount++

      if (q.created_by === 'ai') {
        aiTotal++
        if (s === 'accepted') aiAccepted++
      }

      // Daily trend (within date range)
      if (q.created_at >= from && q.created_at <= to) {
        const date = q.created_at.slice(0, 10)
        const day = dailyMap.get(date) ?? { created: 0, accepted: 0, declined: 0 }
        day.created++
        if (s === 'accepted') day.accepted++
        if (s === 'declined') day.declined++
        dailyMap.set(date, day)
      }
    }

    const decided = acceptedCount + declinedCount
    const winRate = decided > 0 ? Number(((acceptedCount / decided) * 100).toFixed(1)) : 0
    const avgDealSize = acceptedCount > 0 ? Number((totalRevWon / acceptedCount).toFixed(2)) : 0
    const avgTimeToAcceptHours =
      acceptTimeCount > 0 ? Math.round(totalAcceptTime / acceptTimeCount / 3600000) : null

    const quoteVolumeTrend = Array.from(dailyMap.entries())
      .map(([date, v]) => ({ date, ...v }))
      .sort((a, b) => a.date.localeCompare(b.date))

    // Top services from line items
    const acceptedIds = allQuotes.filter((q) => q.status === 'accepted').map((q) => q.id)
    let topServices: Array<{ name: string; quotes: number; revenue: number }> = []

    if (acceptedIds.length > 0) {
      const { data: lineItems } = await supabase
        .from('quote_line_items')
        .select('description, total')
        .in('quote_id', acceptedIds.slice(0, 100))

      const svcMap = new Map<string, { quotes: number; revenue: number }>()
      for (const li of lineItems ?? []) {
        const existing = svcMap.get(li.description) ?? { quotes: 0, revenue: 0 }
        existing.quotes++
        existing.revenue += Number(li.total) || 0
        svcMap.set(li.description, existing)
      }
      topServices = Array.from(svcMap.entries())
        .map(([name, v]) => ({ name, ...v }))
        .sort((a, b) => b.revenue - a.revenue)
        .slice(0, 10)
    }

    // Quote open rate + avg time to first view
    const sentStatuses = ['sent', 'viewed', 'accepted', 'declined', 'expired', 'deposit_paid']
    const sentQuotes = allQuotes.filter((q) => sentStatuses.includes(q.status))
    const sentQuoteIds = sentQuotes.map((q) => q.id)

    let quoteOpenRate = 0
    let avgTimeToFirstViewHours: number | null = null

    if (sentQuoteIds.length > 0) {
      // Get first view per quote from quote_views
      const { data: viewRows } = await supabase
        .from('quote_views')
        .select('quote_id, viewed_at')
        .in('quote_id', sentQuoteIds.slice(0, 200))
        .order('viewed_at', { ascending: true })

      // Compute per-quote first views
      const firstViews = new Map<string, string>()
      for (const v of viewRows ?? []) {
        if (!firstViews.has(v.quote_id)) {
          firstViews.set(v.quote_id, v.viewed_at)
        }
      }

      const openedCount = firstViews.size
      quoteOpenRate =
        sentQuoteIds.length > 0 ? Number(((openedCount / sentQuoteIds.length) * 100).toFixed(1)) : 0

      // Avg time from sent_at to first view
      const sentAtMap = new Map<string, string>()
      for (const q of sentQuotes) {
        if (q.sent_at) sentAtMap.set(q.id, q.sent_at)
      }

      let totalTimeMs = 0
      let timeCount = 0
      for (const [qId, firstViewAt] of firstViews) {
        const sentAt = sentAtMap.get(qId)
        if (sentAt) {
          const diff = new Date(firstViewAt).getTime() - new Date(sentAt).getTime()
          if (diff > 0) {
            totalTimeMs += diff
            timeCount++
          }
        }
      }
      avgTimeToFirstViewHours =
        timeCount > 0 ? Number((totalTimeMs / timeCount / 3600000).toFixed(1)) : null
    }

    // Updated 4-stage funnel counts
    const funnelDraft = statusMap['draft'] ?? 0
    const funnelSent = sentQuotes.length
    const funnelViewed = allQuotes.filter((q) =>
      ['viewed', 'accepted', 'declined', 'expired', 'deposit_paid'].includes(q.status)
    ).length
    const funnelAccepted = acceptedCount

    res.json({
      total_quotes: totalQuotes,
      quotes_by_status: statusMap,
      win_rate: winRate,
      avg_deal_size: avgDealSize,
      total_revenue_won: Number(totalRevWon.toFixed(2)),
      avg_time_to_accept_hours: avgTimeToAcceptHours,
      quote_open_rate: quoteOpenRate,
      avg_time_to_first_view_hours: avgTimeToFirstViewHours,
      quote_volume_trend: quoteVolumeTrend,
      top_services: topServices,
      funnel: [
        { stage: 'Draft', count: funnelDraft },
        { stage: 'Sent', count: funnelSent },
        { stage: 'Viewed', count: funnelViewed },
        { stage: 'Accepted', count: funnelAccepted },
      ],
      ai_generated_stats: {
        total_ai_quotes: aiTotal,
        ai_acceptance_rate: aiTotal > 0 ? Number(((aiAccepted / aiTotal) * 100).toFixed(1)) : 0,
      },
    })
  } catch (err) {
    console.error('[insights] cpq error:', err)
    res.status(500).json({ error: 'Failed to fetch CPQ insights' })
  }
})

// ── GET /api/insights/plg ─────────────────────────────────────────────────────
router.get('/plg', requireAuth, async (_req: Request, res: Response): Promise<void> => {
  const supabase = getSupabase()

  try {
    const [mayaRes, suiteRes, eventsRes] = await Promise.all([
      supabase
        .from('tenants')
        .select('id', { count: 'exact', head: true })
        .eq('product', 'maya_only'),
      supabase.from('tenants').select('id', { count: 'exact', head: true }).eq('product', 'suite'),
      supabase
        .from('analytics_events')
        .select('event_name, created_at')
        .in('event_name', [
          'upgrade_completed',
          'upgrade_page_viewed',
          'upgrade_cta_clicked',
          'signup_started',
        ]),
    ])

    const mayaOnly = mayaRes.count ?? 0
    const suite = suiteRes.count ?? 0
    const events = eventsRes.data ?? []

    const upgrades = events.filter((e) => e.event_name === 'upgrade_completed').length
    const upgradeViews = events.filter((e) => e.event_name === 'upgrade_page_viewed').length
    const upgradeRate = mayaOnly > 0 ? Number(((upgrades / mayaOnly) * 100).toFixed(1)) : 0

    res.json({
      maya_only_signups: mayaOnly,
      suite_signups: suite,
      upgrades,
      upgrade_rate: upgradeRate,
      upgrade_page_views: upgradeViews,
      funnel: [
        { step: 'maya_signup', count: mayaOnly },
        { step: 'upgrade_viewed', count: upgradeViews },
        { step: 'upgraded', count: upgrades },
      ],
    })
  } catch (err) {
    console.error('[insights] plg error:', err)
    res.status(500).json({ error: 'Failed to fetch PLG insights' })
  }
})

export default router
