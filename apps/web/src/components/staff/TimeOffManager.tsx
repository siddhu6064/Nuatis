'use client'

import { useState, useEffect, useCallback } from 'react'
import Button from '@mui/material/Button'

interface TimeOffRequest {
  id: string
  staff_id: string
  start_date: string
  end_date: string
  reason: string | null
  status: 'pending' | 'approved' | 'rejected'
  staff_members: { id: string; name: string; color_hex: string } | null
}

const STATUS_STYLE: Record<TimeOffRequest['status'], string> = {
  pending: 'bg-amber-50 text-amber-700',
  approved: 'bg-green-50 text-green-700',
  rejected: 'bg-red-50 text-red-700',
}

export default function TimeOffManager() {
  const [requests, setRequests] = useState<TimeOffRequest[] | null>(null)
  const [actingId, setActingId] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  const load = useCallback(() => {
    fetch('/api/time-off')
      .then((r) => r.json())
      .then((data: { data: TimeOffRequest[] }) => setRequests(data.data ?? []))
  }, [])

  useEffect(load, [load])

  async function act(id: string, action: 'approve' | 'reject') {
    setActingId(id)
    try {
      const res = await fetch(`/api/time-off/${id}/${action}`, { method: 'POST' })
      if (res.ok && action === 'approve') {
        const body = (await res.json()) as {
          shift_conflicts?: Array<{ date: string; start_time: string; end_time: string }> | null
        }
        if (body.shift_conflicts?.length) {
          setToast(
            `Approved — but ${body.shift_conflicts.length} shift(s) still scheduled during this range. Reassign coverage.`
          )
        }
      }
      load()
    } finally {
      setActingId(null)
    }
  }

  useEffect(() => {
    if (!toast) return undefined
    const t = setTimeout(() => setToast(null), 6000)
    return () => clearTimeout(t)
  }, [toast])

  return (
    <div className="bg-white rounded-xl border border-border-brand overflow-hidden">
      {toast && (
        <div className="px-4 py-2.5 bg-amber-50 text-amber-800 text-sm border-b border-amber-100">
          {toast}
        </div>
      )}
      <table className="w-full text-sm">
        <thead className="bg-bg2 text-ink3 text-xs uppercase tracking-wide">
          <tr>
            <th className="text-left px-4 py-2">Staff</th>
            <th className="text-left px-4 py-2">Dates</th>
            <th className="text-left px-4 py-2">Reason</th>
            <th className="text-left px-4 py-2">Status</th>
            <th className="px-4 py-2" />
          </tr>
        </thead>
        <tbody className="divide-y divide-border-brand">
          {requests === null ? (
            <tr>
              <td colSpan={5} className="px-4 py-6 text-center text-ink4">
                Loading…
              </td>
            </tr>
          ) : requests.length === 0 ? (
            <tr>
              <td colSpan={5} className="px-4 py-6 text-center text-ink4">
                No time-off requests yet.
              </td>
            </tr>
          ) : (
            requests.map((r) => (
              <tr key={r.id}>
                <td className="px-4 py-2.5 text-ink font-medium">{r.staff_members?.name ?? '—'}</td>
                <td className="px-4 py-2.5 text-ink3">
                  {r.start_date} – {r.end_date}
                </td>
                <td className="px-4 py-2.5 text-ink3">{r.reason ?? '—'}</td>
                <td className="px-4 py-2.5">
                  <span
                    className={`px-2 py-0.5 rounded text-xs font-medium capitalize ${STATUS_STYLE[r.status]}`}
                  >
                    {r.status}
                  </span>
                </td>
                <td className="px-4 py-2.5 text-right">
                  {r.status === 'pending' && (
                    <div className="flex justify-end gap-2">
                      <Button
                        onClick={() => void act(r.id, 'approve')}
                        disabled={actingId === r.id}
                        size="small"
                        variant="contained"
                      >
                        Approve
                      </Button>
                      <Button
                        onClick={() => void act(r.id, 'reject')}
                        disabled={actingId === r.id}
                        size="small"
                        color="inherit"
                      >
                        Reject
                      </Button>
                    </div>
                  )}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  )
}
