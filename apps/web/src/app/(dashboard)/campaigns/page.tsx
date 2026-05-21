'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

// ── Types ──────────────────────────────────────────────────────────────────────

interface Campaign {
  id: string
  name: string
  status: string
  objective: string | null
  channels: string[] | null
  segment_name: string | null
  contact_count: number | null
  schedule_at: string | null
  sent_at: string | null
  created_at: string
}

interface CampaignListResponse {
  data: Campaign[]
  total: number
  page: number
}

// ── Status badge ───────────────────────────────────────────────────────────────

const STATUS_CLS: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-600',
  scheduled: 'bg-amber-50 text-amber-700',
  running: 'bg-blue-50 text-blue-700',
  complete: 'bg-green-50 text-green-700',
  paused: 'bg-orange-50 text-orange-700',
  cancelled: 'bg-gray-100 text-gray-400',
  sending: 'bg-blue-50 text-blue-700',
  sent: 'bg-green-50 text-green-700',
}
const STATUS_LABEL: Record<string, string> = {
  draft: 'Draft',
  scheduled: 'Scheduled',
  running: 'Running',
  complete: 'Complete',
  paused: 'Paused',
  cancelled: 'Cancelled',
  sending: 'Sending',
  sent: 'Sent',
}

function StatusBadge({ status }: { status: string }) {
  const isRunning = status === 'running'
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${STATUS_CLS[status] ?? 'bg-gray-100 text-gray-600'}`}
    >
      {isRunning && (
        <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse shrink-0" />
      )}
      {STATUS_LABEL[status] ?? status}
    </span>
  )
}

// ── Objective labels ───────────────────────────────────────────────────────────

const OBJECTIVE_LABEL: Record<string, string> = {
  reactivate_lapsed: 'Reactivate lapsed',
  announce_promo: 'Promotion',
  request_review: 'Request reviews',
  seasonal: 'Seasonal',
  custom: 'Custom',
}

// ── Channel chip ───────────────────────────────────────────────────────────────

const CHANNEL_LABEL: Record<string, string> = { sms: 'SMS', email: 'Email', social: 'Social' }
const CHANNEL_CLS: Record<string, string> = {
  sms: 'bg-teal-50 text-teal-700',
  email: 'bg-blue-50 text-blue-700',
  social: 'bg-purple-50 text-purple-700',
}

function ChannelChip({ channel }: { channel: string }) {
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${CHANNEL_CLS[channel] ?? 'bg-gray-100 text-gray-600'}`}
    >
      {CHANNEL_LABEL[channel] ?? channel}
    </span>
  )
}

// ── Date helper ────────────────────────────────────────────────────────────────

function formatSchedule(c: Campaign): string {
  const isDone = c.status === 'complete' || c.status === 'sent'
  if (isDone) {
    if (!c.sent_at) return '—'
    return new Date(c.sent_at).toLocaleDateString()
  }
  if (!c.schedule_at) return '—'
  const diff = new Date(c.schedule_at).getTime() - Date.now()
  if (diff < 0) return new Date(c.schedule_at).toLocaleDateString()
  const hours = Math.round(diff / 3600000)
  if (hours < 24) return `in ${hours}h`
  const days = Math.round(diff / 86400000)
  return `in ${days}d`
}

// ── Skeleton row ───────────────────────────────────────────────────────────────

function SkeletonRow() {
  return (
    <tr className="border-b border-gray-50 animate-pulse last:border-0">
      <td className="px-6 py-4">
        <div className="h-3.5 bg-gray-200 rounded w-40" />
        <div className="h-3 bg-gray-100 rounded w-24 mt-1.5" />
      </td>
      <td className="px-4 py-4">
        <div className="h-5 bg-gray-100 rounded w-20" />
      </td>
      <td className="px-4 py-4">
        <div className="h-3.5 bg-gray-100 rounded w-28" />
      </td>
      <td className="px-4 py-4">
        <div className="h-5 bg-gray-100 rounded w-12" />
      </td>
      <td className="px-4 py-4">
        <div className="h-3.5 bg-gray-100 rounded w-8 ml-auto" />
      </td>
      <td className="px-6 py-4">
        <div className="h-3.5 bg-gray-100 rounded w-16" />
      </td>
    </tr>
  )
}

