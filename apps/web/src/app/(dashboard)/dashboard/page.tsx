import { auth } from '@/lib/auth/authjs'
import { createAdminClient } from '@/lib/supabase/server'

const COLOR: Record<string, string> = {
  teal: 'bg-teal-50 text-teal-600',
  blue: 'bg-blue-50 text-blue-600',
  amber: 'bg-amber-50 text-amber-600',
  purple: 'bg-purple-50 text-purple-600',
}

const ACTIONS = [
  { label: 'Add Contact', icon: '+', href: '/contacts/new' },
  { label: 'New Appointment', icon: '◷', href: '/appointments/new' },
  { label: 'View Pipeline', icon: '◈', href: '/pipeline' },
  { label: 'Open Demo', icon: '▶', href: '/demo/dashboard' },
]

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
        .eq('tenant_id', tenantId),

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

  const STATS = [
    { label: 'Total Contacts', value: String(totalContacts ?? 0), icon: '◎', color: 'teal' },
    { label: 'Open Pipeline', value: String(openPipeline ?? 0), icon: '◈', color: 'blue' },
    {
      label: 'Appointments Today',
      value: String(appointmentsToday ?? 0),
      icon: '◷',
      color: 'amber',
    },
    { label: 'Calls Handled', value: '0', icon: '◉', color: 'purple' },
  ]

  return (
    <div className="px-8 py-8">
      <div className="mb-8">
        <h1 className="text-xl font-bold text-gray-900">Dashboard</h1>
        <p className="text-sm text-gray-500 mt-0.5">Welcome back, Sid.</p>
      </div>

      <div className="grid grid-cols-4 gap-4 mb-8">
        {STATS.map(({ label, value, icon, color }) => (
          <div key={label} className="bg-white rounded-xl border border-gray-100 p-5">
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs font-medium text-gray-500">{label}</p>
              <div
                className={`w-7 h-7 rounded-lg flex items-center justify-center text-sm ${COLOR[color]}`}
              >
                {icon}
              </div>
            </div>
            <p className="text-2xl font-bold text-gray-900">{value}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="col-span-2 bg-white rounded-xl border border-gray-100 p-6">
          <h2 className="text-sm font-semibold text-gray-900 mb-4">Recent Activity</h2>
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <div className="w-10 h-10 rounded-full bg-gray-50 flex items-center justify-center mb-3">
              <span className="text-gray-300 text-xl">◎</span>
            </div>
            <p className="text-sm font-medium text-gray-400">No activity yet</p>
            <p className="text-xs text-gray-300 mt-1">
              Activity will appear here as you add contacts
            </p>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-gray-100 p-6">
          <h2 className="text-sm font-semibold text-gray-900 mb-4">Quick Actions</h2>
          <div className="space-y-2">
            {ACTIONS.map(({ label, icon, href }) => (
              <a
                key={label}
                href={href}
                className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-gray-600 hover:bg-gray-50 hover:text-gray-900 transition-colors"
              >
                <span className="w-6 h-6 rounded-md bg-gray-100 flex items-center justify-center text-xs text-gray-500">
                  {icon}
                </span>
                {label}
              </a>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
