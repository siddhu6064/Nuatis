'use client'

import { useState } from 'react'

type AppointmentStatus =
  | 'scheduled'
  | 'confirmed'
  | 'completed'
  | 'no_show'
  | 'canceled'
  | 'rescheduled'

export interface Appointment {
  id: string
  title: string
  start_time: string
  end_time: string
  status: AppointmentStatus
  notes: string | null
  contacts: { full_name: string } | null
  staff_members: { id: string; name: string; color_hex: string } | null
  video_link?: string | null
  video_provider?: string | null
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

const STATUS_OPTIONS: Array<{ value: AppointmentStatus; label: string }> = [
  { value: 'scheduled', label: 'Scheduled' },
  { value: 'confirmed', label: 'Confirmed' },
  { value: 'completed', label: 'Completed' },
  { value: 'no_show', label: 'No Show' },
  { value: 'canceled', label: 'Canceled' },
]

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

function pad(n: number) {
  return String(n).padStart(2, '0')
}

function toDateInput(iso: string): string {
  const d = new Date(iso)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function toTimeInput(iso: string): string {
  const d = new Date(iso)
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

interface FormState {
  title: string
  date: string
  startTime: string
  endTime: string
  status: AppointmentStatus
  notes: string
}

function toForm(appt: Appointment): FormState {
  return {
    title: appt.title,
    date: toDateInput(appt.start_time),
    startTime: toTimeInput(appt.start_time),
    endTime: toTimeInput(appt.end_time),
    status: appt.status,
    notes: appt.notes ?? '',
  }
}

interface Props {
  appt: Appointment
  userRole?: string
  onClose: () => void
  onUpdated: (updated: Appointment) => void
  onDeleted: () => void
}

const INP =
  'w-full px-3 py-2 text-sm border border-border-brand rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent'

export default function AppointmentDrawer({
  appt,
  userRole,
  onClose,
  onUpdated,
  onDeleted,
}: Props) {
  const [isEditing, setIsEditing] = useState(false)
  const [localAppt, setLocalAppt] = useState(appt)
  const [form, setForm] = useState<FormState>(() => toForm(appt))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const canDelete = userRole === 'owner' || userRole === 'admin'

  const start = formatDateTime(localAppt.start_time)
  const endTime = new Date(localAppt.end_time).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
  const color = STATUS_COLOR[localAppt.status] ?? '#0d9488'

  function enterEdit() {
    setForm(toForm(localAppt))
    setError(null)
    setIsEditing(true)
  }

  function cancelEdit() {
    setIsEditing(false)
    setError(null)
  }

  function set(key: keyof FormState, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }))
    setError(null)
  }

