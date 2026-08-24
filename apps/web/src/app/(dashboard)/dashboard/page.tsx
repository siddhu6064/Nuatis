import { getFirstName, resolveTenantTimezone, tenantDayBoundsUTC } from '@nuatis/shared'
import { auth } from '@/lib/auth/authjs'
import { createAdminClient } from '@/lib/supabase/server'
import DashboardClient from './DashboardClient'

export default async function DashboardPage() {
  const session = await auth()
  const tenantId = session?.user?.tenantId

  const supabase = createAdminClient()

  const timezone = tenantId ? await resolveTenantTimezone(supabase, tenantId) : 'America/Chicago'
  const { startUTC: today, endUTC: tomorrow } = tenantDayBoundsUTC(timezone)

  const [
    { count: totalContacts },
    { count: openPipeline },
    { count: appointmentsToday },
    { count: callsHandled },
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
  ])

  const userName = getFirstName(session?.user?.name)

  const stats = [
    {
      label: 'Total Contacts',
      value: String(totalContacts ?? 0),
      icon: '◎',
      color: 'teal',
      href: '/contacts',
    },
    {
      label: 'Open Pipeline',
      value: String(openPipeline ?? 0),
      icon: '◈',
      color: 'blue',
      href: '/pipeline',
    },
    {
      label: 'Appointments Today',
      value: String(appointmentsToday ?? 0),
      icon: '◷',
      color: 'amber',
      href: '/appointments',
    },
    {
      label: 'Calls Handled',
      value: String(callsHandled ?? 0),
      icon: '◉',
      color: 'purple',
      href: '/calls',
    },
  ]

  return <DashboardClient stats={stats} userName={userName} />
}
