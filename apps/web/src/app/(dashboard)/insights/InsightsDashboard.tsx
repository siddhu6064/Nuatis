'use client'

import { useMemo, useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd'
import type { DropResult } from '@hello-pangea/dnd'
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  PieChart,
  Pie,
  AreaChart,
  Area,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts'
import { VERTICAL_AVG_APPOINTMENT_VALUE } from '@/lib/verticals'

interface Session {
  id: string
  started_at: string
  duration_seconds: number | null
  first_response_ms: number | null
  call_quality_mos: number | null
  outcome: string | null
  language_detected: string | null
  tool_calls_made: Array<{ name: string }> | null
  booked_appointment: boolean
}

interface Appointment {
  id: string
  created_at: string
  created_by_call: string | null
  status: string
}

interface Contact {
  id: string
  source: string | null
  follow_up_step: number | null
  created_at: string
}

interface PipelineEntry {
  status: string
  pipeline_stages: { name: string } | { name: string }[] | null
}

interface Quote {
  id: string
  status: string
  total: number
  created_by: string | null
  created_at: string
  sent_at: string | null
  accepted_at: string | null
  declined_at: string | null
}

interface QuoteView {
  quote_id: string
  viewed_at: string
}

interface PackageLineItem {
  quote_id: string
  package_id: string
  total: number
}

interface PackageRecord {
  id: string
  name: string
  vertical: string
}

interface Props {
  sessions: Session[]
  appointments: Appointment[]
  contacts: Contact[]
  pipelineEntries: PipelineEntry[]
  quotes: Quote[]
  quoteViews: QuoteView[]
  packageLineItems: PackageLineItem[]
  packageRecords: PackageRecord[]
  vertical: string
}

interface Pipeline {
  id: string
  name: string
}

interface ForecastStage {
  id: string
  name: string
  probability: number
  deal_count: number
  total_value: number
  weighted_value: number
}

interface MonthlyForecast {
  month: string
  expected_value: number
  deal_count: number
}

interface ForecastSummary {
  total_pipeline_value: number
  total_weighted_value: number
  deal_count: number
  avg_deal_value: number
  monthly_forecast: MonthlyForecast[]
  win_rate: number
  avg_days_to_close: number
}

interface PipelineForecastData {
  pipeline: { id: string; name: string }
  stages: ForecastStage[]
  summary: ForecastSummary
}

interface FunnelStage {
  stage: string
  count: number
  total_value: number
  drop_off_pct: number
}

interface CampaignInsightSummary {
  total_campaigns: number
  total_sent: number
  avg_delivery_rate: number
  avg_open_rate: number
  top_channel: string | null
}

interface CampaignByDay {
  date: string
  sent: number
  delivered: number
}

interface RecentCampaign {
  id: string
  name: string
  status: string
  total_sent: number
  delivery_rate: number
  opt_out_rate: number
  sent_at: string | null
}

interface CampaignInsightData {
  summary: CampaignInsightSummary | null
  by_day: CampaignByDay[]
  recent_campaigns: RecentCampaign[]
}

const CHART_COLORS = [
  '#0d9488', // teal (Maya/primary)
  '#6366f1', // indigo (CRM)
  '#f59e0b', // amber (Automation)
  '#10b981', // emerald (Scheduling)
  '#8b5cf6', // violet (Pipeline)
  '#ef4444', // red (CPQ)
  '#0ea5e9', // sky (Inventory)
  '#f97316', // orange (Staff/Insights)
]

const OUTCOME_COLORS: Record<string, string> = {
  booking_made: '#10b981',
  inquiry_answered: '#6366f1',
  escalated: '#f59e0b',
  abandoned: '#ef4444',
  general: '#a8a29a',
}

const OUTCOME_LABELS: Record<string, string> = {
  booking_made: 'Booking',
  inquiry_answered: 'Inquiry',
  escalated: 'Escalated',
  abandoned: 'Abandoned',
  general: 'General',
}

const LANG_LABELS: Record<string, string> = {
  en: 'English',
  es: 'Spanish',
  hi: 'Hindi',
  te: 'Telugu',
  unknown: 'Unknown',
}

const LANG_COLORS = CHART_COLORS
const SOURCE_COLORS = CHART_COLORS

function StatCard({
  label,
  value,
  sub,
  color,
}: {
  label: string
  value: string
  sub?: string
  color?: string
}) {
  return (
    <div className="bg-white rounded-xl border border-border-brand p-4">
      <p className="text-xs text-ink4 mb-1">{label}</p>
      <p className={`text-2xl font-bold ${color ?? 'text-ink'}`}>{value}</p>
      {sub && <p className="text-[11px] text-ink4 mt-1">{sub}</p>}
    </div>
  )
}

const FUNNEL_COLORS = ['#a8a29a', '#6366f1', '#f59e0b', '#10b981']
const STAGE_COLORS = CHART_COLORS

function formatCurrency(value: number): string {
  if (value >= 1000000) return `$${(value / 1000000).toFixed(1)}M`
  if (value >= 1000) return `$${(value / 1000).toFixed(0)}k`
  return `$${value.toFixed(0)}`
}

const DEFAULT_ORDER = [
  'call_stats',
  'call_volume',
  'outcomes_hours',
  'pipeline_dist',
  'roi_summary',
  'revenue_forecast',
  'lang_sources',
  'followup',
  'quotes',
  'pipeline_forecast',
  'custom_reports',
  'territory_perf',
  'campaign_perf',
]

const LS_KEY = 'nuatis_insights_order'

export default function InsightsDashboard({
  sessions,
  appointments,
  contacts,
  pipelineEntries,
  quotes,
  quoteViews,
  packageLineItems,
  packageRecords,
  vertical,
}: Props) {
  const router = useRouter()

  const stats = useMemo(() => {
    const totalCalls = sessions.length
    let totalLatency = 0
    let latencyCount = 0
    let totalMos = 0
    let mosCount = 0

    const outcomeMap: Record<string, number> = {}
    const langMap: Record<string, number> = {}
    const dailyMap = new Map<string, { calls: number; bookings: number }>()
    const hourMap = new Map<number, number>()
    const toolMap: Record<string, number> = {}

    for (const s of sessions) {
      if (s.first_response_ms != null) {
        totalLatency += s.first_response_ms
        latencyCount++
      }
      if (s.call_quality_mos != null) {
        totalMos += Number(s.call_quality_mos)
        mosCount++
      }
      const outcome = s.outcome ?? 'general'
      outcomeMap[outcome] = (outcomeMap[outcome] ?? 0) + 1

      const lang = s.language_detected ?? 'unknown'
      langMap[lang] = (langMap[lang] ?? 0) + 1

      const date = s.started_at.slice(0, 10)
      const day = dailyMap.get(date) ?? { calls: 0, bookings: 0 }
      day.calls++
      if (outcome === 'booking_made') day.bookings++
      dailyMap.set(date, day)

      const hour = new Date(s.started_at).getHours()
      hourMap.set(hour, (hourMap.get(hour) ?? 0) + 1)

      if (Array.isArray(s.tool_calls_made)) {
        for (const tc of s.tool_calls_made) {
          if (tc.name) toolMap[tc.name] = (toolMap[tc.name] ?? 0) + 1
        }
      }
    }

    const bookings = outcomeMap['booking_made'] ?? 0
    const avgLatency = latencyCount > 0 ? Math.round(totalLatency / latencyCount) : null
    const avgMos = mosCount > 0 ? Number((totalMos / mosCount).toFixed(2)) : null

    const dailyVolume = Array.from(dailyMap.entries())
      .map(([date, v]) => ({ date: date.slice(5), ...v }))
      .sort((a, b) => a.date.localeCompare(b.date))

    const peakHours = Array.from({ length: 24 }, (_, h) => ({
      hour: `${h}:00`,
      calls: hourMap.get(h) ?? 0,
    }))

    const outcomeData = Object.entries(outcomeMap).map(([name, value]) => ({
      name: OUTCOME_LABELS[name] ?? name,
      value,
      color: OUTCOME_COLORS[name] ?? '#9ca3af',
    }))

    const langData = Object.entries(langMap).map(([name, value]) => ({
      name: LANG_LABELS[name] ?? name,
      value,
    }))

    // AI vs human bookings
    const aiBookings = appointments.filter((a) => a.created_by_call != null).length
    const humanBookings = appointments.length - aiBookings

    // Booking trend
    const bookingDailyMap = new Map<string, { ai: number; human: number }>()
    for (const a of appointments) {
      const date = a.created_at.slice(0, 10)
      const day = bookingDailyMap.get(date) ?? { ai: 0, human: 0 }
      if (a.created_by_call) day.ai++
      else day.human++
      bookingDailyMap.set(date, day)
    }
    const bookingTrend = Array.from(bookingDailyMap.entries())
      .map(([date, v]) => ({ date: date.slice(5), ...v }))
      .sort((a, b) => a.date.localeCompare(b.date))

    // Pipeline
    const stageMap = new Map<string, number>()
    let wonCount = 0
    for (const e of pipelineEntries) {
      if (e.status === 'won') wonCount++
      const stages = e.pipeline_stages
      const stageName = stages
        ? Array.isArray(stages)
          ? ((stages[0] as { name: string } | undefined)?.name ?? null)
          : ((stages as { name: string }).name ?? null)
        : null
      if (!stageName) continue
      stageMap.set(stageName, (stageMap.get(stageName) ?? 0) + 1)
    }
    const stageDistribution = Array.from(stageMap.entries()).map(([stage, count]) => ({
      stage,
      count,
    }))

    // Source breakdown
    const sourceMap = new Map<string, number>()
    for (const c of contacts) {
      const src = c.source ?? 'unknown'
      sourceMap.set(src, (sourceMap.get(src) ?? 0) + 1)
    }
    const sourceData = Array.from(sourceMap.entries()).map(([name, value]) => ({ name, value }))

    // Follow-up stats
    let activeSeq = 0
    let completedSeq = 0
    const stepDist: Record<string, number> = { step_1: 0, step_2: 0, completed: 0 }
    for (const c of contacts) {
      const step = c.follow_up_step ?? 0
      if (step > 0 && step < 3) activeSeq++
      else if (step >= 3) completedSeq++
      if (step === 1) stepDist['step_1']!++
      else if (step === 2) stepDist['step_2']!++
      else if (step >= 3) stepDist['completed']!++
    }

    // ROI
    const costPerCall = 0.008
    const totalMayaCost = Number((totalCalls * costPerCall).toFixed(2))
    const receptionistCost = 2500
    const monthlySavings = receptionistCost - totalMayaCost
    const roiMultiplier = totalMayaCost > 0 ? Math.round(receptionistCost / totalMayaCost) : 0

    // Revenue forecast
    const avgApptValue = VERTICAL_AVG_APPOINTMENT_VALUE[vertical] ?? 200
    const weeksInRange = Math.max(
      1,
      sessions.length > 0
        ? Math.ceil((Date.now() - new Date(sessions[0]!.started_at).getTime()) / (7 * 86400000))
        : 1
    )
    const weeklyBookings = bookings / weeksInRange
    const projectedMonthlyBookings = Math.round(weeklyBookings * 4.3)
    const projectedRevenue = projectedMonthlyBookings * avgApptValue

    // CPQ stats
    const totalQuotes = quotes.length
    const quoteStatusMap: Record<string, number> = {}
    let qAccepted = 0
    let qDeclined = 0
    let totalRevWon = 0
    let aiQuotes = 0
    let aiAccepted = 0
    const quoteDailyMap = new Map<string, { created: number; accepted: number }>()

    for (const q of quotes) {
      const s = q.status ?? 'draft'
      quoteStatusMap[s] = (quoteStatusMap[s] ?? 0) + 1
      if (s === 'accepted') {
        qAccepted++
        totalRevWon += Number(q.total) || 0
      }
      if (s === 'declined') qDeclined++
      if (q.created_by === 'ai') {
        aiQuotes++
        if (s === 'accepted') aiAccepted++
      }
      const date = q.created_at.slice(5, 10)
      const day = quoteDailyMap.get(date) ?? { created: 0, accepted: 0 }
      day.created++
      if (s === 'accepted') day.accepted++
      quoteDailyMap.set(date, day)
    }

    const qDecided = qAccepted + qDeclined
    const winRate = qDecided > 0 ? Number(((qAccepted / qDecided) * 100).toFixed(1)) : 0
    const avgDealSize = qAccepted > 0 ? Number((totalRevWon / qAccepted).toFixed(2)) : 0
    const quoteTrend = Array.from(quoteDailyMap.entries())
      .map(([date, v]) => ({ date, ...v }))
      .sort((a, b) => a.date.localeCompare(b.date))

    const funnelData = [
      { stage: 'Draft', count: quoteStatusMap['draft'] ?? 0 },
      { stage: 'Sent', count: quoteStatusMap['sent'] ?? 0 },
      { stage: 'Viewed', count: quoteStatusMap['viewed'] ?? 0 },
      { stage: 'Accepted', count: quoteStatusMap['accepted'] ?? 0 },
    ]

    // Open rate from quote views
    const sentStatuses = ['sent', 'viewed', 'accepted', 'declined', 'expired', 'deposit_paid']
    const sentQuotes = quotes.filter((q) => sentStatuses.includes(q.status))
    const firstViewMap = new Map<string, string>()
    for (const v of quoteViews) {
      const existing = firstViewMap.get(v.quote_id)
      if (!existing || v.viewed_at < existing) {
        firstViewMap.set(v.quote_id, v.viewed_at)
      }
    }
    const openedQuoteIds = new Set(
      sentQuotes.filter((q) => firstViewMap.has(q.id)).map((q) => q.id)
    )
    const quoteOpenRate =
      sentQuotes.length > 0
        ? Number(((openedQuoteIds.size / sentQuotes.length) * 100).toFixed(1))
        : 0

    // Avg time to first view
    let totalViewTimeMs = 0
    let viewTimeCount = 0
    for (const q of sentQuotes) {
      const firstView = firstViewMap.get(q.id)
      if (firstView && q.sent_at) {
        const diff = new Date(firstView).getTime() - new Date(q.sent_at).getTime()
        if (diff > 0) {
          totalViewTimeMs += diff
          viewTimeCount++
        }
      }
    }
    const avgTimeToFirstViewHours =
      viewTimeCount > 0 ? Number((totalViewTimeMs / viewTimeCount / 3600000).toFixed(1)) : null

    return {
      totalCalls,
      bookings,
      avgLatency,
      avgMos,
      dailyVolume,
      peakHours,
      outcomeData,
      langData,
      aiBookings,
      humanBookings,
      bookingTrend,
      stageDistribution,
      sourceData,
      activeSeq,
      completedSeq,
      stepDist,
      totalMayaCost,
      monthlySavings,
      roiMultiplier,
      projectedMonthlyBookings,
      projectedRevenue,
      avgApptValue,
      pipelineTotal: pipelineEntries.length,
      wonCount,
      totalQuotes,
      winRate,
      avgDealSize,
      totalRevWon,
      quoteTrend,
      funnelData,
      aiQuotes,
      aiAccepted,
      quoteOpenRate,
      avgTimeToFirstViewHours,
      topPackages: (() => {
        if (packageLineItems.length === 0) return []
        const pkgMap = new Map(packageRecords.map((p) => [p.id, p]))
        const wonQuoteIds = new Set(quotes.filter((q) => q.status === 'accepted').map((q) => q.id))
        const stats = new Map<
          string,
          { quoteIds: Set<string>; revenue: number; wonCount: number }
        >()

        for (const li of packageLineItems) {
          const s = stats.get(li.package_id) ?? { quoteIds: new Set(), revenue: 0, wonCount: 0 }
          s.quoteIds.add(li.quote_id)
          if (wonQuoteIds.has(li.quote_id)) s.revenue += Number(li.total) || 0
          stats.set(li.package_id, s)
        }
        for (const [, s] of stats) {
          let won = 0
          for (const qid of s.quoteIds) if (wonQuoteIds.has(qid)) won++
          s.wonCount = won
        }

        return Array.from(stats.entries())
          .map(([pid, s]) => {
            const pkg = pkgMap.get(pid)
            return {
              package_name: pkg?.name ?? 'Unknown',
              vertical: pkg?.vertical ?? '',
              quote_count: s.quoteIds.size,
              total_revenue: Number(s.revenue.toFixed(2)),
              win_rate:
                s.quoteIds.size > 0 ? Number(((s.wonCount / s.quoteIds.size) * 100).toFixed(1)) : 0,
            }
          })
          .sort((a, b) => b.quote_count - a.quote_count)
          .slice(0, 5)
      })(),
    }
  }, [
    sessions,
    appointments,
    contacts,
    pipelineEntries,
    quotes,
    quoteViews,
    packageLineItems,
    packageRecords,
    vertical,
  ])

  const bookingRate =
    stats.totalCalls > 0 ? ((stats.bookings / stats.totalCalls) * 100).toFixed(1) : '0'
  const latencyColor =
    stats.avgLatency != null
      ? stats.avgLatency < 1500
        ? 'text-green-600'
        : stats.avgLatency < 2000
          ? 'text-amber-600'
          : 'text-red-600'
      : 'text-ink4'
  const mosLabel =
    stats.avgMos != null
      ? stats.avgMos >= 4.0
        ? 'Excellent'
        : stats.avgMos >= 3.5
          ? 'Good'
          : stats.avgMos >= 3.0
            ? 'Fair'
            : 'Poor'
      : '--'

  // Territory analytics state
  interface TerritoryRow {
    territory: string
    contacts_count: number
    customers_count: number
    conversion_rate: number
  }
  const [territoryData, setTerritoryData] = useState<TerritoryRow[]>([])
  const [territoryLoading, setTerritoryLoading] = useState(false)

  useEffect(() => {
    setTerritoryLoading(true)
    fetch('/api/insights/territory')
      .then((r) => (r.ok ? r.json() : null))
      .then((data: TerritoryRow[] | null) => {
        if (Array.isArray(data)) setTerritoryData(data)
      })
      .catch(() => {})
      .finally(() => setTerritoryLoading(false))
  }, [])

  const hasTerritoryData = territoryData.some((r) => r.territory && r.territory !== '')

  // Campaigns insights state
  const [campaignInsights, setCampaignInsights] = useState<CampaignInsightData | null>(null)

  useEffect(() => {
    fetch('/api/insights/campaigns')
      .then((r) => (r.ok ? r.json() : null))
      .then((data: CampaignInsightData | null) => {
        if (data) setCampaignInsights(data)
      })
      .catch(() => {})
  }, [])

  // Pinned Reports state
  interface PinnedReport {
    id: string
    name: string
    chart_type: 'bar' | 'line' | 'pie' | 'table' | 'number'
    pin_order: number
  }

  interface ReportDataRow {
    [key: string]: string | number | null
  }

  const [pinnedReports, setPinnedReports] = useState<PinnedReport[]>([])
  const [pinnedReportData, setPinnedReportData] = useState<Record<string, ReportDataRow[]>>({})

  const fetchPinnedReports = useCallback(() => {
    fetch('/api/reports?pinned=true')
      .then((r) => (r.ok ? r.json() : []))
      .then((reports: PinnedReport[]) => {
        if (!Array.isArray(reports)) return
        const sorted = [...reports].sort((a, b) => a.pin_order - b.pin_order)
        setPinnedReports(sorted)
        sorted.forEach((report) => {
          fetch(`/api/reports/${report.id}/data`)
            .then((r) => (r.ok ? r.json() : []))
            .then((data: ReportDataRow[]) => {
              if (Array.isArray(data)) {
                setPinnedReportData((prev) => ({ ...prev, [report.id]: data }))
              }
            })
            .catch(() => {})
        })
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    fetchPinnedReports()
  }, [fetchPinnedReports])

  const handleReorder = (reportId: string, direction: 'up' | 'down') => {
    setPinnedReports((prev) => {
      const idx = prev.findIndex((r) => r.id === reportId)
      if (idx === -1) return prev
      const newIdx = direction === 'up' ? idx - 1 : idx + 1
      if (newIdx < 0 || newIdx >= prev.length) return prev
      const updated = [...prev]
      const temp = updated[idx]!
      updated[idx] = { ...updated[newIdx]!, pin_order: temp.pin_order }
      updated[newIdx] = { ...temp, pin_order: updated[idx]!.pin_order }
      // Re-assign sequential pin_order values
      const reordered = updated.map((r, i) => ({ ...r, pin_order: i + 1 }))
      // Persist new order
      reordered.forEach((r) => {
        fetch(`/api/reports/${r.id}/pin`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pin_order: r.pin_order }),
        }).catch(() => {})
      })
      return reordered
    })
  }

  // Pipeline Forecast state
  const [pipelines, setPipelines] = useState<Pipeline[]>([])
  const [selectedPipelineId, setSelectedPipelineId] = useState<string>('')
  const [forecastData, setForecastData] = useState<PipelineForecastData | null>(null)
  const [funnelData, setFunnelData] = useState<FunnelStage[]>([])
  const [forecastLoading, setForecastLoading] = useState(false)

  // Fetch available deal pipelines on mount
  useEffect(() => {
    fetch('/api/pipelines?type=deals')
      .then((r) => r.json())
      .then((data: Pipeline[]) => {
        if (Array.isArray(data) && data.length > 0) {
          setPipelines(data)
          setSelectedPipelineId(data[0]!.id)
        }
      })
      .catch(() => {})
  }, [])

  // Fetch forecast + funnel when selected pipeline changes
  useEffect(() => {
    if (!selectedPipelineId) return
    setForecastLoading(true)
    Promise.all([
      fetch(`/api/insights/pipeline-forecast?pipeline_id=${selectedPipelineId}`).then((r) =>
        r.json()
      ),
      fetch(`/api/insights/pipeline-funnel?pipeline_id=${selectedPipelineId}`).then((r) =>
        r.json()
      ),
    ])
      .then(([forecast, funnel]: [PipelineForecastData, FunnelStage[]]) => {
        setForecastData(forecast)
        setFunnelData(Array.isArray(funnel) ? funnel : [])
      })
      .catch(() => {})
      .finally(() => setForecastLoading(false))
  }, [selectedPipelineId])

  // Compute "Expected This Month" and MoM comparison from forecast data
  const currentMonth = new Date().toISOString().slice(0, 7)
  const monthlyForecast = forecastData?.summary?.monthly_forecast ?? []
  const currentMonthEntry = monthlyForecast.find((m) => m.month === currentMonth)
  const prevMonthStr = (() => {
    const d = new Date()
    d.setMonth(d.getMonth() - 1)
    return d.toISOString().slice(0, 7)
  })()
  const prevMonthEntry = monthlyForecast.find((m) => m.month === prevMonthStr)
  const expectedThisMonth = currentMonthEntry?.expected_value ?? 0
  const momPct =
    prevMonthEntry && prevMonthEntry.expected_value > 0
      ? (
          ((expectedThisMonth - prevMonthEntry.expected_value) / prevMonthEntry.expected_value) *
          100
        ).toFixed(0)
      : null

  // Widget order — DnD reordering
  const [widgetOrder, setWidgetOrder] = useState<string[]>(DEFAULT_ORDER)

  useEffect(() => {
    try {
      const raw = localStorage.getItem(LS_KEY)
      if (raw) {
        const parsed = JSON.parse(raw) as string[]
        const valid = parsed.filter((id) => DEFAULT_ORDER.includes(id))
        const missing = DEFAULT_ORDER.filter((id) => !valid.includes(id))
        setWidgetOrder([...valid, ...missing])
      }
    } catch {
      // ignore storage errors
    }
  }, [])

  function handleWidgetDragEnd(result: DropResult) {
    if (!result.destination) return
    if (result.source.index === result.destination.index) return
    const next = [...widgetOrder]
    const [moved] = next.splice(result.source.index, 1)
    next.splice(result.destination.index, 0, moved!)
    setWidgetOrder(next)
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(next))
    } catch {
      // ignore storage errors
    }
  }

  function resetWidgetOrder() {
    setWidgetOrder(DEFAULT_ORDER)
    try {
      localStorage.removeItem(LS_KEY)
    } catch {
      // ignore storage errors
    }
  }

  function renderWidget(id: string): React.ReactNode {
    switch (id) {
      case 'call_stats':
        return (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatCard
              label="Total Calls"
              value={String(stats.totalCalls)}
              sub={`${stats.bookings} bookings`}
            />
            <StatCard
              label="Avg Response Time"
              value={stats.avgLatency != null ? `${(stats.avgLatency / 1000).toFixed(1)}s` : '--'}
              color={latencyColor}
              sub="first response"
            />
            <StatCard
              label="Booking Rate"
              value={`${bookingRate}%`}
              sub={`${stats.bookings} of ${stats.totalCalls} calls`}
              color="text-teal-600"
            />
            <StatCard
              label="Call Quality"
              value={stats.avgMos != null ? stats.avgMos.toFixed(2) : '--'}
              sub={mosLabel}
            />
          </div>
        )

      case 'call_volume':
        return (
          <div className="bg-white rounded-xl border border-border-brand p-6">
            <h2 className="text-sm font-semibold text-ink mb-4">Call Volume</h2>
            {stats.dailyVolume.length === 0 ? (
              <p className="text-sm text-ink4 py-8 text-center">No call data yet</p>
            ) : (
              <div style={{ width: '100%', minWidth: 0, overflowX: 'auto' }}>
                <div style={{ minWidth: 320 }}>
                  <ResponsiveContainer width="100%" height={250}>
                    <LineChart data={stats.dailyVolume}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                      <XAxis dataKey="date" tick={{ fontSize: 11 }} stroke="#9ca3af" />
                      <YAxis tick={{ fontSize: 11 }} stroke="#9ca3af" allowDecimals={false} />
                      <Tooltip />
                      <Line
                        type="monotone"
                        dataKey="calls"
                        stroke="#0d9488"
                        strokeWidth={2}
                        dot={false}
                        name="Calls"
                      />
                      <Line
                        type="monotone"
                        dataKey="bookings"
                        stroke="#10b981"
                        strokeWidth={2}
                        dot={false}
                        name="Bookings"
                      />
                      <Legend />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}
          </div>
        )

      case 'outcomes_hours':
        return (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-white rounded-xl border border-border-brand p-6">
              <h2 className="text-sm font-semibold text-ink mb-4">Call Outcomes</h2>
              {stats.outcomeData.length === 0 ? (
                <p className="text-sm text-ink4 py-8 text-center">No data</p>
              ) : (
                <ResponsiveContainer width="100%" height={220}>
                  <PieChart>
                    <Pie
                      data={stats.outcomeData}
                      cx="50%"
                      cy="50%"
                      innerRadius={50}
                      outerRadius={80}
                      dataKey="value"
                      label={({ name, percent }) => `${name} ${((percent ?? 0) * 100).toFixed(0)}%`}
                    >
                      {stats.outcomeData.map((entry, i) => (
                        <Cell key={i} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </div>
            <div className="bg-white rounded-xl border border-border-brand p-6">
              <h2 className="text-sm font-semibold text-ink mb-4">Peak Hours</h2>
              <div style={{ width: '100%', minWidth: 0, overflowX: 'auto' }}>
                <div style={{ minWidth: 320 }}>
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={stats.peakHours}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                      <XAxis dataKey="hour" tick={{ fontSize: 9 }} stroke="#9ca3af" interval={2} />
                      <YAxis tick={{ fontSize: 11 }} stroke="#9ca3af" allowDecimals={false} />
                      <Tooltip />
                      <Bar dataKey="calls" fill="#0d9488" radius={[2, 2, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>
          </div>
        )

      case 'pipeline_dist':
        return (
          <div className="bg-white rounded-xl border border-border-brand p-6">
            <h2 className="text-sm font-semibold text-ink mb-4">Pipeline Distribution</h2>
            {stats.stageDistribution.length === 0 ? (
              <p className="text-sm text-ink4 py-8 text-center">No pipeline data</p>
            ) : (
              <>
                <div style={{ width: '100%', minWidth: 0, overflowX: 'auto' }}>
                  <div style={{ minWidth: 320 }}>
                    <ResponsiveContainer width="100%" height={200}>
                      <BarChart data={stats.stageDistribution} layout="vertical">
                        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                        <XAxis
                          type="number"
                          tick={{ fontSize: 11 }}
                          stroke="#9ca3af"
                          allowDecimals={false}
                        />
                        <YAxis
                          dataKey="stage"
                          type="category"
                          tick={{ fontSize: 11 }}
                          stroke="#9ca3af"
                          width={120}
                        />
                        <Tooltip />
                        <Bar dataKey="count" fill="#0d9488" radius={[0, 4, 4, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
                <div className="flex items-center gap-4 mt-3 text-xs text-ink3">
                  <span>
                    Conversion rate:{' '}
                    <strong className="text-teal-600">
                      {stats.pipelineTotal > 0
                        ? ((stats.wonCount / stats.pipelineTotal) * 100).toFixed(1)
                        : 0}
                      %
                    </strong>
                  </span>
                  <span>
                    Total: <strong>{stats.pipelineTotal}</strong> contacts in pipeline
                  </span>
                </div>
              </>
            )}
          </div>
        )

      case 'roi_summary':
        return (
          <div className="bg-gradient-to-r from-teal-600 to-teal-700 rounded-xl p-6 text-white">
            <h2 className="text-sm font-semibold opacity-80 mb-4">ROI Summary</h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
              <div>
                <p className="text-xs opacity-70">Maya Cost</p>
                <p className="text-xl font-bold">${stats.totalMayaCost.toFixed(2)}</p>
              </div>
              <div>
                <p className="text-xs opacity-70">Receptionist Cost</p>
                <p className="text-xl font-bold">$2,500/mo</p>
              </div>
              <div>
                <p className="text-xs opacity-70">You Saved</p>
                <p className="text-2xl font-bold">${stats.monthlySavings.toLocaleString()}</p>
              </div>
              <div>
                <p className="text-xs opacity-70">ROI</p>
                <p className="text-2xl font-bold">{stats.roiMultiplier}x</p>
              </div>
            </div>
            {stats.bookingTrend.length > 0 && (
              <ResponsiveContainer width="100%" height={150}>
                <AreaChart data={stats.bookingTrend}>
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 10, fill: '#fff' }}
                    stroke="rgba(255,255,255,0.3)"
                  />
                  <YAxis
                    tick={{ fontSize: 10, fill: '#fff' }}
                    stroke="rgba(255,255,255,0.3)"
                    allowDecimals={false}
                  />
                  <Tooltip />
                  <Area
                    type="monotone"
                    dataKey="ai"
                    stackId="1"
                    fill="rgba(255,255,255,0.4)"
                    stroke="#fff"
                    name="AI Bookings"
                  />
                  <Area
                    type="monotone"
                    dataKey="human"
                    stackId="1"
                    fill="rgba(255,255,255,0.15)"
                    stroke="rgba(255,255,255,0.5)"
                    name="Human Bookings"
                  />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
        )

      case 'revenue_forecast':
        return (
          <div className="bg-white rounded-xl border border-border-brand p-6">
            <h2 className="text-sm font-semibold text-ink mb-2">Revenue Forecast</h2>
            <p className="text-xs text-ink4 mb-4">Based on current booking trends</p>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <p className="text-xs text-ink4">Projected Monthly Bookings</p>
                <p className="text-xl font-bold text-ink">{stats.projectedMonthlyBookings}</p>
              </div>
              <div>
                <p className="text-xs text-ink4">Avg Appointment Value</p>
                <p className="text-xl font-bold text-ink">${stats.avgApptValue}</p>
              </div>
              <div>
                <p className="text-xs text-ink4">Projected Monthly Revenue</p>
                <p className="text-xl font-bold text-teal-600">
                  ${stats.projectedRevenue.toLocaleString()}
                </p>
              </div>
            </div>
            <p className="text-[10px] text-gray-300 mt-3">
              Estimate based on current booking rate and average appointment value for your
              vertical. Not a guarantee of future revenue.
            </p>
          </div>
        )

      case 'lang_sources':
        return (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-white rounded-xl border border-border-brand p-6">
              <h2 className="text-sm font-semibold text-ink mb-4">Languages</h2>
              {stats.langData.length === 0 ? (
                <p className="text-sm text-ink4 py-8 text-center">No data</p>
              ) : (
                <ResponsiveContainer width="100%" height={200}>
                  <PieChart>
                    <Pie
                      data={stats.langData}
                      cx="50%"
                      cy="50%"
                      outerRadius={70}
                      dataKey="value"
                      label={({ name, percent }) => `${name} ${((percent ?? 0) * 100).toFixed(0)}%`}
                    >
                      {stats.langData.map((_, i) => (
                        <Cell key={i} fill={LANG_COLORS[i % LANG_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </div>
            <div className="bg-white rounded-xl border border-border-brand p-6">
              <h2 className="text-sm font-semibold text-ink mb-4">Contact Sources</h2>
              {stats.sourceData.length === 0 ? (
                <p className="text-sm text-ink4 py-8 text-center">No data</p>
              ) : (
                <ResponsiveContainer width="100%" height={200}>
                  <PieChart>
                    <Pie
                      data={stats.sourceData}
                      cx="50%"
                      cy="50%"
                      outerRadius={70}
                      dataKey="value"
                      label={({ name, percent }) => `${name} ${((percent ?? 0) * 100).toFixed(0)}%`}
                    >
                      {stats.sourceData.map((_, i) => (
                        <Cell key={i} fill={SOURCE_COLORS[i % SOURCE_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>
        )

      case 'followup':
        return (
          <div className="bg-white rounded-xl border border-border-brand p-6">
            <h2 className="text-sm font-semibold text-ink mb-4">Follow-up Performance</h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
              <div>
                <p className="text-xs text-ink4">Active Sequences</p>
                <p className="text-lg font-bold text-ink">{stats.activeSeq}</p>
              </div>
              <div>
                <p className="text-xs text-ink4">Completed</p>
                <p className="text-lg font-bold text-ink">{stats.completedSeq}</p>
              </div>
              <div>
                <p className="text-xs text-ink4">Step 1</p>
                <p className="text-lg font-bold text-ink">{stats.stepDist['step_1']}</p>
              </div>
              <div>
                <p className="text-xs text-ink4">Step 2</p>
                <p className="text-lg font-bold text-ink">{stats.stepDist['step_2']}</p>
              </div>
            </div>
            <div className="h-4 rounded-full bg-bg2 overflow-hidden flex">
              {stats.stepDist['step_1']! > 0 && (
                <div
                  className="bg-blue-400 h-full"
                  style={{
                    width: `${(stats.stepDist['step_1']! / Math.max(stats.activeSeq + stats.completedSeq, 1)) * 100}%`,
                  }}
                  title={`Step 1: ${stats.stepDist['step_1']}`}
                />
              )}
              {stats.stepDist['step_2']! > 0 && (
                <div
                  className="bg-teal-400 h-full"
                  style={{
                    width: `${(stats.stepDist['step_2']! / Math.max(stats.activeSeq + stats.completedSeq, 1)) * 100}%`,
                  }}
                  title={`Step 2: ${stats.stepDist['step_2']}`}
                />
              )}
              {stats.stepDist['completed']! > 0 && (
                <div
                  className="bg-green-400 h-full"
                  style={{
                    width: `${(stats.stepDist['completed']! / Math.max(stats.activeSeq + stats.completedSeq, 1)) * 100}%`,
                  }}
                  title={`Completed: ${stats.stepDist['completed']}`}
                />
              )}
            </div>
            <div className="flex items-center gap-4 mt-2 text-[10px] text-ink4">
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-blue-400 inline-block" /> Step 1
              </span>
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-teal-400 inline-block" /> Step 2
              </span>
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-green-400 inline-block" /> Completed
              </span>
            </div>
          </div>
        )

      case 'quotes':
        return (
          <div className="bg-white rounded-xl border border-border-brand p-6">
            <h2 className="text-sm font-semibold text-ink mb-4">Quote Performance</h2>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
              <div>
                <p className="text-xs text-ink4">Total Quotes</p>
                <p className="text-lg font-bold text-ink">{stats.totalQuotes}</p>
              </div>
              <div>
                <p className="text-xs text-ink4">Win Rate</p>
                <p
                  className={`text-lg font-bold ${stats.winRate > 50 ? 'text-green-600' : stats.winRate < 30 ? 'text-red-600' : 'text-ink'}`}
                >
                  {stats.winRate}%
                </p>
              </div>
              <div>
                <p className="text-xs text-ink4">Open Rate</p>
                <p
                  className={`text-lg font-bold ${stats.quoteOpenRate > 70 ? 'text-green-600' : stats.quoteOpenRate >= 40 ? 'text-amber-600' : 'text-red-600'}`}
                >
                  {stats.quoteOpenRate}%
                </p>
                {stats.avgTimeToFirstViewHours != null && (
                  <p className="text-[11px] text-ink4 mt-0.5">
                    Avg time to open: {stats.avgTimeToFirstViewHours}h
                  </p>
                )}
              </div>
              <div>
                <p className="text-xs text-ink4">Avg Deal Size</p>
                <p className="text-lg font-bold text-ink">${stats.avgDealSize.toLocaleString()}</p>
              </div>
              <div>
                <p className="text-xs text-ink4">Revenue Won</p>
                <p className="text-lg font-bold text-teal-600">
                  ${stats.totalRevWon.toLocaleString()}
                </p>
              </div>
            </div>

            {stats.totalQuotes > 0 && (
              <div className="mb-6">
                <p className="text-xs text-ink4 mb-2">Quote Funnel</p>
                <ResponsiveContainer width="100%" height={160}>
                  <BarChart data={stats.funnelData} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis
                      type="number"
                      tick={{ fontSize: 11 }}
                      stroke="#9ca3af"
                      allowDecimals={false}
                    />
                    <YAxis
                      dataKey="stage"
                      type="category"
                      tick={{ fontSize: 11 }}
                      stroke="#9ca3af"
                      width={80}
                    />
                    <Tooltip />
                    <Bar dataKey="count" radius={[0, 4, 4, 0]}>
                      {stats.funnelData.map((_, i) => (
                        <Cell key={i} fill={FUNNEL_COLORS[i % FUNNEL_COLORS.length]} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
                <div className="flex items-center gap-3 mt-2 text-[10px] text-ink4">
                  {stats.funnelData.slice(1).map((stage, i) => {
                    const prev = stats.funnelData[i]!.count
                    const pct = prev > 0 ? ((stage.count / prev) * 100).toFixed(0) : '0'
                    return (
                      <span key={stage.stage}>
                        {stats.funnelData[i]!.stage} → {stage.stage}: {pct}%
                      </span>
                    )
                  })}
                </div>
              </div>
            )}

            {stats.quoteTrend.length > 0 && (
              <div className="mb-6">
                <p className="text-xs text-ink4 mb-2">Quote Volume</p>
                <ResponsiveContainer width="100%" height={180}>
                  <LineChart data={stats.quoteTrend}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis dataKey="date" tick={{ fontSize: 10 }} stroke="#9ca3af" />
                    <YAxis tick={{ fontSize: 11 }} stroke="#9ca3af" allowDecimals={false} />
                    <Tooltip />
                    <Line
                      type="monotone"
                      dataKey="created"
                      stroke="#0d9488"
                      strokeWidth={2}
                      dot={false}
                      name="Created"
                    />
                    <Line
                      type="monotone"
                      dataKey="accepted"
                      stroke="#10b981"
                      strokeWidth={2}
                      dot={false}
                      name="Accepted"
                    />
                    <Legend />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}

            <div className="mb-6">
              <p className="text-xs text-ink4 mb-2">Top Packages</p>
              {stats.topPackages.length === 0 ? (
                <p className="text-sm text-gray-300 text-center py-4">
                  No packages added to quotes yet
                </p>
              ) : (
                <div className="space-y-2">
                  {stats.topPackages.map((pkg, i) => (
                    <div
                      key={i}
                      className="flex items-center justify-between py-2 border-b border-gray-50 last:border-0"
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-ink4 w-4">{i + 1}.</span>
                        <span className="text-sm text-ink">{pkg.package_name}</span>
                        <span className="text-[10px] bg-indigo-50 text-indigo-600 px-1.5 py-0.5 rounded">
                          {pkg.vertical}
                        </span>
                      </div>
                      <div className="flex items-center gap-4 text-xs text-ink3">
                        <span>{pkg.quote_count} quotes</span>
                        <span>${pkg.total_revenue.toLocaleString()}</span>
                        <span className={pkg.win_rate > 50 ? 'text-green-600' : ''}>
                          {pkg.win_rate}% win
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {stats.aiQuotes > 0 && (
              <div className="bg-teal-50 rounded-lg p-4">
                <p className="text-xs text-teal-600 font-medium">AI-Generated Quotes</p>
                <p className="text-sm text-teal-800 mt-1">
                  Maya auto-generated {stats.aiQuotes} quote{stats.aiQuotes !== 1 ? 's' : ''},{' '}
                  {stats.aiQuotes > 0
                    ? `${((stats.aiAccepted / stats.aiQuotes) * 100).toFixed(0)}% accepted`
                    : '0% accepted'}
                </p>
              </div>
            )}
          </div>
        )

      case 'pipeline_forecast':
        if (pipelines.length === 0) return null
        return (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-base font-semibold text-ink">Pipeline Forecast</h2>
                <p className="text-xs text-ink4 mt-0.5">Deal pipeline revenue projections</p>
              </div>
              <select
                value={selectedPipelineId}
                onChange={(e) => setSelectedPipelineId(e.target.value)}
                className="text-sm border border-border-brand rounded-lg px-3 py-1.5 text-ink2 bg-white focus:outline-none focus:ring-2 focus:ring-teal-500"
              >
                {pipelines.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>

            {forecastLoading ? (
              <div className="bg-white rounded-xl border border-border-brand p-8 text-center">
                <p className="text-sm text-ink4">Loading forecast...</p>
              </div>
            ) : forecastData ? (
              <>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <StatCard
                    label="Total Pipeline Value"
                    value={formatCurrency(forecastData.summary.total_pipeline_value)}
                    sub={`${forecastData.summary.deal_count} deals`}
                  />
                  <StatCard
                    label="Weighted Forecast"
                    value={formatCurrency(forecastData.summary.total_weighted_value)}
                    sub="probability-adjusted"
                    color="text-teal-600"
                  />
                  <StatCard
                    label="Win Rate"
                    value={`${forecastData.summary.win_rate.toFixed(1)}%`}
                    color={
                      forecastData.summary.win_rate > 50
                        ? 'text-green-600'
                        : forecastData.summary.win_rate < 30
                          ? 'text-red-600'
                          : 'text-ink'
                    }
                  />
                  <StatCard
                    label="Avg Days to Close"
                    value={
                      forecastData.summary.avg_days_to_close > 0
                        ? `${Math.round(forecastData.summary.avg_days_to_close)}d`
                        : '--'
                    }
                    sub="average sales cycle"
                  />
                </div>

                <div className="bg-gradient-to-r from-indigo-600 to-indigo-700 rounded-xl p-6 text-white">
                  <p className="text-xs font-medium opacity-70 uppercase tracking-wide mb-1">
                    Expected This Month
                  </p>
                  <p className="text-4xl font-bold">{formatCurrency(expectedThisMonth)}</p>
                  {momPct !== null && (
                    <p className="text-sm mt-2 opacity-90">
                      {Number(momPct) >= 0 ? '↑' : '↓'} {Math.abs(Number(momPct))}% vs last month
                    </p>
                  )}
                  {currentMonthEntry && (
                    <p className="text-xs mt-1 opacity-60">
                      {currentMonthEntry.deal_count} deals closing this month
                    </p>
                  )}
                </div>

                {monthlyForecast.length > 0 && (
                  <div className="bg-white rounded-xl border border-border-brand p-6">
                    <h3 className="text-sm font-semibold text-ink mb-4">
                      Monthly Forecast (next 3 months)
                    </h3>
                    <ResponsiveContainer width="100%" height={220}>
                      <BarChart data={monthlyForecast.slice(0, 3)}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                        <XAxis dataKey="month" tick={{ fontSize: 11 }} stroke="#9ca3af" />
                        <YAxis
                          tick={{ fontSize: 11 }}
                          stroke="#9ca3af"
                          tickFormatter={(v: number) => formatCurrency(v)}
                        />
                        <Tooltip
                          formatter={(value, _name, item) => [
                            `${formatCurrency(Number(value))} (${(item?.payload as MonthlyForecast | undefined)?.deal_count ?? 0} deals)`,
                            'Expected Revenue',
                          ]}
                        />
                        <Bar
                          dataKey="expected_value"
                          fill="#6366f1"
                          radius={[4, 4, 0, 0]}
                          name="Expected Revenue"
                        />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}

                {funnelData.length > 0 && (
                  <div className="bg-white rounded-xl border border-border-brand p-6">
                    <h3 className="text-sm font-semibold text-ink mb-4">Pipeline Funnel</h3>
                    <ResponsiveContainer
                      width="100%"
                      height={Math.max(160, funnelData.length * 44)}
                    >
                      <BarChart data={funnelData} layout="vertical">
                        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                        <XAxis
                          type="number"
                          tick={{ fontSize: 11 }}
                          stroke="#9ca3af"
                          allowDecimals={false}
                        />
                        <YAxis
                          dataKey="stage"
                          type="category"
                          tick={{ fontSize: 11 }}
                          stroke="#9ca3af"
                          width={120}
                        />
                        <Tooltip formatter={(value) => [value, 'Deals']} />
                        <Bar dataKey="count" radius={[0, 4, 4, 0]}>
                          {funnelData.map((_, i) => (
                            <Cell key={i} fill={STAGE_COLORS[i % STAGE_COLORS.length]} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                    <div className="flex flex-wrap items-center gap-3 mt-3 text-[10px] text-ink4">
                      {funnelData.slice(1).map((stage, i) => (
                        <span key={stage.stage}>
                          {funnelData[i]!.stage} → {stage.stage}:{' '}
                          <span className="text-red-400">-{stage.drop_off_pct.toFixed(0)}%</span>
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div className="bg-white rounded-xl border border-border-brand p-8 text-center">
                <p className="text-sm text-ink4">No forecast data available</p>
              </div>
            )}
          </div>
        )

      case 'custom_reports':
        return pinnedReports.length > 0 ? (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold text-ink">Custom Reports</h2>
              <a href="/reports" className="text-sm text-teal-600 hover:text-teal-700 font-medium">
                Manage Reports →
              </a>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {pinnedReports.map((report, idx) => {
                const data = pinnedReportData[report.id] ?? []
                const keys = data.length > 0 ? Object.keys(data[0]!) : []
                const valueKey = keys.find((k) => k !== keys[0]) ?? keys[0] ?? 'value'
                const labelKey = keys[0] ?? 'label'

                return (
                  <div
                    key={report.id}
                    className="bg-white rounded-xl border border-border-brand p-5 cursor-pointer hover:border-teal-200 hover:shadow-sm transition-all relative group"
                    onClick={() => router.push(`/reports/${report.id}`)}
                  >
                    <div
                      className="absolute top-3 right-3 flex flex-col gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <button
                        disabled={idx === 0}
                        onClick={() => handleReorder(report.id, 'up')}
                        className="w-6 h-6 flex items-center justify-center rounded text-ink4 hover:bg-bg2 hover:text-ink2 disabled:opacity-20 disabled:cursor-not-allowed text-xs"
                        title="Move up"
                      >
                        ↑
                      </button>
                      <button
                        disabled={idx === pinnedReports.length - 1}
                        onClick={() => handleReorder(report.id, 'down')}
                        className="w-6 h-6 flex items-center justify-center rounded text-ink4 hover:bg-bg2 hover:text-ink2 disabled:opacity-20 disabled:cursor-not-allowed text-xs"
                        title="Move down"
                      >
                        ↓
                      </button>
                    </div>

                    <p className="text-sm font-semibold text-ink mb-3 pr-8">{report.name}</p>

                    {data.length === 0 ? (
                      <p className="text-xs text-gray-300 py-8 text-center">No data</p>
                    ) : report.chart_type === 'bar' ? (
                      <ResponsiveContainer width="100%" height={200}>
                        <BarChart data={data}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                          <XAxis dataKey={labelKey} tick={{ fontSize: 10 }} stroke="#9ca3af" />
                          <YAxis tick={{ fontSize: 10 }} stroke="#9ca3af" />
                          <Tooltip />
                          <Bar dataKey={valueKey} radius={[3, 3, 0, 0]}>
                            {data.map((_, i) => (
                              <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                            ))}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    ) : report.chart_type === 'line' ? (
                      <ResponsiveContainer width="100%" height={200}>
                        <LineChart data={data}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                          <XAxis dataKey={labelKey} tick={{ fontSize: 10 }} stroke="#9ca3af" />
                          <YAxis tick={{ fontSize: 10 }} stroke="#9ca3af" />
                          <Tooltip />
                          <Line
                            type="monotone"
                            dataKey={valueKey}
                            stroke={CHART_COLORS[0]}
                            strokeWidth={2}
                            dot={false}
                          />
                        </LineChart>
                      </ResponsiveContainer>
                    ) : report.chart_type === 'pie' ? (
                      <ResponsiveContainer width="100%" height={200}>
                        <PieChart>
                          <Pie
                            data={data}
                            cx="50%"
                            cy="50%"
                            outerRadius={70}
                            dataKey={valueKey}
                            nameKey={labelKey}
                            label={({ name, percent }) =>
                              `${name} ${((percent ?? 0) * 100).toFixed(0)}%`
                            }
                          >
                            {data.map((_, i) => (
                              <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                            ))}
                          </Pie>
                          <Tooltip />
                        </PieChart>
                      </ResponsiveContainer>
                    ) : report.chart_type === 'number' ? (
                      <div className="flex items-center justify-center h-[200px]">
                        <p className="text-5xl font-bold text-ink">
                          {String(data[0]?.[valueKey] ?? '--')}
                        </p>
                      </div>
                    ) : report.chart_type === 'table' ? (
                      <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="border-b border-border-brand">
                              {keys.map((k) => (
                                <th key={k} className="text-left text-ink4 font-medium py-1.5 pr-3">
                                  {k}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {data.slice(0, 3).map((row, i) => (
                              <tr key={i} className="border-b border-gray-50 last:border-0">
                                {keys.map((k) => (
                                  <td key={k} className="py-1.5 pr-3 text-ink2">
                                    {String(row[k] ?? '')}
                                  </td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : null}
                  </div>
                )
              })}
            </div>
          </div>
        ) : (
          <p className="text-sm text-ink4 text-center py-4">
            <a href="/reports" className="hover:text-teal-600 transition-colors">
              Pin custom reports to see them here →
            </a>
          </p>
        )

      case 'territory_perf':
        if (territoryLoading || !hasTerritoryData) return null
        return (
          <div className="bg-white rounded-xl border border-border-brand p-6">
            <h2 className="text-sm font-semibold text-ink mb-4">Territory Performance</h2>

            <div className="mb-6">
              <p className="text-xs text-ink4 mb-2">Contacts by Territory</p>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={territoryData} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis
                    type="number"
                    tick={{ fontSize: 11 }}
                    stroke="#9ca3af"
                    allowDecimals={false}
                  />
                  <YAxis
                    dataKey="territory"
                    type="category"
                    tick={{ fontSize: 11 }}
                    stroke="#9ca3af"
                    width={100}
                  />
                  <Tooltip />
                  <Bar
                    dataKey="contacts_count"
                    fill="#0d9488"
                    radius={[0, 4, 4, 0]}
                    name="Contacts"
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border-brand">
                    <th className="text-left text-ink4 font-medium py-2 pr-4">Territory</th>
                    <th className="text-right text-ink4 font-medium py-2 pr-4">Contacts</th>
                    <th className="text-right text-ink4 font-medium py-2 pr-4">Customers</th>
                    <th className="text-right text-ink4 font-medium py-2">Conversion</th>
                  </tr>
                </thead>
                <tbody>
                  {territoryData.map((row) => (
                    <tr key={row.territory} className="border-b border-gray-50 last:border-0">
                      <td className="py-2 pr-4 text-ink font-medium">{row.territory}</td>
                      <td className="py-2 pr-4 text-right text-ink3">{row.contacts_count}</td>
                      <td className="py-2 pr-4 text-right text-ink3">{row.customers_count}</td>
                      <td className="py-2 text-right">
                        <span
                          className={
                            row.conversion_rate >= 50
                              ? 'text-green-600 font-medium'
                              : row.conversion_rate >= 25
                                ? 'text-amber-600'
                                : 'text-ink3'
                          }
                        >
                          {row.conversion_rate.toFixed(1)}%
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )

      case 'campaign_perf':
        if (!campaignInsights) return null
        return (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-base font-semibold text-ink">Campaign Performance</h2>
                <p className="text-xs text-ink4 mt-0.5">AI-powered multi-channel campaigns</p>
              </div>
              {campaignInsights.summary !== null && (
                <a
                  href="/campaigns"
                  className="text-sm text-teal-600 hover:text-teal-700 font-medium"
                >
                  View Campaigns →
                </a>
              )}
            </div>

            {campaignInsights.summary === null ? (
              <div className="bg-white rounded-xl border border-border-brand px-8 py-12 text-center">
                <div className="text-4xl mb-3">📣</div>
                <h3 className="text-sm font-semibold text-ink mb-2">Campaigns not enabled</h3>
                <p className="text-sm text-ink3 mb-4 max-w-xs mx-auto">
                  Enable AI-powered campaigns to reach clients via SMS and email.
                </p>
                <a
                  href="/settings/modules"
                  className="px-4 py-2 bg-teal-600 text-white text-sm font-medium rounded-lg hover:bg-teal-700 transition-colors"
                >
                  Enable Campaigns →
                </a>
              </div>
            ) : (
              <>
                {/* Stat tiles */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <StatCard
                    label="Campaigns"
                    value={String(campaignInsights.summary.total_campaigns)}
                    sub="total"
                  />
                  <StatCard
                    label="Messages Sent"
                    value={campaignInsights.summary.total_sent.toLocaleString()}
                  />
                  <StatCard
                    label="Avg Delivery Rate"
                    value={`${campaignInsights.summary.avg_delivery_rate}%`}
                    color={
                      campaignInsights.summary.avg_delivery_rate >= 90
                        ? 'text-green-600'
                        : campaignInsights.summary.avg_delivery_rate >= 70
                          ? 'text-amber-600'
                          : 'text-red-600'
                    }
                  />
                  <StatCard
                    label="Avg Open Rate"
                    value={`${campaignInsights.summary.avg_open_rate}%`}
                    color="text-teal-600"
                    sub={
                      campaignInsights.summary.top_channel
                        ? `Top channel: ${campaignInsights.summary.top_channel}`
                        : undefined
                    }
                  />
                </div>

                {/* Daily send volume chart */}
                {campaignInsights.by_day.length > 0 && (
                  <div className="bg-white rounded-xl border border-border-brand p-6">
                    <h3 className="text-sm font-semibold text-ink mb-4">Daily Send Volume</h3>
                    <div style={{ width: '100%', minWidth: 0, overflowX: 'auto' }}>
                      <div style={{ minWidth: 320 }}>
                        <ResponsiveContainer width="100%" height={220}>
                          <LineChart data={campaignInsights.by_day}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                            <XAxis dataKey="date" tick={{ fontSize: 11 }} stroke="#9ca3af" />
                            <YAxis tick={{ fontSize: 11 }} stroke="#9ca3af" allowDecimals={false} />
                            <Tooltip />
                            <Line
                              type="monotone"
                              dataKey="sent"
                              stroke="#3b82f6"
                              strokeWidth={2}
                              dot={false}
                              name="Sent"
                            />
                            <Line
                              type="monotone"
                              dataKey="delivered"
                              stroke="#10b981"
                              strokeWidth={2}
                              dot={false}
                              name="Delivered"
                            />
                            <Legend />
                          </LineChart>
                        </ResponsiveContainer>
                      </div>
                    </div>
                  </div>
                )}

                {/* Recent campaigns table */}
                {campaignInsights.recent_campaigns.length > 0 && (
                  <div className="bg-white rounded-xl border border-border-brand overflow-hidden">
                    <div className="px-6 py-4 border-b border-border-brand">
                      <h3 className="text-sm font-semibold text-ink">Recent Campaigns</h3>
                    </div>
                    <table className="w-full">
                      <thead>
                        <tr className="border-b border-border-brand">
                          <th className="text-left px-6 py-3 text-xs font-semibold text-ink4 uppercase tracking-wide">
                            Name
                          </th>
                          <th className="text-right px-4 py-3 text-xs font-semibold text-ink4 uppercase tracking-wide">
                            Sent
                          </th>
                          <th className="text-right px-4 py-3 text-xs font-semibold text-ink4 uppercase tracking-wide">
                            Delivery
                          </th>
                          <th className="text-right px-6 py-3 text-xs font-semibold text-ink4 uppercase tracking-wide">
                            Opt-out
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-50">
                        {campaignInsights.recent_campaigns.map((c) => (
                          <tr key={c.id} className="hover:bg-gray-50/50 transition-colors">
                            <td className="px-6 py-3">
                              <a
                                href={`/campaigns/${c.id}/performance`}
                                className="text-sm font-medium text-ink hover:text-teal-700 transition-colors"
                              >
                                {c.name}
                              </a>
                              {c.sent_at && (
                                <p className="text-xs text-ink4 mt-0.5">
                                  {new Date(c.sent_at).toLocaleDateString()}
                                </p>
                              )}
                            </td>
                            <td className="px-4 py-3 text-right text-sm text-ink2">
                              {c.total_sent.toLocaleString()}
                            </td>
                            <td className="px-4 py-3 text-right text-sm">
                              <span
                                className={
                                  c.delivery_rate >= 90
                                    ? 'text-green-600'
                                    : c.delivery_rate >= 70
                                      ? 'text-amber-600'
                                      : 'text-red-600'
                                }
                              >
                                {c.delivery_rate}%
                              </span>
                            </td>
                            <td className="px-6 py-3 text-right text-sm">
                              <span
                                className={
                                  c.opt_out_rate > 3
                                    ? 'text-red-600 font-medium'
                                    : c.opt_out_rate > 1
                                      ? 'text-amber-600'
                                      : 'text-ink3'
                                }
                              >
                                {c.opt_out_rate}%
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {campaignInsights.recent_campaigns.length === 0 &&
                  campaignInsights.by_day.length === 0 && (
                    <div className="bg-white rounded-xl border border-border-brand px-8 py-12 text-center">
                      <p className="text-sm text-ink3">No campaign data in the selected period.</p>
                      <a
                        href="/campaigns/new"
                        className="mt-4 inline-block text-sm text-teal-600 hover:text-teal-700 font-medium"
                      >
                        Create your first campaign →
                      </a>
                    </div>
                  )}
              </>
            )}
          </div>
        )

      default:
        return null
    }
  }

  return (
    <DragDropContext onDragEnd={handleWidgetDragEnd}>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-ink">Insights</h1>
            <p className="text-sm text-ink3 mt-0.5">Last 30 days performance</p>
          </div>
          <button
            type="button"
            onClick={resetWidgetOrder}
            className="text-xs text-ink4 hover:text-ink3 transition-colors px-3 py-1.5 rounded-lg border border-border-brand hover:bg-bg"
          >
            Reset layout
          </button>
        </div>

        {/* Draggable widget sections */}
        <Droppable droppableId="insights-widgets" type="widget">
          {(provided) => (
            <div ref={provided.innerRef} {...provided.droppableProps} className="space-y-6">
              {widgetOrder.map((id, index) => (
                <Draggable key={id} draggableId={id} index={index}>
                  {(dragProvided, dragSnapshot) => (
                    <div
                      ref={dragProvided.innerRef}
                      {...dragProvided.draggableProps}
                      className="relative group/widget"
                      style={{
                        opacity: dragSnapshot.isDragging ? 0.85 : 1,
                        ...dragProvided.draggableProps.style,
                      }}
                    >
                      {/* Drag handle — desktop only, visible on hover */}
                      <span
                        {...dragProvided.dragHandleProps}
                        className="hidden md:inline-flex absolute top-0 right-0 z-10 items-center gap-1 px-2 py-1 text-[11px] text-ink4 opacity-0 group-hover/widget:opacity-100 transition-opacity cursor-grab active:cursor-grabbing select-none bg-white border border-border-brand rounded-bl-lg rounded-tr-xl"
                        aria-label="Drag to reorder"
                      >
                        ⠿
                      </span>
                      {renderWidget(id)}
                    </div>
                  )}
                </Draggable>
              ))}
              {provided.placeholder}
            </div>
          )}
        </Droppable>
      </div>
    </DragDropContext>
  )
}
