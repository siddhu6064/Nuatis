'use client'

import { useState, useEffect } from 'react'

type JobStatus =
  | 'pending'
  | 'dialing'
  | 'connected'
  | 'completed'
  | 'failed'
  | 'no_answer'
  | 'cancelled'

interface OutboundCallJob {
  id: string
  trigger_type: string
  status: JobStatus
  scheduled_at: string
  started_at: string | null
  completed_at: string | null
  attempts: number
  max_attempts: number
  notes: string | null
  contacts: { full_name: string | null; phone: string | null } | null
}

const STATUS_BADGE: Record<JobStatus, { cls: string; label: string }> = {
  pending: { cls: 'bg-amber-50 text-amber-700', label: 'Pending' },
  dialing: { cls: 'bg-blue-50 text-blue-700', label: 'Dialing' },
  connected: { cls: 'bg-green-50 text-green-700', label: 'Connected' },
  completed: { cls: 'bg-teal-50 text-teal-700', label: 'Completed' },
  failed: { cls: 'bg-red-50 text-red-600', label: 'Failed' },
  no_answer: { cls: 'bg-gray-100 text-gray-600', label: 'No Answer' },
  cancelled: { cls: 'bg-gray-100 text-gray-500', label: 'Cancelled' },
}

function StatusBadge({ status }: { status: JobStatus }) {
  const { cls, label } = STATUS_BADGE[status] ?? { cls: 'bg-gray-100 text-gray-600', label: status }
  return (
    <span
      className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold ${cls}`}
    >
      {label}
    </span>
  )
}

const FILTERS: Array<{ label: string; value: string }> = [
  { label: 'All', value: '' },
  { label: 'Pending', value: 'pending' },
  { label: 'Completed', value: 'completed' },
  { label: 'Failed', value: 'failed' },
]

function formatTime(iso: string) {
  return new Date(iso).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export default function OutboundCallsPage() {
  const [jobs, setJobs] = useState<OutboundCallJob[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState('')
  const [cancelling, setCancelling] = useState<string | null>(null)

  async function loadJobs() {
    setLoading(true)
    setError(null)
    const url = statusFilter ? `/api/outbound-calls?status=${statusFilter}` : '/api/outbound-calls'
    const r = await fetch(url)
    if (!r.ok) {
      setError('Failed to load')
      setLoading(false)
      return
    }
    const d = (await r.json()) as { jobs: OutboundCallJob[] }
    setJobs(d.jobs)
    setLoading(false)
  }

  useEffect(() => {
    void loadJobs()
  }, [statusFilter])

  async function handleCancel(id: string) {
    if (!confirm('Cancel this call?')) return
    setCancelling(id)
    const r = await fetch(`/api/outbound-calls/${id}/cancel`, { method: 'POST' })
    if (r.ok) {
      setJobs((prev) => prev.map((j) => (j.id === id ? { ...j, status: 'cancelled' } : j)))
    } else {
      const d = (await r.json().catch(() => ({}))) as { error?: string }
      alert(d.error ?? 'Failed to cancel')
    }
    setCancelling(null)
  }

  return (
    <div className="px-8 py-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-ink">Outbound Calls</h1>
          <p className="text-sm text-ink3 mt-0.5">Maya proactively dials leads and contacts</p>
        </div>
        <button
          type="button"
          onClick={() => void loadJobs()}
          className="px-4 py-2 text-sm font-medium text-teal-700 bg-teal-50 hover:bg-teal-100 rounded-lg transition-colors"
        >
          Refresh
        </button>
      </div>

      {/* Automation placeholder card */}
      <div className="bg-amber-50 border border-amber-200 rounded-xl px-6 py-4 mb-6">
        <h2 className="text-sm font-semibold text-amber-800">Outbound Call Triggers</h2>
        <p className="text-xs text-amber-700 mt-1">
          Auto-dial leads when conditions are met (lead status change, deal stage, no-response) —
          configuration coming in P16.
        </p>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1 mb-4">
        {FILTERS.map((f) => (
          <button
            key={f.value}
            onClick={() => setStatusFilter(f.value)}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
              statusFilter === f.value ? 'bg-teal-600 text-white' : 'bg-bg text-ink3 hover:text-ink'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Error */}
      {error && (
        <div className="mb-4 px-4 py-3 bg-red-50 text-red-600 text-sm rounded-lg">{error}</div>
      )}

      {/* Loading */}
      {loading && (
        <div className="bg-white rounded-xl border border-border-brand px-6 py-12 text-center">
          <p className="text-sm text-ink4">Loading…</p>
        </div>
      )}

      {/* Empty */}
      {!loading && !error && jobs.length === 0 && (
        <div className="bg-white rounded-xl border border-border-brand px-8 py-16 text-center">
          <p className="text-sm text-ink3">No outbound calls yet.</p>
          <p className="text-xs text-ink4 mt-1">Initiate a call from a contact&apos;s profile.</p>
        </div>
      )}

      {/* Table */}
      {!loading && !error && jobs.length > 0 && (
        <div className="bg-white rounded-xl border border-border-brand overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border-brand">
                <th className="text-left px-6 py-3 text-xs font-semibold text-ink3 uppercase tracking-wide">
                  Contact
                </th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-ink3 uppercase tracking-wide">
                  Trigger
                </th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-ink3 uppercase tracking-wide">
                  Status
                </th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-ink3 uppercase tracking-wide">
                  Scheduled
                </th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-ink3 uppercase tracking-wide">
                  Attempts
                </th>
                <th className="text-right px-6 py-3 text-xs font-semibold text-ink3 uppercase tracking-wide">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {jobs.map((job) => (
                <tr key={job.id} className="hover:bg-gray-50/50 transition-colors">
                  <td className="px-6 py-3.5">
                    <p className="text-sm font-medium text-ink">
                      {job.contacts?.full_name ?? 'Unknown'}
                    </p>
                    <p className="text-xs text-ink4">{job.contacts?.phone ?? '—'}</p>
                  </td>
                  <td className="px-4 py-3.5">
                    <span className="text-xs text-ink3 capitalize">
                      {job.trigger_type.replace(/_/g, ' ')}
                    </span>
                  </td>
                  <td className="px-4 py-3.5">
                    <StatusBadge status={job.status} />
                    {job.notes && <p className="text-xs text-ink4 mt-0.5">{job.notes}</p>}
                  </td>
                  <td className="px-4 py-3.5 text-sm text-ink2">{formatTime(job.scheduled_at)}</td>
                  <td className="px-4 py-3.5 text-right text-sm text-ink2">
                    {job.attempts}/{job.max_attempts}
                  </td>
                  <td className="px-6 py-3.5 text-right">
                    {job.status === 'pending' && (
                      <button
                        type="button"
                        onClick={() => void handleCancel(job.id)}
                        disabled={cancelling === job.id}
                        className="text-xs text-red-600 hover:text-red-700 font-medium disabled:opacity-50"
                      >
                        Cancel
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