// ── Upgrade prompt ─────────────────────────────────────────────────────────────

function UpgradePrompt() {
  return (
    <div className="px-8 py-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-ink">Campaigns</h1>
          <p className="text-sm text-ink3 mt-0.5">AI-powered multi-channel campaigns</p>
        </div>
      </div>
      <div className="bg-white rounded-xl border border-border-brand px-8 py-20 text-center">
        <div className="text-5xl mb-4">📣</div>
        <h2 className="text-base font-semibold text-ink mb-2">Campaigns not enabled</h2>
        <p className="text-sm text-ink3 mb-6 max-w-sm mx-auto">
          AI-powered campaigns let you reach clients via SMS and email with AI-generated copy.
          Enable the module to get started.
        </p>
        <Link
          href="/settings/modules"
          className="px-4 py-2 bg-teal-600 text-white text-sm font-medium rounded-lg hover:bg-teal-700 transition-colors"
        >
          Enable Campaigns →
        </Link>
      </div>
    </div>
  )
}

// ── Filter options ─────────────────────────────────────────────────────────────

const STATUS_FILTERS = [
  { value: '', label: 'All' },
  { value: 'draft', label: 'Draft' },
  { value: 'scheduled', label: 'Scheduled' },
  { value: 'running', label: 'Running' },
  { value: 'complete', label: 'Complete' },
]

// ── Main component ─────────────────────────────────────────────────────────────

