import { getFirstName } from '@nuatis/shared'
import { auth } from '@/lib/auth/authjs'
import { createAdminClient } from '@/lib/supabase/server'
import DashboardClient from './DashboardClient'

export default async function DashboardPage() {
  const session = await auth()
  const tenantId = session?.user?.tenantId

  const supabase = createAdminClient()

  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const tomorrow = new Date(today)
  tomorrow.setDate(tomorrow.getDate() + 1)

  const [{ count: totalContacts }, { count: openPipeline }, { count: appointmentsToday }] =
    await Promise.all([
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
        .gte('start_time', today.toISOString())
        .lt('start_time', tomorrow.toISOString()),
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
    { label: 'Calls Handled', value: '0', icon: '◉', color: 'purple', href: '/calls' },
  ]

  return <DashboardClient stats={stats} userName={userName} />
}
