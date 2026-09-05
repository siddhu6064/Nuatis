'use client'

import { useEffect, useState } from 'react'

interface Shift {
  id: string
  date: string
  start_time: string
  end_time: string
  notes: string | null
}

interface Appointment {
  id: string
  start_time: string
  title?: string | null
  status: string
  contacts?: { full_name?: string | null; phone?: string | null } | null
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10)
}

export default function MySchedulePage() {
  const [shifts, setShifts] = useState<Shift[] | null>(null)
  const [appointments, setAppointments] = useState<Appointment[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const start = todayISO()
    const end = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)

    Promise.all([
      fetch(`/api/staff-portal/shifts?start_date=${start}&end_date=${end}`).then((r) => r.json()),
      fetch('/api/staff-portal/appointments').then((r) => r.json()),
    ])
      .then(([shiftsRes, apptRes]) => {
        setShifts((shiftsRes.data ?? []) as Shift[])
        const upcoming = ((apptRes.data ?? []) as Appointment[]).filter(
          (a) => a.start_time >= new Date().toISOString()
        )
        setAppointments(upcoming.slice(0, 20))
      })
      .catch(() => setError('Failed to load your schedule'))
  }, [])

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-ink">My Schedule</h1>
        <p className="text-sm text-ink4">Your upcoming shifts and assigned appointments.</p>
      </div>

      {error && (
        <p className="text-xs text-red-600 bg-red-50 border border-red-100 px-3 py-2 rounded-lg">
          {error}
        </p>
      )}

      <section className="bg-white rounded-xl border border-border-brand">
        <div className="px-4 py-3 border-b border-border-brand">
          <h2 className="text-sm font-semibold text-ink">Upcoming shifts</h2>
        </div>
        {shifts === null ? (
          <p className="px-4 py-4 text-sm text-ink4">Loading…</p>
        ) : shifts.length === 0 ? (
          <p className="px-4 py-4 text-sm text-ink4">No shifts scheduled in the next 14 days.</p>
        ) : (
          <ul className="divide-y divide-border-brand">
            {shifts.map((s) => (
              <li key={s.id} className="px-4 py-3 flex items-center justify-between">
                <span className="text-sm text-ink">{s.date}</span>
                <span className="text-sm text-ink3">
                  {s.start_time}–{s.end_time}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="bg-white rounded-xl border border-border-brand">
        <div className="px-4 py-3 border-b border-border-brand">
          <h2 className="text-sm font-semibold text-ink">Upcoming appointments</h2>
        </div>
        {appointments === null ? (
          <p className="px-4 py-4 text-sm text-ink4">Loading…</p>
        ) : appointments.length === 0 ? (
          <p className="px-4 py-4 text-sm text-ink4">No upcoming appointments assigned to you.</p>
        ) : (
          <ul className="divide-y divide-border-brand">
            {appointments.map((a) => (
              <li key={a.id} className="px-4 py-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-ink">
                    {a.contacts?.full_name ?? a.title ?? 'Appointment'}
                  </span>
                  <span className="text-xs text-ink4">
                    {new Date(a.start_time).toLocaleString()}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
