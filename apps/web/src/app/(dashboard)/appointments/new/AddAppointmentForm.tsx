'use client'

import Link from 'next/link'
import { useFormStatus } from 'react-dom'
import { createAppointment } from './actions'

interface Contact {
  id: string
  full_name: string
}

interface StaffOption {
  id: string
  name: string
  color_hex: string
}

interface Props {
  contacts: Contact[]
  staff: StaffOption[]
}

function SubmitButton() {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      disabled={pending}
      className="px-4 py-2 bg-teal-600 text-white text-sm font-medium rounded-lg hover:bg-teal-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
    >
      {pending ? 'Saving…' : 'Save Appointment'}
    </button>
  )
}

export default function AddAppointmentForm({ contacts, staff }: Props) {
  return (
    <div className="max-w-lg">
      <div className="bg-white rounded-xl border border-border-brand p-6">
        <form action={createAppointment} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-ink2 mb-1.5">
              Title <span className="text-red-500">*</span>
            </label>
            <input
              name="title"
              type="text"
              required
              autoFocus
              placeholder="e.g. Checkup, Consultation"
              className="w-full px-3 py-2 text-sm border border-border-brand rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent placeholder:text-gray-300"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-ink2 mb-1.5">Contact</label>
            <select
              name="contact_id"
              className="w-full px-3 py-2 text-sm border border-border-brand rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent bg-white text-ink2"
            >
              <option value="">— None —</option>
              {contacts.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.full_name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-ink2 mb-1.5">
              Date <span className="text-red-500">*</span>
            </label>
            <input
              name="date"
              type="date"
              required
              className="w-full px-3 py-2 text-sm border border-border-brand rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent text-ink2"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-ink2 mb-1.5">
                Start Time <span className="text-red-500">*</span>
              </label>
              <input
                name="start_time"
                type="time"
                required
                className="w-full px-3 py-2 text-sm border border-border-brand rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent text-ink2"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-ink2 mb-1.5">
                End Time <span className="text-red-500">*</span>
              </label>
              <input
                name="end_time"
                type="time"
                required
                className="w-full px-3 py-2 text-sm border border-border-brand rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent text-ink2"
              />
            </div>
          </div>

          {staff.length > 0 && (
            <div>
              <label className="block text-xs font-medium text-ink2 mb-1.5">Assigned staff</label>
              <select
                name="assigned_staff_id"
                className="w-full px-3 py-2 text-sm border border-border-brand rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent bg-white text-ink2"
              >
                <option value="">Any available</option>
                {staff.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-ink2 mb-1.5">Notes</label>
            <textarea
              name="notes"
              rows={3}
              placeholder="Optional notes…"
              className="w-full px-3 py-2 text-sm border border-border-brand rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent placeholder:text-gray-300 resize-none"
            />
          </div>

          <div className="flex items-center gap-3 pt-2">
            <SubmitButton />
            <Link
              href="/appointments"
              className="px-4 py-2 text-sm text-ink3 hover:text-ink2 transition-colors"
            >
              Cancel
            </Link>
          </div>
        </form>
      </div>
    </div>
  )
}