export default function CampaignsPage() {
  const router = useRouter()
  const [modules, setModules] = useState<Record<string, boolean> | null>(null)
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState('')

  // Load modules from session on mount
  useEffect(() => {
    fetch('/api/auth/session')
      .then((r) => r.json())
      .then((s: { user?: { modules?: Record<string, boolean> } }) => {
        setModules(s?.user?.modules ?? {})
      })
      .catch(() => setModules({}))
  }, [])

  const loadCampaigns = useCallback((status: string) => {
    setLoading(true)
    setError(null)
    const qs = status ? `?status=${encodeURIComponent(status)}` : ''
    fetch(`/api/campaigns${qs}`)
      .then((r) => {
        if (!r.ok) throw new Error('Failed')
        return r.json() as Promise<CampaignListResponse>
      })
      .then((d) => setCampaigns(d.data ?? []))
      .catch(() => setError('Unable to load campaigns. Please try again.'))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    if (modules === null) return
    if (modules['campaigns'] === false) return
    loadCampaigns(statusFilter)
  }, [modules, statusFilter, loadCampaigns])

  async function handleCancel(id: string) {
    if (!confirm('Cancel this scheduled campaign?')) return
    const res = await fetch(`/api/campaigns/${id}/cancel`, { method: 'POST' })
    if (!res.ok) {
      const d = await res.json().catch(() => ({}))
      alert((d as { error?: string }).error ?? 'Failed to cancel')
      return
    }
    setCampaigns((prev) => prev.map((c) => (c.id === id ? { ...c, status: 'cancelled' } : c)))
  }

  // ── Loading modules ────────────────────────────────────────────────────────
  if (modules === null) {
    return (
      <div className="px-8 py-8">
        <div className="flex items-center justify-between mb-6">
          <div className="animate-pulse">
            <div className="h-7 bg-gray-200 rounded w-32 mb-1.5" />
            <div className="h-4 bg-gray-100 rounded w-48" />
          </div>
          <div className="h-9 bg-gray-100 rounded w-36 animate-pulse" />
        </div>
        <div className="bg-white rounded-xl border border-border-brand overflow-hidden">
          <table className="w-full">
            <tbody>
              <SkeletonRow />
              <SkeletonRow />
              <SkeletonRow />
            </tbody>
          </table>
        </div>
      </div>
    )
  }

  // ── Module gate ───────────────────────────────────────────────────────────
  if (modules['campaigns'] === false) {
    return <UpgradePrompt />
  }

  return (
    <div className="px-8 py-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-ink">Campaigns</h1>
          <p className="text-sm text-ink3 mt-0.5">AI-powered multi-channel campaigns</p>
        </div>
        <button
          type="button"
          onClick={() => router.push('/campaigns/new')}
          className="flex items-center gap-2 px-4 py-2 bg-teal-600 text-white text-sm font-medium rounded-lg hover:bg-teal-700 transition-colors"
        >
          <span className="text-base leading-none">+</span>
          New Campaign
        </button>
      </div>

      {/* Filter bar */}
      <div className="flex items-center gap-1.5 mb-4">
        {STATUS_FILTERS.map((f) => (
          <button
            key={f.value}
            type="button"
            onClick={() => setStatusFilter(f.value)}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
              statusFilter === f.value
                ? 'bg-teal-600 text-white'
                : 'bg-white text-ink3 border border-border-brand hover:bg-bg'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Error */}
      {error && (
        <div className="mb-4 px-4 py-3 bg-red-50 text-red-600 text-sm rounded-lg border border-red-100">
          {error}
        </div>
      )}

      {/* Table card */}
      <div className="bg-white rounded-xl border border-border-brand overflow-hidden">
        {loading ? (
          <table className="w-full">
            <tbody>
              <SkeletonRow />
              <SkeletonRow />
              <SkeletonRow />
            </tbody>
          </table>
        ) : campaigns.length === 0 ? (
          /* Empty state */
          <div className="px-8 py-20 text-center">
            <div className="text-5xl mb-4">📣</div>
            <h2 className="text-base font-semibold text-ink mb-1">No campaigns yet</h2>
            <p className="text-sm text-ink3 mb-6">
              Create your first AI-powered campaign to re-engage clients.
            </p>
            <button
              type="button"
              onClick={() => router.push('/campaigns/new')}
              className="px-4 py-2 bg-teal-600 text-white text-sm font-medium rounded-lg hover:bg-teal-700 transition-colors"
            >
              New Campaign
            </button>
          </div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-border-brand">
                <th className="text-left px-6 py-3 text-xs font-semibold text-ink3 uppercase tracking-wide">
                  Name
                </th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-ink3 uppercase tracking-wide">
                  Status
                </th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-ink3 uppercase tracking-wide">
                  Objective
                </th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-ink3 uppercase tracking-wide">
                  Channels
                </th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-ink3 uppercase tracking-wide">
                  Contacts
                </th>
                <th className="text-left px-6 py-3 text-xs font-semibold text-ink3 uppercase tracking-wide">
                  Scheduled / Sent
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {campaigns.map((c) => (
                <tr key={c.id} className="hover:bg-gray-50/50 transition-colors">
                  {/* Name */}
                  <td className="px-6 py-3.5">
                    <Link
                      href={`/campaigns/${c.id}`}
                      className="text-sm font-medium text-ink hover:text-teal-700 transition-colors"
                    >
                      {c.name}
                    </Link>
                    {c.segment_name && <p className="text-xs text-ink3 mt-0.5">{c.segment_name}</p>}
                  </td>

                  {/* Status */}
                  <td className="px-4 py-3.5">
                    <StatusBadge status={c.status} />
                  </td>

                  {/* Objective */}
                  <td className="px-4 py-3.5 text-sm text-ink2">
                    {c.objective ? (OBJECTIVE_LABEL[c.objective] ?? c.objective) : '—'}
                  </td>

                  {/* Channels */}
                  <td className="px-4 py-3.5">
                    <div className="flex flex-wrap gap-1">
                      {(c.channels ?? []).map((ch) => (
                        <ChannelChip key={ch} channel={ch} />
                      ))}
                      {(!c.channels || c.channels.length === 0) && (
                        <span className="text-sm text-ink3">—</span>
                      )}
                    </div>
                  </td>

                  {/* Contacts */}
                  <td className="px-4 py-3.5 text-right text-sm text-ink2">
                    {c.contact_count ?? '—'}
                  </td>

                  {/* Scheduled / Sent */}
                  <td className="px-6 py-3.5">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-sm text-ink2">{formatSchedule(c)}</span>
                      {c.status === 'scheduled' && (
                        <button
                          type="button"
                          onClick={() => handleCancel(c.id)}
                          className="shrink-0 text-xs text-red-500 hover:text-red-600 font-medium transition-colors"
                        >
                          Cancel
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
