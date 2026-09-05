'use client'

import { useState, useEffect, use, useCallback } from 'react'

interface ManageData {
  title: string
  start_time: string
  end_time: string
  status: string
  business_name: string | null
  min_notice_hours: number
  can_modify: boolean
}

interface Slot {
  start: string
  end: string
}

export default function ManageBookingPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params)

  const [data, setData] = useState<ManageData | null>(null)
  const [notFound, setNotFound] = useState(false)
  const [mode, setMode] = useState<'view' | 'reschedule'>('view')
  const [date, setDate] = useState('')
  const [slots, setSlots] = useState<Slot[] | null>(null)
  const [loadingSlots, setLoadingSlots] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)

  const load = useCallback(() => {
    fetch(`/api/booking-manage/${token}`)
      .then((r) => {
        if (!r.ok) {
          setNotFound(true)
          return null
        }
        return r.json()
      })
      .then((d: ManageData | null) => {
        if (d) setData(d)
      })
  }, [token])

  useEffect(load, [load])

  async function loadSlots(d: string) {
    setDate(d)
    setSlots(null)
    if (!d) return
    setLoadingSlots(true)
    try {
      const res = await fetch(`/api/booking-manage/${token}/available-slots?date=${d}`)
      const body = (await res.json()) as { slots?: Slot[] }
      setSlots(body.slots ?? [])
    } finally {
      setLoadingSlots(false)
    }
  }

  async function confirmReschedule(slot: Slot) {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/booking-manage/${token}/reschedule`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date, start_time: slot.start }),
      })
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string }
        setError(err.error ?? 'Failed to reschedule')
        return
      }
      setDone('Your appointment has been rescheduled.')
      load()
      setMode('view')
    } finally {
      setBusy(false)
    }
  }

  async function cancelBooking() {
    if (!confirm('Cancel this appointment?')) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/booking-manage/${token}/cancel`, { method: 'POST' })
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string }
        setError(err.error ?? 'Failed to cancel')
        return
      }
      setDone('Your appointment has been canceled.')
      load()
    } finally {
      setBusy(false)
    }
  }

  if (notFound) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <p className="text-sm text-gray-500">This booking link is invalid or has expired.</p>
      </div>
    )
  }
  if (!data) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <p className="text-sm text-gray-500">Loading…</p>
      </div>
    )
  }

  const start = new Date(data.start_time)

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-10 bg-gray-50">
      <div className="w-full max-w-md bg-white rounded-2xl border border-gray-200 shadow-sm p-6">
        <p className="text-xs uppercase tracking-wide text-gray-400 mb-1">
          {data.business_name ?? 'Your appointment'}
        </p>
        <h1 className="text-lg font-semibold text-gray-900 mb-1">{data.title}</h1>
        <p className="text-sm text-gray-600 mb-4">
          {start.toLocaleDateString(undefined, {
            weekday: 'long',
            month: 'long',
            day: 'numeric',
          })}{' '}
          at {start.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
        </p>

        <span
          className={`inline-flex px-2 py-0.5 rounded text-xs font-medium mb-4 ${
            data.status === 'canceled'
              ? 'bg-red-50 text-red-700'
              : data.status === 'completed'
                ? 'bg-green-50 text-green-700'
                : 'bg-teal-50 text-teal-700'
          }`}
        >
          {data.status}
        </span>

        {done && (
          <p className="text-sm text-teal-700 bg-teal-50 rounded-lg px-3 py-2 mb-4">{done}</p>
        )}
        {error && (
          <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2 mb-4">{error}</p>
        )}

        {!data.can_modify ? (
          <p className="text-sm text-gray-500">
            This appointment can no longer be changed online — it starts in less than{' '}
            {data.min_notice_hours}h, or is already {data.status}. Please contact the business
            directly.
          </p>
        ) : mode === 'view' ? (
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setMode('reschedule')}
              className="flex-1 py-2 px-4 bg-teal-600 text-white text-sm font-medium rounded-lg hover:bg-teal-700"
            >
              Reschedule
            </button>
            <button
              type="button"
              onClick={() => void cancelBooking()}
              disabled={busy}
              className="flex-1 py-2 px-4 border border-red-200 text-red-600 text-sm font-medium rounded-lg hover:bg-red-50 disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            <input
              type="date"
              value={date}
              min={new Date().toISOString().slice(0, 10)}
              onChange={(e) => void loadSlots(e.target.value)}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
            />
            {loadingSlots ? (
              <p className="text-sm text-gray-400">Loading times…</p>
            ) : slots !== null ? (
              slots.length === 0 ? (
                <p className="text-sm text-gray-400">No times available that day.</p>
              ) : (
                <div className="grid grid-cols-3 gap-2">
                  {slots.map((s) => (
                    <button
                      key={s.start}
                      type="button"
                      onClick={() => void confirmReschedule(s)}
                      disabled={busy}
                      className="py-2 text-sm border border-gray-200 rounded-lg hover:border-teal-500 hover:text-teal-700 disabled:opacity-50"
                    >
                      {s.start}
                    </button>
                  ))}
                </div>
              )
            ) : null}
            <button
              type="button"
              onClick={() => setMode('view')}
              className="text-xs text-gray-400 hover:text-gray-600"
            >
              ← Back
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
