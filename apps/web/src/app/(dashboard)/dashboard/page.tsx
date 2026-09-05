import { getFirstName, resolveTenantTimezone, tenantDayBoundsUTC } from '@nuatis/shared'
import { auth } from '@/lib/auth/authjs'
import { createAdminClient } from '@/lib/supabase/server'
import DashboardClient from './DashboardClient'

// Buckets raw UTC timestamps into 7 tenant-local daily counts, oldest to
// newest (today last) — the shape a stat-tile sparkline reads left to right.
function bucketDailyCounts(timestamps: string[], timezone: string): number[] {
  const days = 7
  const boundaries = Array.from({ length: days }, (_, i) =>
    tenantDayBoundsUTC(timezone, new Date(Date.now() - (days - 1 - i) * 86_400_000))
  )
  const buckets = new Array(days).fill(0) as number[]
  for (const ts of timestamps) {
    const t = new Date(ts).getTime()
    const dayIndex = boundaries.findIndex(
      (b) => t >= new Date(b.startUTC).getTime() && t < new Date(b.endUTC).getTime()
    )
    if (dayIndex >= 0) buckets[dayIndex] = (buckets[dayIndex] ?? 0) + 1
  }
  return buckets
}

// A "0" main number alone reads as unfinished, not deliberately empty — this
// gives it context: whether the week was quiet too, or just today was.
function emptyAwareDelta(todayCount: number, weekSum: number, verb: string): string {
  if (weekSum === 0) return `Nothing ${verb} this week`
  if (todayCount === 0) return `${weekSum} ${verb} this week, none today`
  return `${weekSum} this week`
}

export default async function DashboardPage() {
  const session = await auth()
  const tenantId = session?.user?.tenantId

  const supabase = createAdminClient()

  const timezone = tenantId ? await resolveTenantTimezone(supabase, tenantId) : 'America/Chicago'
  const { startUTC: today, endUTC: tomorrow } = tenantDayBoundsUTC(timezone)
  const { startUTC: weekStart } = tenantDayBoundsUTC(
    timezone,
    new Date(Date.now() - 6 * 86_400_000)
  )

  const [
    { count: totalContacts },
    { count: openPipeline },
    { count: appointmentsToday },
    { count: callsHandled },
    { data: newContactsRaw },
    { data: newPipelineRaw },
    { data: weekAppointmentsRaw },
    { data: weekCallsRaw },
  ] = await Promise.all([
    supabase
      .from('contacts')
      .select('*', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .eq('is_archived', false),

    supabase
      .from('contacts')
      .select('*', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .not('pipeline_stage', 'is', null)
      .neq('pipeline_stage', 'closed')
      .neq('pipeline_stage', 'lost'),

    supabase
      .from('appointments')
      .select('*', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .gte('start_time', today)
      .lt('start_time', tomorrow),

    // 'calls' table is dead — its only writer (call-logger.ts) never
    // populates started_at/status, so a query against it always returns 0.
    // voice_sessions is the real, fully-populated table (same one Call Log
    // reads from). 'abandoned' (<5s, no real interaction) is excluded so
    // "Handled" doesn't count calls Maya never actually engaged with.
    supabase
      .from('voice_sessions')
      .select('*', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .neq('outcome', 'abandoned')
      .gte('started_at', today)
      .lt('started_at', tomorrow),

    // 7-day trend data for the stat-tile sparklines — raw timestamps, bucketed
    // per tenant-local day below rather than fetched pre-aggregated (small
    // per-tenant volumes, so bucketing in JS is cheaper than a grouped RPC).
    supabase
      .from('contacts')
      .select('created_at')
      .eq('tenant_id', tenantId)
      .eq('is_archived', false)
      .gte('created_at', weekStart)
      .lt('created_at', tomorrow),

    supabase
      .from('contacts')
      .select('created_at')
      .eq('tenant_id', tenantId)
      .not('pipeline_stage', 'is', null)
      .neq('pipeline_stage', 'closed')
      .neq('pipeline_stage', 'lost')
      .gte('created_at', weekStart)
      .lt('created_at', tomorrow),

    supabase
      .from('appointments')
      .select('start_time')
      .eq('tenant_id', tenantId)
      .gte('start_time', weekStart)
      .lt('start_time', tomorrow),

    supabase
      .from('voice_sessions')
      .select('started_at')
      .eq('tenant_id', tenantId)
      .neq('outcome', 'abandoned')
      .gte('started_at', weekStart)
      .lt('started_at', tomorrow),
  ])

  const userName = getFirstName(session?.user?.name)

  const contactsTrend = bucketDailyCounts(
    (newContactsRaw ?? []).map((r) => r.created_at as string),
    timezone
  )
  const pipelineTrend = bucketDailyCounts(
    (newPipelineRaw ?? []).map((r) => r.created_at as string),
    timezone
  )
  const appointmentsTrend = bucketDailyCounts(
    (weekAppointmentsRaw ?? []).map((r) => r.start_time as string),
    timezone
  )
  const callsTrend = bucketDailyCounts(
    (weekCallsRaw ?? []).map((r) => r.started_at as string),
    timezone
  )
  const sum = (nums: number[]) => nums.reduce((a, b) => a + b, 0)

  const stats = [
    {
      label: 'Total Contacts',
      value: String(totalContacts ?? 0),
      icon: '◎',
      color: 'teal',
      href: '/contacts',
      trend: contactsTrend,
      delta: `+${sum(contactsTrend)} this week`,
    },
    {
      label: 'Open Pipeline',
      value: String(openPipeline ?? 0),
      icon: '◈',
      color: 'blue',
      href: '/pipeline',
      trend: pipelineTrend,
      delta: `+${sum(pipelineTrend)} new this week`,
    },
    {
      label: 'Appointments Today',
      value: String(appointmentsToday ?? 0),
      icon: '◷',
      color: 'amber',
      href: '/appointments',
      trend: appointmentsTrend,
      delta: emptyAwareDelta(appointmentsToday ?? 0, sum(appointmentsTrend), 'scheduled'),
    },
    {
      label: 'Calls Handled',
      value: String(callsHandled ?? 0),
      icon: '◉',
      color: 'purple',
      href: '/calls',
      trend: callsTrend,
      delta: emptyAwareDelta(callsHandled ?? 0, sum(callsTrend), 'handled'),
    },
  ]

  return <DashboardClient stats={stats} userName={userName} />
}
