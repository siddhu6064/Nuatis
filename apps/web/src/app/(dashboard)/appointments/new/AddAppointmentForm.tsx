'use client'

import { useState, useEffect, useRef } from 'react'
import { useFormStatus } from 'react-dom'
import Link from 'next/link'
import { createAppointment } from './actions'

interface Service {
  id: string
  name: string
  duration_minutes: number | null
}

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

const DURATIONS = [15, 30, 45, 60, 90]

function addMinutesToTime(time: string, minutes: number): string {
  if (!time) return ''
  const parts = time.split(':')
  const h = Number(parts[0])
  const m = Number(parts[1])
  if (isNaN(h) || isNaN(m)) return ''
  const total = h * 60 + m + minutes
  const eh = Math.floor(total / 60) % 24
  const em = total % 60
  return `${String(eh).padStart(2, '0')}:${String(em).padStart(2, '0')}`
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
  const [services, setServices] = useState<Service[]>([])
  const [serviceId, setServiceId] = useState('')
  const [titleValue, setTitleValue] = useState('')
  const [startTime, setStartTime] = useState('')
  const [durationMinutes, setDurationMinutes] = useState(30)
  const [durationFlash, setDurationFlash] = useState(false)
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const endTime = addMinutesToTime(startTime, durationMinutes)

  useEffect(() => {
    fetch('/api/services')
      .then((r) => (r.ok ? r.json() : { services: [] }))
      .then((d: { services: Service[] }) => setServices(d.services ?? []))
      .catch(() => {})
  }, [])

  function handleServiceChange(id: string) {
    setServiceId(id)
    const svc = services.find((s) => s.id === id)
    if (!svc) return

    if (!titleValue.trim()) setTitleValue(svc.name)

    if (svc.duration_minutes) {
      setDurationMinutes(svc.duration_minutes)
      setDurationFlash(true)
      if (flashTimer.current) clearTimeout(flashTimer.current)
      flashTimer.current = setTimeout(() => setDurationFlash(false), 1500)
    }
  }

  return (
    <div className="max-w-lg">
      <div className="bg-white rounded-xl border border-border-brand p-6">
        <form action={createAppointment} className="space-y-4">
          {/* Service select — shown only when CPQ services exist */}
          {services.length > 0 && (
            <div>
              <label className="block text-xs font-medium text-ink2 mb-1.5">Service</label>
              <select
                name="service_id"
                value={serviceId}
                onChange={(e) => handleServiceChange(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-border-brand rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent bg-white text-ink2"
              >
                <option value="">No specific service</option>
                {services.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                    {s.duration_minutes ? ` (${s.duration_minutes} min)` : ''}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-ink2 mb-1.5">
              Title <span className="text-red-500">*</span>
            </label>
            <input
              name="title"
              type="text"
              required
              autoFocus={services.length === 0}
              value={titleValue}
              onChange={(e) => setTitleValue(e.target.value)}
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
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-border-brand rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent text-ink2"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-ink2 mb-1.5">Duration</label>
              <select
                value={durationMinutes}
                onChange={(e) => setDurationMinutes(parseInt(e.target.value, 10))}
                className={`w-full px-3 py-2 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:border-transparent bg-white text-ink2 transition-all duration-300 ${
                  durationFlash
                    ? 'border-teal-400 ring-2 ring-teal-400'
                    : 'border-border-brand focus:ring-teal-500'
                }`}
              >
                {DURATIONS.map((d) => (
                  <option key={d} value={d}>
                    {d} min
                  </option>
                ))}
              </select>
            </div>
          </div>

          {startTime && endTime && <p className="text-xs text-ink4 -mt-2">Ends at {endTime}</p>}

          {/* Computed end_time for server action */}
          <input type="hidden" name="end_time" value={endTime} />

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
