import { auth } from '@/lib/auth/authjs'
import { createAdminClient } from '@/lib/supabase/server'
import Link from 'next/link'

type AppointmentStatus =
  | 'scheduled'
  | 'confirmed'
  | 'completed'
  | 'no_show'
  | 'canceled'
  | 'rescheduled'

interface Appointment {
  id: string
  title: string
  start_time: string
  end_time: string
  status: AppointmentStatus
  contacts: { full_name: string } | null
}

const STATUS_STYLE: Record<AppointmentStatus, string> = {
  scheduled: 'bg-gray-100 text-gray-600',
  confirmed: 'bg-teal-50 text-teal-700',
  completed: 'bg-green-50 text-green-700',
  no_show: 'bg-red-50 text-red-600',
  canceled: 'bg-red-50 text-red-600',
  rescheduled: 'bg-amber-50 text-amber-700',
}

const STATUS_LABEL: Record<AppointmentStatus, string> = {
  scheduled: 'Scheduled',
  confirmed: 'Confirmed',
  completed: 'Completed',
  no_show: 'No Show',
  canceled: 'Canceled',
  rescheduled: 'Rescheduled',
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
}

export default async function AppointmentsPage() {
  const session = await auth()
  const tenantId = session?.user?.tenantId

  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const tomorrow = new Date(today)
  tomorrow.setDate(tomorrow.getDate() + 1)

  const supabase = createAdminClient()
  const { data: appointments } = await supabase
    .from('appointments')
    .select('id, title, start_time, end_time, status, contacts(full_name)')
    .eq('tenant_id', tenantId)
    .gte('start_time', today.toISOString())
    .lt('start_time', tomorrow.toISOString())
    .order('start_time', { ascending: true })
    .returns<Appointment[]>()

  const todayLabel = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  })

  return (
    <div className="px-8 py-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Appointments</h1>
          <p className="text-sm text-gray-500 mt-0.5">{todayLabel}</p>
        </div>
        <Link
          href="/appointments/new"
          className="flex items-center gap-2 px-4 py-2 bg-teal-600 text-white text-sm font-medium rounded-lg hover:bg-teal-700 transition-colors"
        >
          <span className="text-base leading-none">+</span>
          New Appointment
        </Link>
      </div>

      <div className="bg-white rounded-xl border border-gray-100">
        {!appointments || appointments.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="w-10 h-10 rounded-full bg-gray-50 flex items-center justify-center mb-3">
              <span className="text-gray-300 text-xl">◷</span>
            </div>
            <p className="text-sm font-medium text-gray-400">No appointments today</p>
            <p className="text-xs text-gray-300 mt-1">
              Schedule your first appointment to get started
            </p>
            <Link
              href="/appointments/new"
              className="mt-4 text-xs text-teal-600 hover:text-teal-700 font-medium"
            >
              New Appointment →
            </Link>
          </div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="text-left text-xs font-medium text-gray-400 px-6 py-3">Contact</th>
                <th className="text-left text-xs font-medium text-gray-400 px-6 py-3">Type</th>
                <th className="text-left text-xs font-medium text-gray-400 px-6 py-3">Start</th>
                <th className="text-left text-xs font-medium text-gray-400 px-6 py-3">End</th>
                <th className="text-left text-xs font-medium text-gray-400 px-6 py-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {appointments.map((appt) => (
                <tr
                  key={appt.id}
                  className="border-b border-gray-50 last:border-0 hover:bg-gray-50/50 transition-colors"
                >
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <div className="w-7 h-7 rounded-full bg-teal-100 flex items-center justify-center shrink-0">
                        <span className="text-teal-700 text-xs font-bold">
                          {appt.contacts?.full_name?.charAt(0)?.toUpperCase() ?? '?'}
                        </span>
                      </div>
                      <span className="text-sm font-medium text-gray-900">
                        {appt.contacts?.full_name ?? '—'}
                      </span>
                    </div>
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-600">{appt.title}</td>
                  <td className="px-6 py-4 text-sm text-gray-500">{formatTime(appt.start_time)}</td>
                  <td className="px-6 py-4 text-sm text-gray-500">{formatTime(appt.end_time)}</td>
                  <td className="px-6 py-4">
                    <span
                      className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${STATUS_STYLE[appt.status]}`}
                    >
                      {STATUS_LABEL[appt.status]}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
