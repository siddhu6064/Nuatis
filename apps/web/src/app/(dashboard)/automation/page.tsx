import { auth } from '@/lib/auth/authjs'
import { createAdminClient } from '@/lib/supabase/server'
import { FOLLOW_UP_CADENCES, MAX_FOLLOW_UP_STEPS } from '@/lib/verticals'

interface FollowUpContact {
  id: string
  full_name: string
  phone: string | null
  follow_up_step: number
  follow_up_last_sent: string | null
  tenant_id: string
}

interface WebhookSub {
  id: string
  url: string
  event_types: string[]
  created_at: string
}

const EVENT_LABELS: Record<string, string> = {
  'call.completed': 'Call Completed',
  'appointment.booked': 'Booking',
  'appointment.no_show': 'No Show',
  'contact.created': 'New Contact',
  'follow_up.sent': 'Follow-up Sent',
}

export default async function AutomationPage() {
  const session = await auth()
  const tenantId = session?.user?.tenantId
  const vertical = session?.user?.vertical || 'sales_crm'

  const supabase = createAdminClient()

  // Stats queries in parallel
  const todayStart = new Date()
  todayStart.setHours(0, 0, 0, 0)

  const [activeSeqRes, callsTodayRes, totalCallsRes, bookingsRes, followUpsRes, webhooksRes] =
    await Promise.all([
      // Active follow-up sequences
      supabase
        .from('contacts')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', tenantId)
        .gt('follow_up_step', 0),

      // Calls today
      supabase
        .from('voice_sessions')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', tenantId)
        .gte('started_at', todayStart.toISOString()),

      // Total calls (all time)
      supabase
        .from('voice_sessions')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', tenantId),

      // Bookings by Maya
      supabase
        .from('voice_sessions')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', tenantId)
        .eq('booked_appointment', true),

      // Active follow-up contacts (for table)
      supabase
        .from('contacts')
        .select('id, full_name, phone, follow_up_step, follow_up_last_sent, tenant_id')
        .eq('tenant_id', tenantId)
        .gt('follow_up_step', 0)
        .order('follow_up_last_sent', { ascending: false })
        .limit(20)
        .returns<FollowUpContact[]>(),

      // Webhook subscriptions
      supabase
        .from('webhook_subscriptions')
        .select('id, url, event_types, created_at')
        .eq('tenant_id', tenantId)
        .eq('is_active', true)
        .order('created_at', { ascending: false })
        .returns<WebhookSub[]>(),
    ])

  const activeSequences = activeSeqRes.count ?? 0
  const callsToday = callsTodayRes.count ?? 0
  const totalCalls = totalCallsRes.count ?? 0
  const totalBookings = bookingsRes.count ?? 0
  const followUps = followUpsRes.data ?? []
  const webhooks = webhooksRes.data ?? []

  const cadence = FOLLOW_UP_CADENCES[vertical] ?? []
  const maxSteps = cadence.length || MAX_FOLLOW_UP_STEPS
  const conversionRate = totalCalls > 0 ? ((totalBookings / totalCalls) * 100).toFixed(1) : '0.0'
  const costPerCall = 0.008
  const estimatedSavings = (totalCalls * costPerCall).toFixed(2)

  return (
    <div className="px-8 py-8">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-xl font-bold text-gray-900">Automation</h1>
        <p className="text-sm text-gray-500 mt-0.5">Active sequences, alerts, and system health</p>
      </div>

      {/* ROI Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div className="bg-white rounded-xl border border-gray-100 p-4">
          <p className="text-xs text-gray-400 mb-1">Calls Handled</p>
          <p className="text-2xl font-bold text-gray-900">{totalCalls}</p>
          <p className="text-[11px] text-gray-400 mt-1">{callsToday} today</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-100 p-4">
          <p className="text-xs text-gray-400 mb-1">Bookings by Maya</p>
          <p className="text-2xl font-bold text-gray-900">{totalBookings}</p>
          <p className="text-[11px] text-teal-600 mt-1">{conversionRate}% conversion</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-100 p-4">
          <p className="text-xs text-gray-400 mb-1">Est. Cost Saved</p>
          <p className="text-2xl font-bold text-gray-900">${estimatedSavings}</p>
          <p className="text-[11px] text-gray-400 mt-1">vs $2,500/mo receptionist</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-100 p-4">
          <p className="text-xs text-gray-400 mb-1">Active Sequences</p>
          <p className="text-2xl font-bold text-gray-900">{activeSequences}</p>
          <p className="text-[11px] text-gray-400 mt-1">follow-up cadences</p>
        </div>
      </div>

      {/* Follow-up Sequences */}
      <div className="bg-white rounded-xl border border-gray-100 mb-6">
        <div className="px-6 py-4 border-b border-gray-100">
          <h2 className="text-sm font-semibold text-gray-900">Active Follow-up Sequences</h2>
        </div>
        {followUps.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <p className="text-sm text-gray-400">No active follow-up sequences</p>
            <p className="text-xs text-gray-300 mt-1">
              Contacts will appear here after their first call with Maya
            </p>
          </div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="text-left text-xs font-medium text-gray-400 px-6 py-3">Contact</th>
                <th className="text-left text-xs font-medium text-gray-400 px-6 py-3">Step</th>
                <th className="text-left text-xs font-medium text-gray-400 px-6 py-3">
                  Next Channel
                </th>
                <th className="text-left text-xs font-medium text-gray-400 px-6 py-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {followUps.map((c) => {
                const step = c.follow_up_step
                const completed = step >= maxSteps
                const nextStep = !completed && cadence[step] ? cadence[step] : null

                return (
                  <tr
                    key={c.id}
                    className="border-b border-gray-50 last:border-0 hover:bg-gray-50/50"
                  >
                    <td className="px-6 py-4">
                      <p className="text-sm font-medium text-gray-900">{c.full_name || '—'}</p>
                      <p className="text-xs text-gray-400">{c.phone ?? '—'}</p>
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-500">
                      Step {step} of {maxSteps}
                    </td>
                    <td className="px-6 py-4">
                      {nextStep ? (
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                            nextStep.channel === 'sms'
                              ? 'bg-blue-50 text-blue-700'
                              : 'bg-teal-50 text-teal-700'
                          }`}
                        >
                          {nextStep.channel.toUpperCase()}
                        </span>
                      ) : (
                        <span className="text-xs text-gray-300">—</span>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                          completed ? 'bg-gray-100 text-gray-500' : 'bg-green-50 text-green-700'
                        }`}
                      >
                        {completed ? 'Completed' : 'In Progress'}
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Alerts placeholder */}
      <div className="bg-white rounded-xl border border-gray-100 p-6 mb-6">
        <h2 className="text-sm font-semibold text-gray-900 mb-2">Recent Alerts</h2>
        <p className="text-sm text-gray-400">
          Connect Ops-Copilot to view automated alerts for stalled leads, no-shows, and missed
          follow-ups.
        </p>
        <p className="text-xs text-gray-300 mt-2">
          Alerts are managed by the Nuatis Ops-Copilot sidecar service.
        </p>
      </div>

      {/* Webhook Subscriptions */}
      <div className="bg-white rounded-xl border border-gray-100">
        <div className="px-6 py-4 border-b border-gray-100">
          <h2 className="text-sm font-semibold text-gray-900">Active Webhooks</h2>
        </div>
        {webhooks.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <p className="text-sm text-gray-400">No webhook subscriptions</p>
            <p className="text-xs text-gray-300 mt-1">
              Connect Zapier or Make via the API to receive events
            </p>
          </div>
        ) : (
          <div className="divide-y divide-gray-50">
            {webhooks.map((wh) => (
              <div key={wh.id} className="px-6 py-4 flex items-center justify-between">
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-gray-900 font-mono truncate">{wh.url}</p>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {wh.event_types.map((et) => (
                      <span
                        key={et}
                        className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-gray-100 text-gray-500"
                      >
                        {EVENT_LABELS[et] ?? et}
                      </span>
                    ))}
                  </div>
                </div>
                <p className="text-xs text-gray-400 ml-4 shrink-0">
                  {new Date(wh.created_at).toLocaleDateString('en-US', {
                    month: 'short',
                    day: 'numeric',
                  })}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
