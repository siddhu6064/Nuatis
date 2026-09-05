'use client'

import { useEffect, useState } from 'react'

interface Me {
  name: string
  pay_type: 'hourly' | 'salary' | null
  hourly_rate_cents: number | null
  salary_cents: number | null
}

interface TimeEntry {
  id: string
  clock_in_at: string
  clock_out_at: string | null
  notes: string | null
}

function formatDuration(startIso: string, endIso: string | null): string {
  const start = new Date(startIso).getTime()
  const end = endIso ? new Date(endIso).getTime() : Date.now()
  const mins = Math.max(0, Math.round((end - start) / 60000))
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return `${h}h ${m}m`
}

function formatPayRate(me: Me): string | null {
  if (me.pay_type === 'hourly' && me.hourly_rate_cents != null) {
    return `$${(me.hourly_rate_cents / 100).toFixed(2)} / hour`
  }
  if (me.pay_type === 'salary' && me.salary_cents != null) {
    return `$${(me.salary_cents / 100).toLocaleString()} / year`
  }
  return null
}

export default function TimesheetPage() {
  const [me, setMe] = useState<Me | null>(null)
  const [entries, setEntries] = useState<TimeEntry[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = () => {
    Promise.all([
      fetch('/api/staff-portal/me').then((r) => r.json()),
      fetch('/api/staff-portal/timesheet').then((r) => r.json()),
    ]).then(([meRes, entriesRes]) => {
      setMe(meRes as Me)
      setEntries((entriesRes.data ?? []) as TimeEntry[])
    })
  }

  useEffect(load, [])

  const openEntry = entries?.find((e) => !e.clock_out_at) ?? null

  async function clockIn() {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/staff-portal/clock-in', { method: 'POST' })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        setError(body.error ?? 'Failed to clock in')
        return
      }
      load()
    } finally {
      setBusy(false)
    }
  }

  async function clockOut() {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/staff-portal/clock-out', { method: 'POST' })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        setError(body.error ?? 'Failed to clock out')
        return
      }
      load()
    } finally {
      setBusy(false)
    }
  }

  const payRate = me ? formatPayRate(me) : null

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-ink">Timesheet</h1>
        <p className="text-sm text-ink4">Clock in and out, and see your recent hours.</p>
      </div>

      {error && (
        <p className="text-xs text-red-600 bg-red-50 border border-red-100 px-3 py-2 rounded-lg">
          {error}
        </p>
      )}

      <section className="bg-white rounded-xl border border-border-brand p-5">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-ink">
              {openEntry ? 'Currently clocked in' : 'Not clocked in'}
            </p>
            {openEntry && (
              <p className="text-xs text-ink4 mt-0.5">
                Since {new Date(openEntry.clock_in_at).toLocaleTimeString()} ·{' '}
                {formatDuration(openEntry.clock_in_at, null)}
              </p>
            )}
            {payRate && <p className="text-xs text-ink4 mt-0.5">Pay rate: {payRate}</p>}
          </div>
          <button
            type="button"
            disabled={busy || entries === null}
            onClick={() => void (openEntry ? clockOut() : clockIn())}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-60 ${
              openEntry
                ? 'bg-red-50 text-red-700 hover:bg-red-100'
                : 'bg-teal-600 text-white hover:bg-teal-700'
            }`}
          >
            {openEntry ? 'Clock out' : 'Clock in'}
          </button>
        </div>
      </section>

      <section className="bg-white rounded-xl border border-border-brand">
        <div className="px-4 py-3 border-b border-border-brand">
          <h2 className="text-sm font-semibold text-ink">Recent entries</h2>
        </div>
        {entries === null ? (
          <p className="px-4 py-4 text-sm text-ink4">Loading…</p>
        ) : entries.length === 0 ? (
          <p className="px-4 py-4 text-sm text-ink4">No time entries yet.</p>
        ) : (
          <ul className="divide-y divide-border-brand">
            {entries.map((e) => (
              <li key={e.id} className="px-4 py-3 flex items-center justify-between">
                <span className="text-sm text-ink">
                  {new Date(e.clock_in_at).toLocaleDateString()}
                </span>
                <span className="text-sm text-ink3">
                  {new Date(e.clock_in_at).toLocaleTimeString()} –{' '}
                  {e.clock_out_at ? new Date(e.clock_out_at).toLocaleTimeString() : 'open'}
                </span>
                <span className="text-xs text-ink4 tabular-nums">
                  {formatDuration(e.clock_in_at, e.clock_out_at)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
