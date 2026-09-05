import { getServiceClient } from './supabase.js'
import type { BrandVoice, WeeklyDigestData } from '@nuatis/shared'
import { buildBrandVoicePromptBlock } from './brand-voice.js'
import { withTimeoutOrNull } from './async.js'

// ── Month abbreviations ───────────────────────────────────────

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function formatDateLabel(d: Date): string {
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`
}

// ── Main export ───────────────────────────────────────────────

export async function buildDigestData(tenantId: string): Promise<WeeklyDigestData> {
  const supabase = getServiceClient()

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
    overdueInvoicesResult,
    lowStockItemsResult,
    quotesExpiringResult,
  ] = await Promise.all([
    // Business name + brand voice
    supabase.from('tenants').select('name, brand_voice').eq('id', tenantId).single(),

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

    // operations.overdue_invoices — select total for JS sum, same status set
    // invoice-overdue-scanner.ts transitions invoices into
    supabase.from('invoices').select('total').eq('tenant_id', tenantId).eq('status', 'overdue'),

    // operations.low_stock_items — same threshold check low-stock-scanner.ts
    // uses, computed client-side since PostgREST can't compare two columns
    supabase
      .from('inventory_items')
      .select('quantity, reorder_threshold')
      .eq('tenant_id', tenantId)
      .is('deleted_at', null),

    // operations.quotes_expiring_7d
    supabase
      .from('quotes')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .in('status', ['draft', 'sent', 'viewed'])
      .gte('valid_until', nowIso)
      .lte('valid_until', sevenDaysFromNowIso),
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
    overdueInvoicesResult,
    lowStockItemsResult,
    quotesExpiringResult,
  ]
  const dbErrors = allResults.map((r) => r.error).filter(Boolean)
  if (dbErrors.length > 0) {
    console.warn('[digest-builder] DB query errors:', dbErrors)
  }

  // ── Derive metrics from results ──────────────────────────────

  const businessName =
    (tenantResult.data as { name?: string; brand_voice?: unknown } | null)?.name ?? 'Your Business'
  const brandVoice = (tenantResult.data as { brand_voice?: unknown } | null)?.brand_voice ?? null

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

  const overdueInvoiceRows = (overdueInvoicesResult.data ?? []) as Array<{ total?: number | null }>
  const overdueInvoices = overdueInvoiceRows.length
  const overdueInvoicesTotal = overdueInvoiceRows.reduce((sum, r) => sum + Number(r.total ?? 0), 0)

  const inventoryRows = (lowStockItemsResult.data ?? []) as Array<{
    quantity?: number | null
    reorder_threshold?: number | null
  }>
  const lowStockItems = inventoryRows.filter(
    (r) => Number(r.quantity ?? 0) <= Number(r.reorder_threshold ?? 0)
  ).length

  const quotesExpiring7d = quotesExpiringResult.count ?? 0

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
    operations: {
      overdue_invoices: overdueInvoices,
      overdue_invoices_total: Number(overdueInvoicesTotal.toFixed(2)),
      low_stock_items: lowStockItems,
      quotes_expiring_7d: quotesExpiring7d,
    },
  }

  // ── Gemini insight ────────────────────────────────────────────

  let top_insight: string | null = null

  const apiKey = process.env['GEMINI_API_KEY']
  if (!apiKey) {
    console.warn('[digest-builder] GEMINI_API_KEY not set — skipping top_insight')
  } else {
    try {
      const bvBlock = buildBrandVoicePromptBlock(brandVoice as BrandVoice | null)
      const prompt = `In one sentence, highlight the most notable metric from this week's business data: ${JSON.stringify(dataWithoutInsight)}. Be specific with numbers. Start with the metric name.`
      const fullPrompt = bvBlock ? bvBlock + '\n\n' + prompt : prompt

      const { GoogleGenAI } = await import('@google/genai')
      const genai = new GoogleGenAI({ apiKey })

      const geminiCall = genai.models
        .generateContent({
          model: 'gemini-2.0-flash',
          contents: [{ role: 'user', parts: [{ text: fullPrompt }] }],
          config: { maxOutputTokens: 60 },
        })
        .then((result) => result?.text?.trim() ?? null)
        .catch((err: unknown) => {
          console.warn('[digest-builder] Gemini call failed:', err)
          return null
        })

      top_insight = await withTimeoutOrNull(geminiCall, 2000)

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
