'use client'

import { useState, useEffect, useCallback } from 'react'
import type {
  VideoCollector,
  VideoTestimonial,
  VideoCollectorStatus,
  VideoTestimonialStatus,
} from '@nuatis/shared'

// ── helpers ────────────────────────────────────────────────────

function statusBadge(status: VideoCollectorStatus) {
  const map: Record<VideoCollectorStatus, string> = {
    active: 'bg-green-50 text-green-700',
    paused: 'bg-amber-50 text-amber-700',
    archived: 'bg-gray-100 text-ink4',
  }
  return map[status]
}

function submissionStatusBadge(status: VideoTestimonialStatus) {
  const map: Record<VideoTestimonialStatus, string> = {
    pending: 'bg-gray-100 text-ink4',
    approved: 'bg-green-50 text-green-700',
    featured: 'bg-teal-50 text-teal-700',
    rejected: 'bg-red-50 text-red-600',
  }
  return map[status]
}

function sentimentBadge(sentiment: string | null) {
  if (sentiment === 'positive') return 'bg-green-50 text-green-700'
  if (sentiment === 'negative') return 'bg-red-50 text-red-600'
  return 'bg-gray-100 text-ink4'
}

// ── CreateCollectorForm ────────────────────────────────────────

interface CreateCollectorFormProps {
  onCreated: (c: VideoCollector) => void
  onCancel: () => void
}

function CreateCollectorForm({ onCreated, onCancel }: CreateCollectorFormProps) {
  const [name, setName] = useState('')
  const [prompt, setPrompt] = useState("Tell us about your experience!")
  const [maxDuration, setMaxDuration] = useState<15 | 30 | 60>(30)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleCreate() {
    if (!name.trim()) {
      setError('Name is required')
      return
    }
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/video-testimonials/collectors', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), prompt: prompt.trim(), max_duration_seconds: maxDuration }),
      })
      if (!res.ok) {
        const j = (await res.json()) as { error?: string }
        setError(j.error ?? 'Failed to create collector')
        return
      }
      const collector = (await res.json()) as VideoCollector
      onCreated(collector)
    } catch {
      setError('Network error — please try again')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="bg-white rounded-xl border border-border-brand p-5 space-y-4">
      <h3 className="text-sm font-semibold text-ink">New Video Collector</h3>

      {error && (
        <p className="text-xs text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>
      )}

      <div className="space-y-3">
        <div>
          <label className="block text-xs font-medium text-ink3 mb-1">Name *</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Summer Campaign"
            className="w-full text-sm border border-border-brand rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-teal-400 text-ink placeholder:text-ink4"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-ink3 mb-1">Prompt</label>
          <input
            type="text"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            className="w-full text-sm border border-border-brand rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-teal-400 text-ink placeholder:text-ink4"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-ink3 mb-1">Max Duration</label>
          <select
            value={maxDuration}
            onChange={(e) => setMaxDuration(Number(e.target.value) as 15 | 30 | 60)}
            className="text-sm border border-border-brand rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-teal-400 text-ink bg-white"
          >
            <option value={15}>15 seconds</option>
            <option value={30}>30 seconds</option>
            <option value={60}>60 seconds</option>
          </select>
        </div>
      </div>

      <div className="flex items-center gap-2 pt-1">
        <button
          onClick={() => void handleCreate()}
          disabled={saving}
          className="px-4 py-2 bg-teal-600 text-white rounded-lg text-xs font-medium hover:bg-teal-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {saving ? 'Creating...' : 'Create'}
        </button>
        <button
          onClick={onCancel}
          disabled={saving}
          className="px-4 py-2 border border-border-brand text-ink3 rounded-lg text-xs font-medium hover:bg-bg transition-colors disabled:opacity-40"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}

// ── SubmissionModal ────────────────────────────────────────────

