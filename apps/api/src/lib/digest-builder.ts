import { createClient } from '@supabase/supabase-js'
import type { WeeklyDigestData } from '@nuatis/shared'

// ── Month abbreviations ───────────────────────────────────────

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function formatDateLabel(d: Date): string {
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`
}

// ── Supabase factory (no module-level singleton) ──────────────

function getSupabase() {
  const url = process.env['SUPABASE_URL']
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY']
  if (!url || !key) throw new Error('Supabase env vars not set')
  return createClient(url, key)
}

// ── Main export ───────────────────────────────────────────────

export async function buildDigestData(tenantId: string): Promise<WeeklyDigestData> {
  const supabase = getSupabase()

  const now = new Date()
  const sevenDaysAgo = new Date(now.getTime() - 7 * 86400000)
  const fourteenDaysAgo = new Date(now.getTime() - 14 * 86400000)
  const sevenDaysFromNow = new Date(now.getTime() + 7 * 86400000)

  const nowIso = now.toISOString()
  const sevenDaysAgoIso = sevenDaysAgo.toISOString()
  const fourteenDaysAgoIso = fourteenDaysAgo.toISOString()
  const sevenDaysFromNowIso = sevenDaysFromNow.toISOString()

  // Period labels
  const period = {
    from: formatDateLabel(sevenDaysAgo),
    to: formatDateLabel(now),
  }

  // ── Run all queries in parallel ──────────────────────────────

  const [
    tenantResult,
    contactsNewThisWeekResult,
    contactsTotalResult,
    contactsNewPriorWeekResult,
    apptBookedThisWeekResult,
    apptShowedResult,
    apptNoShowResult,
    apptUpcoming7dResult,
    dealsNewResult,
    dealsWonResult,
    dealsOpenResult,
    mayaCallsTotalResult,
    mayaCallsBookingsResult,
    mayaCallsDurationResult,
    smsSentResult,
    smsDeliveredResult,
  ] = await Promise.all([
    // Business name
    supabase.from('tenants').select('name').eq('id', tenantId).single(),

    // contacts.new_this_week
    supabase
      .from('contacts')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .gte('created_at', sevenDaysAgoIso),

    // contacts.total (non-archived)
    supabase
      .from('contacts')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .eq('is_archived', false),

    // contacts.new_prior_week (for change_pct)
    supabase
      .from('contacts')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .gte('created_at', fourteenDaysAgoIso)
      .lt('created_at', sevenDaysAgoIso),

    // appointments.booked_this_week
    supabase
      .from('appointments')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .gte('created_at', sevenDaysAgoIso),

    // appointments.showed (completed, start_time in last 7d)
    supabase
      .from('appointments')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .eq('status', 'completed')
      .gte('start_time', sevenDaysAgoIso)
      .lte('start_time', nowIso),

    // appointments.no_show
    supabase
      .from('appointments')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .eq('status', 'no_show')
      .gte('start_time', sevenDaysAgoIso)
      .lte('start_time', nowIso),

    // appointments.upcoming_7d
    supabase
      .from('appointments')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .gt('start_time', nowIso)
      .lte('start_time', sevenDaysFromNowIso)
      .not('status', 'in', '(canceled,no_show)'),

    // pipeline.new_deals
    supabase
      .from('deals')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .eq('is_archived', false)
      .gte('created_at', sevenDaysAgoIso),

    // pipeline.deals_won + revenue_won — select value for JS sum
    supabase
      .from('deals')
      .select('value')
      .eq('tenant_id', tenantId)
      .eq('is_closed_won', true)
      .eq('is_archived', false)
      .gte('updated_at', sevenDaysAgoIso),

    // pipeline.open_pipeline_value — select value for JS sum
    supabase
      .from('deals')
      .select('value')
      .eq('tenant_id', tenantId)
      .eq('is_closed_won', false)
      .eq('is_closed_lost', false)
      .eq('is_archived', false),

    // maya_calls.total_this_week
    supabase
      .from('voice_sessions')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .gte('created_at', sevenDaysAgoIso),

    // maya_calls.bookings_from_calls
    supabase
      .from('appointments')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .not('created_by_call', 'is', null)
      .gte('created_at', sevenDaysAgoIso),

    // maya_calls.avg_duration_seconds — select duration_seconds for JS avg
    supabase
      .from('voice_sessions')
      .select('duration_seconds')
      .eq('tenant_id', tenantId)
      .gte('created_at', sevenDaysAgoIso),

    // sms_health.sent_this_week
    supabase
      .from('sms_messages')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .eq('direction', 'outbound')
      .neq('status', 'queued')
      .gte('created_at', sevenDaysAgoIso),

    // sms_health: delivered count for delivery_rate
    supabase
      .from('sms_messages')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .eq('direction', 'outbound')
      .eq('status', 'delivered')
      .gte('created_at', sevenDaysAgoIso),
  ])

  // ── Check for DB query errors ──────────────────────────────────

  const allResults = [
    tenantResult,
    contactsNewThisWeekResult,
    contactsTotalResult,
    contactsNewPriorWeekResult,
    apptBookedThisWeekResult,
    apptShowedResult,
    apptNoShowResult,
    apptUpcoming7dResult,
    dealsNewResult,
    dealsWonResult,
    dealsOpenResult,
    mayaCallsTotalResult,
    mayaCallsBookingsResult,
    mayaCallsDurationResult,
    smsSentResult,
    smsDeliveredResult,
  ]
  const dbErrors = allResults.map((r) => r.error).filter(Boolean)
  if (dbErrors.length > 0) {
    console.warn('[digest-builder] DB query errors:', dbErrors)
  }

  // ── Derive metrics from results ──────────────────────────────

  const businessName = (tenantResult.data as { name?: string } | null)?.name ?? 'Your Business'

  const newThisWeek = contactsNewThisWeekResult.count ?? 0
  const totalContacts = contactsTotalResult.count ?? 0
  const newPriorWeek = contactsNewPriorWeekResult.count ?? 0
  const changePct =
    newPriorWeek > 0 ? Math.round(((newThisWeek - newPriorWeek) / newPriorWeek) * 1000) / 10 : null

  const bookedThisWeek = apptBookedThisWeekResult.count ?? 0
  const showed = apptShowedResult.count ?? 0
  const noShow = apptNoShowResult.count ?? 0
  const upcoming7d = apptUpcoming7dResult.count ?? 0

  const newDeals = dealsNewResult.count ?? 0

  const wonDeals = (dealsWonResult.data ?? []) as Array<{ value?: number | null }>
  const dealsWon = wonDeals.length
  const revenueWon = wonDeals.reduce((sum, d) => sum + Number(d.value ?? 0), 0)

  const openDeals = (dealsOpenResult.data ?? []) as Array<{ value?: number | null }>
  const openPipelineValue = openDeals.reduce((sum, d) => sum + Number(d.value ?? 0), 0)

  const mayaCallsTotal = mayaCallsTotalResult.count ?? 0
  const bookingsFromCalls = mayaCallsBookingsResult.count ?? 0

  const durationRows = (mayaCallsDurationResult.data ?? []) as Array<{
    duration_seconds?: number | null
  }>
  const avgDurationSeconds =
    durationRows.length > 0
      ? durationRows.reduce((sum, r) => sum + Number(r.duration_seconds ?? 0), 0) /
        durationRows.length
      : null

  const smsSent = smsSentResult.count ?? 0
  const smsDelivered = smsDeliveredResult.count ?? 0
  const deliveryRate = smsSent > 0 ? Math.round((smsDelivered / smsSent) * 1000) / 10 : null

  // ── Assemble data without top_insight ────────────────────────

  const dataWithoutInsight = {
    period,
    business_name: businessName,
    contacts: {
      new_this_week: newThisWeek,
      total: totalContacts,
      change_pct: changePct,
    },
    appointments: {
      booked_this_week: bookedThisWeek,
      showed,
      no_show: noShow,
      upcoming_7d: upcoming7d,
    },
    pipeline: {
      new_deals: newDeals,
      deals_won: dealsWon,
      revenue_won: revenueWon,
      open_pipeline_value: openPipelineValue,
    },
    maya_calls: {
      total_this_week: mayaCallsTotal,
      bookings_from_calls: bookingsFromCalls,
      avg_duration_seconds: avgDurationSeconds,
    },
    sms_health: {
      sent_this_week: smsSent,
      delivery_rate: deliveryRate,
    },
  }

  // ── Gemini insight ────────────────────────────────────────────

  let top_insight: string | null = null

  const apiKey = process.env['GEMINI_API_KEY']
  if (!apiKey) {
    console.warn('[digest-builder] GEMINI_API_KEY not set — skipping top_insight')
  } else {
    try {
      const prompt = `In one sentence, highlight the most notable metric from this week's business data: ${JSON.stringify(dataWithoutInsight)}. Be specific with numbers. Start with the metric name.`

      const { GoogleGenAI } = await import('@google/genai')
      const genai = new GoogleGenAI({ apiKey })

      const geminiCall = genai.models
        .generateContent({
          model: 'gemini-2.0-flash',
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          config: { maxOutputTokens: 60 },
        })
        .then((result) => result?.text?.trim() ?? null)
        .catch((err: unknown) => {
          console.warn('[digest-builder] Gemini call failed:', err)
          return null
        })

      const timeoutPromise = new Promise<null>((resolve) => setTimeout(() => resolve(null), 2000))

      top_insight = await Promise.race([geminiCall, timeoutPromise])

      if (top_insight === null) {
        console.warn(
          '[digest-builder] Gemini timed out or returned null — top_insight will be null'
        )
      }
    } catch (err) {
      console.warn('[digest-builder] Gemini setup failed:', err)
      top_insight = null
    }
  }

  return {
    ...dataWithoutInsight,
    top_insight,
  }
}
