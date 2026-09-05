'use client'

import { useEffect, useState } from 'react'

interface TimeOffRequest {
  id: string
  start_date: string
  end_date: string
  reason: string | null
  status: 'pending' | 'approved' | 'rejected'
  approval_note: string | null
}

const STATUS_STYLE: Record<TimeOffRequest['status'], string> = {
  pending: 'bg-amber-50 text-amber-700',
  approved: 'bg-green-50 text-green-700',
  rejected: 'bg-red-50 text-red-700',
}

export default function TimeOffPage() {
  const [requests, setRequests] = useState<TimeOffRequest[] | null>(null)
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [reason, setReason] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = () => {
    fetch('/api/staff-portal/time-off')
      .then((r) => r.json())
      .then((data: { data: TimeOffRequest[] }) => setRequests(data.data ?? []))
  }

  useEffect(load, [])

  async function submit() {
    setError(null)
    if (!startDate || !endDate) {
      setError('Start and end date are required')
      return
    }
    setSubmitting(true)
    try {
      const res = await fetch('/api/staff-portal/time-off', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          start_date: startDate,
          end_date: endDate,
          reason: reason.trim() || undefined,
        }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        setError(body.error ?? 'Failed to submit request')
        return
      }
      setStartDate('')
      setEndDate('')
      setReason('')
      load()
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-ink">Time Off</h1>
        <p className="text-sm text-ink4">Request time off and track approval status.</p>
      </div>

      <section className="bg-white rounded-xl border border-border-brand p-5 space-y-3">
        <h2 className="text-sm font-semibold text-ink">Request time off</h2>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-ink3 mb-1">Start date</label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="w-full text-sm border border-border-brand rounded-lg px-3 py-2"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-ink3 mb-1">End date</label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="w-full text-sm border border-border-brand rounded-lg px-3 py-2"
            />
          </div>
        </div>
        <div>
          <label className="block text-xs font-medium text-ink3 mb-1">Reason (optional)</label>
          <input
            type="text"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Vacation"
            className="w-full text-sm border border-border-brand rounded-lg px-3 py-2"
          />
        </div>
        {error && <p className="text-xs text-red-600">{error}</p>}
        <button
          type="button"
          disabled={submitting}
          onClick={() => void submit()}
          className="px-4 py-2 rounded-lg text-sm font-medium bg-teal-600 text-white hover:bg-teal-700 disabled:opacity-60"
        >
          {submitting ? 'Submitting…' : 'Submit request'}
        </button>
      </section>

      <section className="bg-white rounded-xl border border-border-brand">
        <div className="px-4 py-3 border-b border-border-brand">
          <h2 className="text-sm font-semibold text-ink">My requests</h2>
        </div>
        {requests === null ? (
          <p className="px-4 py-4 text-sm text-ink4">Loading…</p>
        ) : requests.length === 0 ? (
          <p className="px-4 py-4 text-sm text-ink4">No time-off requests yet.</p>
        ) : (
          <ul className="divide-y divide-border-brand">
            {requests.map((r) => (
              <li key={r.id} className="px-4 py-3 flex items-center justify-between">
                <div>
                  <p className="text-sm text-ink">
                    {r.start_date} – {r.end_date}
                  </p>
                  {r.reason && <p className="text-xs text-ink4 mt-0.5">{r.reason}</p>}
                  {r.approval_note && (
                    <p className="text-xs text-ink4 mt-0.5">Note: {r.approval_note}</p>
                  )}
                </div>
                <span
                  className={`px-2 py-0.5 rounded text-xs font-medium capitalize ${STATUS_STYLE[r.status]}`}
                >
                  {r.status}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
