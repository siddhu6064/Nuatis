'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

// ── Types ──────────────────────────────────────────────────────────────────────

interface PrereqCheck {
  key: string
  label: string
  status: 'pass' | 'fail' | 'warning'
  detail: string
  action_url: string | null
}

interface PrereqResult {
  ready: boolean
  checks: PrereqCheck[]
}

interface Campaign {
  id: string
  name: string
  type: string
  status: string
  subject: string | null
  body_html: string | null
  body_text: string | null
  smart_list_id: string | null
  scheduled_at: string | null
  sent_at: string | null
  recipient_count: number
  sent_count: number
}

// ── Prereq check sub-components ────────────────────────────────────────────────

function StatusIcon({ status }: { status: 'pass' | 'fail' | 'warning' }) {
  if (status === 'pass') {
    return (
      <svg
        className="w-5 h-5 shrink-0 text-green-600"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={2.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-label="Pass"
      >
        <path d="M5 13l4 4L19 7" />
      </svg>
    )
  }
  if (status === 'warning') {
    return (
      <svg
        className="w-5 h-5 shrink-0 text-yellow-600"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={2.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-label="Warning"
      >
        <path d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
      </svg>
    )
  }
  return (
    <svg
      className="w-5 h-5 shrink-0 text-red-600"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-label="Fail"
    >
      <path d="M6 18L18 6M6 6l12 12" />
    </svg>
  )
}

function SkeletonRow() {
  return (
    <div className="flex items-center gap-4 px-6 py-4 border-b border-gray-50 last:border-0 animate-pulse">
      <div className="w-5 h-5 rounded-full bg-gray-200 shrink-0" />
      <div className="flex-1 space-y-1.5">
        <div className="h-3.5 bg-gray-200 rounded w-1/4" />
        <div className="h-3 bg-gray-100 rounded w-1/2" />
      </div>
      <div className="w-16 h-6 bg-gray-100 rounded" />
    </div>
  )
}

function CheckRow({ check }: { check: PrereqCheck }) {
  return (
    <div className="flex items-center gap-4 px-6 py-4 border-b border-gray-50 last:border-0">
      <StatusIcon status={check.status} />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-ink">{check.label}</p>
        <p className="text-xs text-ink4 mt-0.5">{check.detail}</p>
      </div>
      {check.action_url && (
        <Link
          href={check.action_url}
          className="shrink-0 px-3 py-1.5 text-xs font-medium text-teal-700 bg-teal-50 hover:bg-teal-100 rounded-lg transition-colors"
        >
          Fix →
        </Link>
      )}
    </div>
  )
}

// ── Status badge ───────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const cls: Record<string, string> = {
    draft: 'bg-gray-100 text-gray-600',
    scheduled: 'bg-blue-50 text-blue-700',
    sending: 'bg-amber-50 text-amber-700',
    sent: 'bg-green-50 text-green-700',
    cancelled: 'bg-gray-100 text-gray-500',
    paused: 'bg-amber-50 text-amber-700',
  }
  const label: Record<string, string> = {
    draft: 'Draft',
    scheduled: 'Scheduled',
    sending: 'Sending',
    sent: 'Sent',
    cancelled: 'Cancelled',
    paused: 'Paused',
  }
  return (
    <span
      className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold ${cls[status] ?? 'bg-gray-100 text-gray-600'}`}
    >
      {label[status] ?? status}
    </span>
  )
}

// ── Campaign table ─────────────────────────────────────────────────────────────

function CampaignTable({
  campaigns,
  onCancel,
}: {
  campaigns: Campaign[]
  onCancel: (id: string) => void
}) {
  return (
    <div className="bg-white rounded-xl border border-border-brand overflow-hidden">
      <table className="w-full">
        <thead>
          <tr className="border-b border-border-brand">
            <th className="text-left px-6 py-3 text-xs font-semibold text-ink3 uppercase tracking-wide">
              Name
            </th>
            <th className="text-left px-4 py-3 text-xs font-semibold text-ink3 uppercase tracking-wide">
              Status
            </th>
            <th className="text-right px-4 py-3 text-xs font-semibold text-ink3 uppercase tracking-wide">
              Recipients
            </th>
            <th className="text-right px-4 py-3 text-xs font-semibold text-ink3 uppercase tracking-wide">
              Open Rate
            </th>
            <th className="text-left px-4 py-3 text-xs font-semibold text-ink3 uppercase tracking-wide">
              Sent At
            </th>
            <th className="text-right px-6 py-3 text-xs font-semibold text-ink3 uppercase tracking-wide">
              Actions
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-50">
          {campaigns.map((c) => {
            const openRate =
              c.status === 'sent' && c.sent_count > 0
                ? Math.round((c.recipient_count > 0 ? c.sent_count / c.recipient_count : 0) * 100)
                : null
            const sentAt = c.sent_at ? new Date(c.sent_at).toLocaleDateString() : '—'
            return (
              <tr key={c.id} className="hover:bg-gray-50/50 transition-colors">
                <td className="px-6 py-3.5">
                  <p className="text-sm font-medium text-ink">{c.name}</p>
                  {c.subject && (
                    <p className="text-xs text-ink3 mt-0.5 truncate max-w-xs">{c.subject}</p>
                  )}
                </td>
                <td className="px-4 py-3.5">
                  <StatusBadge status={c.status} />
                </td>
                <td className="px-4 py-3.5 text-right text-sm text-ink2">
                  {c.recipient_count ?? 0}
                </td>
                <td className="px-4 py-3.5 text-right text-sm text-ink2">
                  {openRate !== null ? `${openRate}%` : '—'}
                </td>
                <td className="px-4 py-3.5 text-sm text-ink2">{sentAt}</td>
                <td className="px-6 py-3.5 text-right">
                  <div className="flex items-center justify-end gap-2">
                    {c.status === 'draft' && (
                      <Link
                        href={`/campaigns/new?id=${c.id}`}
                        className="text-xs text-teal-700 hover:text-teal-800 font-medium"
                      >
                        Edit
                      </Link>
                    )}
                    {c.status === 'sent' && (
                      <Link
                        href={`/campaigns/${c.id}`}
                        className="text-xs text-teal-700 hover:text-teal-800 font-medium"
                      >
                        Stats →
                      </Link>
                    )}
                    {c.status === 'scheduled' && (
                      <button
                        type="button"
                        onClick={() => onCancel(c.id)}
                        className="text-xs text-red-600 hover:text-red-700 font-medium"
                      >
                        Cancel
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
  )
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function CampaignsPage() {
  const router = useRouter()

  // Prereq state
  const [prereq, setPrereq] = useState<PrereqResult | null>(null)
  const [prereqLoading, setPrereqLoading] = useState(true)
  const [prereqError, setPrereqError] = useState<string | null>(null)

  // Campaign list state
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [campaignsLoading, setCampaignsLoading] = useState(false)
  const [campaignsError, setCampaignsError] = useState<string | null>(null)

  // Load prereq on mount
  useEffect(() => {
    setPrereqLoading(true)
    setPrereqError(null)
    fetch('/api/campaigns/prereq')
      .then(async (res) => {
        if (!res.ok) throw new Error('Failed to load readiness data')
        return res.json() as Promise<PrereqResult>
      })
      .then((data) => {
        setPrereq(data)
      })
      .catch(() => {
        setPrereqError('Unable to load campaign readiness. Please try again.')
      })
      .finally(() => setPrereqLoading(false))
  }, [])

  // Load campaigns once prereq is ready
  useEffect(() => {
    if (!prereq?.ready) return
    setCampaignsLoading(true)
    setCampaignsError(null)
    fetch('/api/campaigns')
      .then(async (res) => {
        if (!res.ok) throw new Error('Failed to load campaigns')
        return res.json() as Promise<{ campaigns: Campaign[] }>
      })
      .then((data) => setCampaigns(data.campaigns))
      .catch(() => setCampaignsError('Unable to load campaigns. Please try again.'))
      .finally(() => setCampaignsLoading(false))
  }, [prereq?.ready])

  async function handleCancel(id: string) {
    if (!confirm('Cancel this campaign?')) return
    try {
      const res = await fetch(`/api/campaigns/${id}/cancel`, { method: 'POST' })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        alert((d as { error?: string }).error ?? 'Failed to cancel')
        return
      }
      setCampaigns((prev) => prev.map((c) => (c.id === id ? { ...c, status: 'cancelled' } : c)))
    } catch {
      alert('Failed to cancel campaign')
    }
  }

  // ── Prereq not yet loaded ──────────────────────────────────────────────────
  if (prereqLoading || (!prereq && !prereqError)) {
    return (
      <div className="px-8 py-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl font-bold text-ink">Campaigns</h1>
            <p className="text-sm text-ink3 mt-0.5">AI-powered outreach campaigns</p>
          </div>
        </div>
        <div className="bg-white rounded-xl border border-border-brand">
          <div className="px-6 py-4 border-b border-border-brand">
            <h2 className="text-sm font-semibold text-ink">Campaign Readiness</h2>
            <p className="text-xs text-ink4 mt-0.5">
              Complete the checks below before launching a campaign
            </p>
          </div>
          <div>
            <SkeletonRow />
            <SkeletonRow />
            <SkeletonRow />
            <SkeletonRow />
            <SkeletonRow />
          </div>
        </div>
      </div>
    )
  }

  // ── Prereq error ──────────────────────────────────────────────────────────
  if (prereqError) {
    return (
      <div className="px-8 py-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl font-bold text-ink">Campaigns</h1>
            <p className="text-sm text-ink3 mt-0.5">AI-powered outreach campaigns</p>
          </div>
        </div>
        <div className="bg-white rounded-xl border border-border-brand px-6 py-10 text-center">
          <p className="text-sm text-red-600">{prereqError}</p>
        </div>
      </div>
    )
  }

  // ── Prereq not ready: show prereq check card ──────────────────────────────
  if (!prereq?.ready) {
    return (
      <div className="px-8 py-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl font-bold text-ink">Campaigns</h1>
            <p className="text-sm text-ink3 mt-0.5">AI-powered outreach campaigns</p>
          </div>
          <button
            type="button"
            disabled
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg bg-gray-100 text-gray-400 cursor-not-allowed"
            aria-disabled="true"
          >
            <span className="text-base leading-none">◎</span>
            New Campaign
          </button>
        </div>

        <div className="bg-white rounded-xl border border-border-brand">
          <div className="px-6 py-4 border-b border-border-brand flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-ink">Campaign Readiness</h2>
              <p className="text-xs text-ink4 mt-0.5">
                Complete the checks below before launching a campaign
              </p>
            </div>
            <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-50 text-amber-700">
              Not Ready
            </span>
          </div>
          <div>
            {prereq?.checks.map((check) => (
              <CheckRow key={check.key} check={check} />
            ))}
          </div>
        </div>
      </div>
    )
  }

  // ── Prereq ready: show campaign list ─────────────────────────────────────
  return (
    <div className="px-8 py-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-ink">Campaigns</h1>
          <p className="text-sm text-ink3 mt-0.5">AI-powered outreach campaigns</p>
        </div>
        <button
          type="button"
          onClick={() => router.push('/campaigns/new')}
          className="flex items-center gap-2 px-4 py-2 bg-teal-600 text-white text-sm font-medium rounded-lg hover:bg-teal-700 transition-colors"
        >
          <span className="text-base leading-none">◎</span>
          New Campaign
        </button>
      </div>

      {/* Error */}
      {campaignsError && (
        <div className="mb-4 px-4 py-3 bg-red-50 text-red-600 text-sm rounded-lg">
          {campaignsError}
        </div>
      )}

      {/* Loading */}
      {campaignsLoading && (
        <div className="bg-white rounded-xl border border-border-brand">
          <SkeletonRow />
          <SkeletonRow />
          <SkeletonRow />
        </div>
      )}

      {/* Empty state */}
      {!campaignsLoading && !campaignsError && campaigns.length === 0 && (
        <div className="bg-white rounded-xl border border-border-brand px-8 py-16 text-center">
          <p className="text-sm text-ink3 mb-4">No campaigns yet. Launch your first campaign.</p>
          <button
            type="button"
            onClick={() => router.push('/campaigns/new')}
            className="px-4 py-2 bg-teal-600 text-white text-sm font-medium rounded-lg hover:bg-teal-700 transition-colors"
          >
            Launch your first campaign →
          </button>
        </div>
      )}

      {/* Campaign table */}
      {!campaignsLoading && !campaignsError && campaigns.length > 0 && (
        <CampaignTable campaigns={campaigns} onCancel={handleCancel} />
      )}
    </div>
  )
}
