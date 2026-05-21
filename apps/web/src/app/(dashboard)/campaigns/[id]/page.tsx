'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'

// ── Types ──────────────────────────────────────────────────────────────────────

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

interface CampaignStats {
  recipient_count: number
  sent_count: number
  delivered: number
  opened: number
  clicked: number
  bounced: number
  failed: number
  open_rate: number
  click_rate: number
  bounce_rate: number
  status_breakdown: Record<string, number>
}

interface CampaignRecipient {
  id: string
  contact_id: string
  email: string
  status: string
  sent_at: string | null
  opened_at: string | null
  clicked_at: string | null
  contacts?: { full_name: string | null } | null
}

interface RecipientsResponse {
  recipients: CampaignRecipient[]
  total: number
  page: number
  limit: number
}

// ── Status badge (campaign) ────────────────────────────────────────────────────

function CampaignStatusBadge({ status }: { status: string }) {
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

// ── Status badge (recipient) ───────────────────────────────────────────────────

function RecipientStatusBadge({ status }: { status: string }) {
  const cls: Record<string, string> = {
    pending: 'bg-gray-100 text-gray-600',
    sent: 'bg-blue-50 text-blue-700',
    delivered: 'bg-teal-50 text-teal-700',
    opened: 'bg-green-50 text-green-700',
    clicked: 'bg-green-100 text-green-800',
    bounced: 'bg-red-50 text-red-600',
    failed: 'bg-red-100 text-red-800',
    suppressed: 'bg-gray-100 text-gray-500',
  }
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${cls[status] ?? 'bg-gray-100 text-gray-600'}`}
    >
      {status}
    </span>
  )
}

// ── Skeleton cards ─────────────────────────────────────────────────────────────

function SkeletonCard() {
  return (
    <div className="bg-white border border-border-brand rounded-xl p-5 animate-pulse">
      <div className="h-7 bg-gray-200 rounded w-16 mb-2" />
      <div className="h-3.5 bg-gray-100 rounded w-20" />
    </div>
  )
}

// ── Stat card ──────────────────────────────────────────────────────────────────

function StatCard({ label, value, rate }: { label: string; value: number; rate?: number }) {
  return (
    <div className="bg-white border border-border-brand rounded-xl p-5">
      <p className="text-2xl font-bold text-ink">{value.toLocaleString()}</p>
      <p className="text-xs text-ink3 mt-1">{label}</p>
      {rate !== undefined && <p className="text-xs text-ink3 mt-0.5">{rate.toFixed(1)}%</p>}
    </div>
  )
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function fmtDate(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString()
}

// ── Main component ─────────────────────────────────────────────────────────────

const STATUS_OPTIONS = [
  '',
  'pending',
  'sent',
  'delivered',
  'opened',
  'clicked',
  'bounced',
  'failed',
]
const PAGE_LIMIT = 50

export default function CampaignStatsPage() {
  const params = useParams()
  const id = params?.id as string

  const [campaign, setCampaign] = useState<Campaign | null>(null)
  const [stats, setStats] = useState<CampaignStats | null>(null)
  const [recipients, setRecipients] = useState<CampaignRecipient[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [statusFilter, setStatusFilter] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [recipientsLoading, setRecipientsLoading] = useState(false)

  // Initial load: campaign + stats + recipients
  useEffect(() => {
    if (!id) return
    setLoading(true)
    setError(null)

    Promise.all([
      fetch(`/api/campaigns/${id}`).then((r) => {
        if (!r.ok) throw new Error('Failed to load campaign')
        return r.json() as Promise<Campaign>
      }),
      fetch(`/api/campaigns/${id}/stats`).then((r) => {
        if (!r.ok) throw new Error('Failed to load stats')
        return r.json() as Promise<CampaignStats>
      }),
      fetch(`/api/campaigns/${id}/recipients?page=1&limit=${PAGE_LIMIT}`).then((r) => {
        if (!r.ok) throw new Error('Failed to load recipients')
        return r.json() as Promise<RecipientsResponse>
      }),
    ])
      .then(([campaignData, statsData, recipientsData]) => {
        setCampaign(campaignData)
        setStats(statsData)
        setRecipients(recipientsData.recipients)
        setTotal(recipientsData.total)
      })
      .catch(() => setError('Failed to load campaign stats.'))
      .finally(() => setLoading(false))
  }, [id])

  // Re-fetch recipients when filter or page changes (but not on first mount)
  const fetchRecipients = useCallback(
    (newPage: number, newStatus: string) => {
      if (!id) return
      setRecipientsLoading(true)
      const qs = new URLSearchParams({ page: String(newPage), limit: String(PAGE_LIMIT) })
      if (newStatus) qs.set('status', newStatus)
      fetch(`/api/campaigns/${id}/recipients?${qs}`)
        .then((r) => {
          if (!r.ok) throw new Error('Failed to load recipients')
          return r.json() as Promise<RecipientsResponse>
        })
        .then((data) => {
          setRecipients(data.recipients)
          setTotal(data.total)
        })
        .catch(() => {
          /* silently ignore recipient re-fetch errors */
        })
        .finally(() => setRecipientsLoading(false))
    },
    [id]
  )

  function handleStatusChange(newStatus: string) {
    setStatusFilter(newStatus)
    setPage(1)
    fetchRecipients(1, newStatus)
  }

  function handlePrev() {
    if (page <= 1) return
    const newPage = page - 1
    setPage(newPage)
    fetchRecipients(newPage, statusFilter)
  }

  function handleNext() {
    if (page >= totalPages) return
    const newPage = page + 1
    setPage(newPage)
    fetchRecipients(newPage, statusFilter)
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_LIMIT))

  // ── Loading ────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="px-8 py-8 space-y-6">
        {/* Header skeleton */}
        <div className="animate-pulse space-y-2">
          <div className="h-7 bg-gray-200 rounded w-48" />
          <div className="h-4 bg-gray-100 rounded w-32" />
        </div>
        {/* Stat cards skeleton */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </div>
        {/* Chart skeleton */}
        <div className="bg-white border border-border-brand rounded-xl p-6 animate-pulse">
          <div className="h-5 bg-gray-200 rounded w-40 mb-4" />
          <div className="h-48 bg-gray-100 rounded" />
        </div>
      </div>
    )
  }

  // ── Error ─────────────────────────────────────────────────────────────────
  if (error || !campaign || !stats) {
    return (
      <div className="px-8 py-8">
        <Link href="/campaigns" className="text-sm text-teal-700 hover:text-teal-800 font-medium">
          ← All Campaigns
        </Link>
        <div className="mt-6 bg-white border border-border-brand rounded-xl px-6 py-12 text-center">
          <p className="text-sm text-red-600">{error ?? 'Failed to load campaign stats.'}</p>
        </div>
      </div>
    )
  }

  // ── Chart data ─────────────────────────────────────────────────────────────
  const chartData = [
    { name: 'Delivered', count: stats.delivered },
    { name: 'Opened', count: stats.opened },
    { name: 'Clicked', count: stats.clicked },
    { name: 'Bounced', count: stats.bounced },
    { name: 'Failed', count: stats.failed },
  ]

  // ── Date label ─────────────────────────────────────────────────────────────
  const dateLabel = campaign.sent_at
    ? `Sent ${new Date(campaign.sent_at).toLocaleDateString()}`
    : campaign.scheduled_at
      ? `Scheduled for ${new Date(campaign.scheduled_at).toLocaleDateString()}`
      : null

  return (
    <div className="px-8 py-8 space-y-6">
      {/* Back link */}
      <Link href="/campaigns" className="text-sm text-teal-700 hover:text-teal-800 font-medium">
        ← All Campaigns
      </Link>

      {/* Header */}
      <div className="flex items-start gap-3 flex-wrap">
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-bold text-ink truncate">{campaign.name}</h1>
          {dateLabel && <p className="text-sm text-ink3 mt-0.5">{dateLabel}</p>}
        </div>
        <CampaignStatusBadge status={campaign.status} />
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <StatCard label="Delivered" value={stats.delivered} />
        <StatCard label="Opened" value={stats.opened} rate={stats.open_rate} />
        <StatCard label="Clicked" value={stats.clicked} rate={stats.click_rate} />
        <StatCard label="Bounced" value={stats.bounced} rate={stats.bounce_rate} />
      </div>

      {/* Bar chart */}
      <div className="bg-white border border-border-brand rounded-xl p-6">
        <h2 className="text-sm font-semibold text-ink mb-4">Delivery Breakdown</h2>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={chartData}>
            <XAxis dataKey="name" tick={{ fontSize: 12 }} />
            <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
            <Tooltip />
            <Bar dataKey="count" fill="#0d9488" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Recipients table */}
      <div className="bg-white border border-border-brand rounded-xl overflow-hidden">
        {/* Table header */}
        <div className="px-6 py-4 border-b border-border-brand flex items-center justify-between gap-4 flex-wrap">
          <h2 className="text-sm font-semibold text-ink">
            Recipients <span className="text-ink3 font-normal">({total.toLocaleString()})</span>
          </h2>
          <select
            value={statusFilter}
            onChange={(e) => handleStatusChange(e.target.value)}
            className="text-sm border border-border-brand rounded-lg px-3 py-1.5 text-ink bg-bg focus:outline-none focus:ring-2 focus:ring-teal-500"
          >
            <option value="">All statuses</option>
            {STATUS_OPTIONS.filter(Boolean).map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border-brand">
                <th className="text-left px-6 py-3 text-xs font-semibold text-ink3 uppercase tracking-wide">
                  Contact Name
                </th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-ink3 uppercase tracking-wide">
                  Email
                </th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-ink3 uppercase tracking-wide">
                  Status
                </th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-ink3 uppercase tracking-wide">
                  Sent At
                </th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-ink3 uppercase tracking-wide">
                  Opened At
                </th>
                <th className="text-left px-6 py-3 text-xs font-semibold text-ink3 uppercase tracking-wide">
                  Clicked At
                </th>
              </tr>
            </thead>
            <tbody className={`divide-y divide-gray-50 ${recipientsLoading ? 'opacity-50' : ''}`}>
              {recipients.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-10 text-center text-sm text-ink3">
                    No recipients found.
                  </td>
                </tr>
              ) : (
                recipients.map((r) => (
                  <tr key={r.id} className="hover:bg-gray-50/50 transition-colors">
                    <td className="px-6 py-3.5 text-sm text-ink font-medium">
                      {r.contacts?.full_name ?? '—'}
                    </td>
                    <td className="px-4 py-3.5 text-sm text-ink2">{r.email}</td>
                    <td className="px-4 py-3.5">
                      <RecipientStatusBadge status={r.status} />
                    </td>
                    <td className="px-4 py-3.5 text-sm text-ink2">{fmtDate(r.sent_at)}</td>
                    <td className="px-4 py-3.5 text-sm text-ink2">{fmtDate(r.opened_at)}</td>
                    <td className="px-6 py-3.5 text-sm text-ink2">{fmtDate(r.clicked_at)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="px-6 py-3.5 border-t border-border-brand flex items-center justify-between">
            <button
              type="button"
              onClick={handlePrev}
              disabled={page <= 1}
              className="text-sm font-medium text-teal-700 hover:text-teal-800 disabled:text-gray-300 disabled:cursor-not-allowed transition-colors"
            >
              ← Prev
            </button>
            <span className="text-xs text-ink3">
              Page {page} of {totalPages}
            </span>
            <button
              type="button"
              onClick={handleNext}
              disabled={page >= totalPages}
              className="text-sm font-medium text-teal-700 hover:text-teal-800 disabled:text-gray-300 disabled:cursor-not-allowed transition-colors"
            >
              Next →
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