  async function handleSave() {
    setSaving(true)
    setError(null)
    try {
      const startISO = new Date(`${form.date}T${form.startTime}:00`).toISOString()
      const endISO = new Date(`${form.date}T${form.endTime}:00`).toISOString()
      const payload = {
        title: form.title.trim(),
        start_time: startISO,
        end_time: endISO,
        status: form.status,
        notes: form.notes.trim() || null,
      }

      const res = await fetch(`/api/appointments/${localAppt.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      if (res.ok) {
        const updated: Appointment = { ...localAppt, ...payload }
        setLocalAppt(updated)
        onUpdated(updated)
        setIsEditing(false)
      } else {
        const d = (await res.json().catch(() => ({}))) as { error?: string }
        setError(d.error ?? 'Failed to save. Please try again.')
      }
    } catch {
      setError('Network error. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    setDeleting(true)
    try {
      const res = await fetch(`/api/appointments/${localAppt.id}`, { method: 'DELETE' })
      if (res.ok || res.status === 204) {
        onDeleted()
      } else {
        const d = (await res.json().catch(() => ({}))) as { error?: string }
        setError(d.error ?? 'Failed to delete. Please try again.')
        setDeleteConfirm(false)
      }
    } catch {
      setError('Network error. Please try again.')
      setDeleteConfirm(false)
    } finally {
      setDeleting(false)
    }
  }

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/20 z-40" onClick={onClose} aria-hidden="true" />

      {/* Panel */}
      <div className="fixed top-0 right-0 h-full w-80 bg-white shadow-xl z-50 flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border-brand">
          <h2 className="text-sm font-semibold text-ink">
            {isEditing ? 'Edit Appointment' : 'Appointment Details'}
          </h2>
          <button
            onClick={onClose}
            className="text-ink4 hover:text-ink3 transition-colors"
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

        {isEditing ? (
          <>
            {/* Edit form */}
            <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
              <div>
                <label className="block text-xs font-medium text-ink2 mb-1">Title</label>
                <input
                  type="text"
                  value={form.title}
                  onChange={(e) => set('title', e.target.value)}
                  className={INP}
                  autoFocus
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-ink2 mb-1">Date</label>
                <input
                  type="date"
                  value={form.date}
                  onChange={(e) => set('date', e.target.value)}
                  className={INP}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-ink2 mb-1">Start Time</label>
                  <input
                    type="time"
                    value={form.startTime}
                    onChange={(e) => set('startTime', e.target.value)}
                    className={INP}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-ink2 mb-1">End Time</label>
                  <input
                    type="time"
                    value={form.endTime}
                    onChange={(e) => set('endTime', e.target.value)}
                    className={INP}
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-ink2 mb-1">Status</label>
                <select
                  value={form.status}
                  onChange={(e) => set('status', e.target.value as AppointmentStatus)}
                  className={`${INP} bg-white`}
                >
                  {STATUS_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-ink2 mb-1">
                  Notes <span className="text-ink4 font-normal">(optional)</span>
                </label>
                <textarea
                  value={form.notes}
                  onChange={(e) => set('notes', e.target.value)}
                  rows={3}
                  className={INP}
                  placeholder="Internal notes…"
                />
              </div>

              {error && (
                <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
                  {error}
                </p>
              )}
            </div>

            {/* Edit footer */}
            {deleteConfirm ? (
              <div className="px-6 py-4 border-t border-border-brand shrink-0 space-y-3">
                <p className="text-sm text-ink2 font-medium">Delete this appointment?</p>
                <p className="text-xs text-ink3">This cannot be undone.</p>
                <div className="flex gap-2">
                  <button
                    onClick={() => setDeleteConfirm(false)}
                    disabled={deleting}
                    className="flex-1 px-4 py-2 text-sm font-medium text-ink2 border border-border-brand rounded-lg hover:bg-bg transition-colors disabled:opacity-50"
                  >
                    Keep
                  </button>
                  <button
                    onClick={() => void handleDelete()}
                    disabled={deleting}
                    className="flex-1 px-4 py-2 bg-red-600 text-white text-sm font-medium rounded-lg hover:bg-red-700 disabled:opacity-50 transition-colors"
                  >
                    {deleting ? 'Deleting…' : 'Yes, Delete'}
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex gap-2 px-6 py-4 border-t border-border-brand shrink-0">
                {canDelete && (
                  <button
                    onClick={() => setDeleteConfirm(true)}
                    disabled={saving}
                    className="px-3 py-2 text-sm font-medium text-red-600 border border-red-200 rounded-lg hover:bg-red-50 transition-colors disabled:opacity-50"
                  >
                    Delete
                  </button>
                )}
                <button
                  onClick={cancelEdit}
                  disabled={saving}
                  className="flex-1 px-4 py-2 text-sm font-medium text-ink2 border border-border-brand rounded-lg hover:bg-bg transition-colors disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  onClick={() => void handleSave()}
                  disabled={saving}
                  className="flex-1 px-4 py-2 bg-teal-600 text-white text-sm font-medium rounded-lg hover:bg-teal-700 disabled:opacity-50 transition-colors"
                >
                  {saving ? 'Saving…' : 'Save Changes'}
                </button>
              </div>
            )}
          </>
        ) : (
          <>
            {/* Read view */}
            <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
              <div>
                <p className="text-xs font-medium text-ink4 uppercase tracking-wide mb-1">
                  Contact
                </p>
                <p className="text-sm font-semibold text-ink">
                  {localAppt.contacts?.full_name ?? '—'}
                </p>
              </div>

              <div>
                <p className="text-xs font-medium text-ink4 uppercase tracking-wide mb-1">Status</p>
                <span
                  className="inline-flex items-center px-2.5 py-0.5 rounded text-xs font-semibold text-white"
                  style={{ backgroundColor: color }}
                >
                  {STATUS_LABEL[localAppt.status]}
                </span>
              </div>

              <div>
                <p className="text-xs font-medium text-ink4 uppercase tracking-wide mb-1">Date</p>
                <p className="text-sm text-ink2">{start.date}</p>
              </div>

              <div>
                <p className="text-xs font-medium text-ink4 uppercase tracking-wide mb-1">Time</p>
                <p className="text-sm text-ink2">
                  {start.time} – {endTime}
                </p>
              </div>

              <div>
                <p className="text-xs font-medium text-ink4 uppercase tracking-wide mb-1">Type</p>
                <p className="text-sm text-ink2">{localAppt.title}</p>
              </div>

              {localAppt.staff_members && (
                <div>
                  <p className="text-xs font-medium text-ink4 uppercase tracking-wide mb-1">
                    Staff
                  </p>
                  <span className="inline-flex items-center gap-1.5 text-sm text-ink2">
                    <span
                      className="inline-block w-2.5 h-2.5 rounded-full"
                      style={{ backgroundColor: localAppt.staff_members.color_hex }}
                    />
                    {localAppt.staff_members.name}
                  </span>
                </div>
              )}

              {localAppt.notes && (
                <div>
                  <p className="text-xs font-medium text-ink4 uppercase tracking-wide mb-1">
                    Notes
                  </p>
                  <p className="text-sm text-ink2 whitespace-pre-wrap">{localAppt.notes}</p>
                </div>
              )}
            </div>

            {/* Read footer */}
            <div className="px-6 py-4 border-t border-border-brand space-y-2">
              {localAppt.video_link && (
                <a
                  href={localAppt.video_link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block w-full text-center px-4 py-2 bg-teal-50 text-teal-700 border border-teal-200 text-sm font-medium rounded-lg hover:bg-teal-100 transition-colors"
                >
                  Join Video Call →
                </a>
              )}
              <button
                onClick={enterEdit}
                className="block w-full text-center px-4 py-2 bg-teal-600 text-white text-sm font-medium rounded-lg hover:bg-teal-700 transition-colors"
              >
                Edit Appointment
              </button>
            </div>
          </>
        )}
      </div>
    </>
  )
}