interface SubmissionModalProps {
  submission: VideoTestimonial & { signed_url?: string | null }
  onClose: () => void
  onAction: (id: string, action: 'approve' | 'reject' | 'feature') => Promise<void>
  onDelete: (id: string) => Promise<void>
}

function SubmissionModal({ submission, onClose, onAction, onDelete }: SubmissionModalProps) {
  const [acting, setActing] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)

  async function doAction(action: 'approve' | 'reject' | 'feature') {
    setActing(action)
    await onAction(submission.id, action)
    setActing(null)
  }

  async function doDelete() {
    setDeleting(true)
    await onDelete(submission.id)
    setDeleting(false)
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="p-6 space-y-5">
          {/* Header */}
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-base font-semibold text-ink">
                {submission.submitter_name ?? 'Anonymous'}
              </p>
              {submission.submitter_email && (
                <p className="text-xs text-ink3">{submission.submitter_email}</p>
              )}
              <p className="text-xs text-ink4 mt-0.5">
                {new Date(submission.submitted_at).toLocaleDateString('en-US', {
                  month: 'short', day: 'numeric', year: 'numeric',
                })}
              </p>
            </div>
            <button
              onClick={onClose}
              className="text-ink4 hover:text-ink text-lg leading-none shrink-0"
            >
              ✕
            </button>
          </div>

          {/* Video player */}
          <div className="rounded-xl overflow-hidden bg-gray-900 aspect-video flex items-center justify-center">
            {submission.signed_url ? (
              <video
                controls
                className="w-full h-full object-contain"
                src={submission.signed_url}
              />
            ) : (
              <div className="flex flex-col items-center gap-2 text-gray-500">
                <svg className="w-10 h-10" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M8 5v14l11-7z" />
                </svg>
                <p className="text-xs">Video unavailable</p>
              </div>
            )}
          </div>

          {/* Badges */}
          <div className="flex items-center gap-2 flex-wrap">
            {submission.sentiment && (
              <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium capitalize ${sentimentBadge(submission.sentiment)}`}>
                {submission.sentiment}
              </span>
            )}
            <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium capitalize ${submissionStatusBadge(submission.status)}`}>
              {submission.status}
            </span>
            {submission.duration_seconds != null && (
              <span className="text-[10px] px-2 py-0.5 rounded-full font-medium bg-gray-100 text-ink4">
                {submission.duration_seconds}s
              </span>
            )}
          </div>

          {/* Transcript */}
          {submission.transcript && (
            <div>
              <p className="text-xs font-medium text-ink3 mb-1">Transcript</p>
              <div className="bg-bg rounded-lg p-3 text-sm text-ink3 max-h-36 overflow-y-auto leading-relaxed border border-border-brand">
                {submission.transcript}
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center gap-2 flex-wrap pt-1 border-t border-border-brand">
            <button
              onClick={() => void doAction('approve')}
              disabled={!!acting || submission.status === 'approved'}
              className="px-3 py-1.5 bg-green-600 text-white rounded-lg text-xs font-medium hover:bg-green-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {acting === 'approve' ? '...' : 'Approve'}
            </button>
            <button
              onClick={() => void doAction('reject')}
              disabled={!!acting || submission.status === 'rejected'}
              className="px-3 py-1.5 bg-red-600 text-white rounded-lg text-xs font-medium hover:bg-red-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {acting === 'reject' ? '...' : 'Reject'}
            </button>
            <button
              onClick={() => void doAction('feature')}
              disabled={!!acting || submission.status === 'featured'}
              className="px-3 py-1.5 bg-teal-600 text-white rounded-lg text-xs font-medium hover:bg-teal-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {acting === 'feature' ? '...' : 'Feature'}
            </button>

            <div className="flex-1" />

            <button
              onClick={() => void doDelete()}
              disabled={deleting}
              className="px-3 py-1.5 bg-red-50 text-red-600 border border-red-200 rounded-lg text-xs font-medium hover:bg-red-100 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {deleting ? 'Deleting...' : 'Delete'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── SubmissionsGrid ────────────────────────────────────────────

interface SubmissionsGridProps {
  collectorId: string
  onBack: () => void
}

type SubmissionFilter = 'all' | VideoTestimonialStatus

function SubmissionsGrid({ collectorId, onBack }: SubmissionsGridProps) {
  const [submissions, setSubmissions] = useState<VideoTestimonial[]>([])
  const [loading, setLoading] = useState(false)
  const [filter, setFilter] = useState<SubmissionFilter>('all')
  const [selected, setSelected] = useState<(VideoTestimonial & { signed_url?: string | null }) | null>(null)

  const fetchSubmissions = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/video-testimonials?collector_id=${collectorId}`, {
        credentials: 'include',
      })
      if (!res.ok) return
      const data = (await res.json()) as { testimonials?: VideoTestimonial[] }
      setSubmissions(data.testimonials ?? [])
    } catch {
      // silently ignore
    } finally {
      setLoading(false)
    }
  }, [collectorId])

  useEffect(() => {
    void fetchSubmissions()
  }, [fetchSubmissions])

  async function openSubmission(s: VideoTestimonial) {
    // Fetch signed URL
    try {
      const res = await fetch(`/api/video-testimonials/${s.id}`, { credentials: 'include' })
      if (res.ok) {
        const data = (await res.json()) as { testimonial?: VideoTestimonial & { signed_url?: string | null } }
        setSelected(data.testimonial ?? { ...s })
      } else {
        setSelected(s)
      }
    } catch {
      setSelected(s)
    }
  }

  async function handleAction(id: string, action: 'approve' | 'reject' | 'feature') {
    try {
      await fetch(`/api/video-testimonials/${id}/${action}`, {
        method: 'POST',
        credentials: 'include',
      })
      await fetchSubmissions()
      // Update selected if open
      if (selected?.id === id) {
        const updated = submissions.find((s) => s.id === id)
        if (updated) {
          const statusMap: Record<string, VideoTestimonialStatus> = {
            approve: 'approved',
            reject: 'rejected',
            feature: 'featured',
          }
          setSelected({ ...selected, status: statusMap[action] ?? selected.status })
        }
      }
    } catch {
      // ignore
    }
  }

  async function handleDelete(id: string) {
    try {
      await fetch(`/api/video-testimonials/${id}`, {
        method: 'DELETE',
        credentials: 'include',
      })
      setSelected(null)
      await fetchSubmissions()
    } catch {
      // ignore
    }
  }

  const filterTabs: Array<{ id: SubmissionFilter; label: string }> = [
    { id: 'all', label: 'All' },
    { id: 'pending', label: 'Pending' },
    { id: 'approved', label: 'Approved' },
    { id: 'featured', label: 'Featured' },
    { id: 'rejected', label: 'Rejected' },
  ]

  const filtered =
    filter === 'all' ? submissions : submissions.filter((s) => s.status === filter)

  return (
    <div className="space-y-4">
      {/* Sub-header */}
      <div className="flex items-center gap-3">
        <button
          onClick={onBack}
          className="flex items-center gap-1 text-xs text-teal-600 hover:text-teal-700 font-medium"
        >
          ← Back to collectors
        </button>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1 bg-bg rounded-lg p-1 w-fit">
        {filterTabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setFilter(t.id)}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
              filter === t.id ? 'bg-white text-ink shadow-sm' : 'text-ink3 hover:text-ink'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12 text-ink4 text-sm">
          Loading submissions...
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex items-center justify-center py-12 text-ink4 text-sm">
          No {filter === 'all' ? '' : filter} submissions.
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((s) => (
            <button
              key={s.id}
              onClick={() => void openSubmission(s)}
              className="bg-white rounded-xl border border-border-brand overflow-hidden text-left hover:shadow-md transition-shadow"
            >
              {/* Thumbnail placeholder */}
              <div className="bg-gray-100 h-32 flex items-center justify-center">
                <svg className="w-8 h-8 text-gray-400" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M8 5v14l11-7z" />
                </svg>
              </div>
              <div className="p-3 space-y-1.5">
                <p className="text-sm font-medium text-ink truncate">
                  {s.submitter_name ?? 'Anonymous'}
                </p>
                <p className="text-xs text-ink4">
                  {new Date(s.submitted_at).toLocaleDateString('en-US', {
                    month: 'short', day: 'numeric', year: 'numeric',
                  })}
                </p>
                <div className="flex items-center gap-1.5 flex-wrap">
                  {s.sentiment && (
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium capitalize ${sentimentBadge(s.sentiment)}`}>
                      {s.sentiment}
                    </span>
                  )}
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium capitalize ${submissionStatusBadge(s.status)}`}>
                    {s.status}
                  </span>
                </div>
              </div>
            </button>
          ))}
        </div>
      )}

      {selected && (
        <SubmissionModal
          submission={selected}
          onClose={() => setSelected(null)}
          onAction={handleAction}
          onDelete={handleDelete}
        />
      )}
    </div>
  )
}

// ── VideoReviewsTab ────────────────────────────────────────────

export default function VideoReviewsTab() {
  const [collectors, setCollectors] = useState<VideoCollector[]>([])
  const [collectorsLoading, setCollectorsLoading] = useState(true)
  const [createOpen, setCreateOpen] = useState(false)
  const [selectedCollectorId, setSelectedCollectorId] = useState<string | null>(null)
  const [copied, setCopied] = useState<string | null>(null)
  const [toggling, setToggling] = useState<string | null>(null)
  const [archiving, setArchiving] = useState<string | null>(null)

  useEffect(() => {
    void fetchCollectors()
  }, [])

  async function fetchCollectors() {
    setCollectorsLoading(true)
    try {
      const res = await fetch('/api/video-testimonials/collectors', { credentials: 'include' })
      if (!res.ok) return
      const data = (await res.json()) as { collectors?: VideoCollector[] }
      setCollectors(data.collectors ?? [])
    } catch {
      // silently ignore
    } finally {
      setCollectorsLoading(false)
    }
  }

  function handleCreated(c: VideoCollector) {
    setCollectors((prev) => [c, ...prev])
    setCreateOpen(false)
  }

  async function copyLink(c: VideoCollector) {
    const link = c.collect_url ?? `https://app.nuatis.com/collect/${c.slug}`
    try {
      await navigator.clipboard.writeText(link)
    } catch {
      // fallback silent
    }
    setCopied(c.id)
    setTimeout(() => setCopied(null), 2000)
  }

  async function toggleStatus(c: VideoCollector) {
    const next: VideoCollectorStatus = c.status === 'active' ? 'paused' : 'active'
    setToggling(c.id)
    try {
      const res = await fetch(`/api/video-testimonials/collectors/${c.id}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: next }),
      })
      if (res.ok) {
        setCollectors((prev) =>
          prev.map((col) => (col.id === c.id ? { ...col, status: next } : col))
        )
      }
    } catch {
      // ignore
    } finally {
      setToggling(null)
    }
  }

  async function archiveCollector(c: VideoCollector) {
    setArchiving(c.id)
    try {
      const res = await fetch(`/api/video-testimonials/collectors/${c.id}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'archived' }),
      })
      if (res.ok) {
        setCollectors((prev) =>
          prev.map((col) => (col.id === c.id ? { ...col, status: 'archived' } : col))
        )
      }
    } catch {
      // ignore
    } finally {
      setArchiving(null)
    }
  }

  // If a collector is selected, show submissions view
  if (selectedCollectorId) {
    return (
      <SubmissionsGrid
        collectorId={selectedCollectorId}
        onBack={() => setSelectedCollectorId(null)}
      />
    )
  }

  return (
    <div className="space-y-6">
      {/* Section header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-ink">Video Collectors</h2>
          <p className="text-xs text-ink3 mt-0.5">
            Share a collection link to gather video reviews from your customers.
          </p>
        </div>
        {!createOpen && (
          <button
            onClick={() => setCreateOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-teal-600 text-white rounded-lg text-xs font-medium hover:bg-teal-700 transition-colors"
          >
            <span className="text-base leading-none">+</span> Create Collector
          </button>
        )}
      </div>

      {/* Create form */}
      {createOpen && (
        <CreateCollectorForm
          onCreated={handleCreated}
          onCancel={() => setCreateOpen(false)}
        />
      )}

      {/* Collectors table */}
      {collectorsLoading ? (
        <div className="flex items-center justify-center py-12 text-ink4 text-sm">
          Loading collectors...
        </div>
      ) : collectors.length === 0 ? (
        <div className="bg-white rounded-xl border border-border-brand p-8 flex flex-col items-center gap-3 text-center">
          <div className="text-2xl">🎥</div>
          <p className="text-sm font-medium text-ink">No collectors yet</p>
          <p className="text-xs text-ink3 max-w-sm">
            Create a collector and share the link with customers to start collecting video reviews.
          </p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-border-brand overflow-hidden">
          <table className="w-full text-sm">
            <thead className="border-b border-border-brand">
              <tr>
                <th className="text-left px-4 py-3 text-xs font-medium text-ink3">Name</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-ink3 hidden md:table-cell">Prompt</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-ink3 hidden lg:table-cell">Max Duration</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-ink3">Submissions</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-ink3">Status</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-ink3 hidden xl:table-cell">Share Link</th>
                <th className="text-right px-4 py-3 text-xs font-medium text-ink3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {collectors.map((c) => {
                const link = c.collect_url ?? `https://app.nuatis.com/collect/${c.slug}`
                return (
                  <tr
                    key={c.id}
                    className="border-t border-border-brand hover:bg-bg/50 cursor-pointer transition-colors"
                    onClick={() => setSelectedCollectorId(c.id)}
                  >
                    <td className="px-4 py-3 font-medium text-ink">{c.name}</td>
                    <td className="px-4 py-3 text-ink3 max-w-[200px] truncate hidden md:table-cell">
                      {c.prompt}
                    </td>
                    <td className="px-4 py-3 text-ink3 hidden lg:table-cell">
                      {c.max_duration_seconds}s
                    </td>
                    <td className="px-4 py-3 text-ink">
                      <button
                        onClick={(e) => { e.stopPropagation(); setSelectedCollectorId(c.id) }}
                        className="text-teal-600 hover:underline font-medium"
                      >
                        {c.submission_count}
                      </button>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium capitalize ${statusBadge(c.status)}`}>
                        {c.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 hidden xl:table-cell" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-ink3 truncate max-w-[180px]">{link}</span>
                        <button
                          onClick={() => void copyLink(c)}
                          className="text-[10px] px-2 py-0.5 border border-border-brand rounded font-medium text-ink3 hover:bg-bg transition-colors shrink-0"
                        >
                          {copied === c.id ? 'Copied!' : 'Copy'}
                        </button>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-end gap-2">
                        {c.status !== 'archived' && (
                          <button
                            onClick={() => void toggleStatus(c)}
                            disabled={toggling === c.id}
                            className="text-[10px] px-2 py-0.5 border border-border-brand rounded font-medium text-ink3 hover:bg-bg transition-colors disabled:opacity-40"
                          >
                            {toggling === c.id ? '...' : c.status === 'active' ? 'Pause' : 'Activate'}
                          </button>
                        )}
                        {c.status !== 'archived' && (
                          <button
                            onClick={() => void archiveCollector(c)}
                            disabled={archiving === c.id}
                            className="text-[10px] px-2 py-0.5 border border-red-200 text-red-500 rounded font-medium hover:bg-red-50 transition-colors disabled:opacity-40"
                          >
                            {archiving === c.id ? '...' : 'Archive'}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
