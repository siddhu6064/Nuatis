'use client'

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
  staff_members: { id: string; name: string; color_hex: string } | null
}

const STATUS_COLOR: Record<AppointmentStatus, string> = {
  scheduled: '#0d9488',
  confirmed: '#0d9488',
  completed: '#16a34a',
  no_show: '#f43f5e',
  canceled: '#9ca3af',
  rescheduled: '#f59e0b',
}

const STATUS_LABEL: Record<AppointmentStatus, string> = {
  scheduled: 'Scheduled',
  confirmed: 'Confirmed',
  completed: 'Completed',
  no_show: 'No Show',
  canceled: 'Canceled',
  rescheduled: 'Rescheduled',
}

function formatDateTime(iso: string) {
  const d = new Date(iso)
  return {
    date: d.toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    }),
    time: d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }),
  }
}

interface Props {
  appt: Appointment
  onClose: () => void
}

export default function AppointmentDrawer({ appt, onClose }: Props) {
  const start = formatDateTime(appt.start_time)
  const end = new Date(appt.end_time).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
  const color = STATUS_COLOR[appt.status] ?? '#0d9488'

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/20 z-40" onClick={onClose} aria-hidden="true" />

      {/* Panel */}
      <div className="fixed top-0 right-0 h-full w-80 bg-white shadow-xl z-50 flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="text-sm font-semibold text-gray-900">Appointment Details</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 transition-colors"
            aria-label="Close"
          >
            <svg
              className="w-5 h-5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          <div>
            <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-1">
              Contact
            </p>
            <p className="text-sm font-semibold text-gray-900">{appt.contacts?.full_name ?? '—'}</p>
          </div>

          <div>
            <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-1">Status</p>
            <span
              className="inline-flex items-center px-2.5 py-0.5 rounded text-xs font-semibold text-white"
              style={{ backgroundColor: color }}
            >
              {STATUS_LABEL[appt.status]}
            </span>
          </div>

          <div>
            <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-1">Date</p>
            <p className="text-sm text-gray-700">{start.date}</p>
          </div>

          <div>
            <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-1">Time</p>
            <p className="text-sm text-gray-700">
              {start.time} – {end}
            </p>
          </div>

          <div>
            <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-1">Type</p>
            <p className="text-sm text-gray-700">{appt.title}</p>
          </div>

          {appt.staff_members && (
            <div>
              <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-1">
                Staff
              </p>
              <span className="inline-flex items-center gap-1.5 text-sm text-gray-700">
                <span
                  className="inline-block w-2.5 h-2.5 rounded-full"
                  style={{ backgroundColor: appt.staff_members.color_hex }}
                />
                {appt.staff_members.name}
              </span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-100">
          <a
            href={`/appointments/${appt.id}`}
            className="block w-full text-center px-4 py-2 bg-teal-600 text-white text-sm font-medium rounded-lg hover:bg-teal-700 transition-colors"
          >
            Edit Appointment
          </a>
        </div>
      </div>
    </>
  )
}
