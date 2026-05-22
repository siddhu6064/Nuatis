'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts'

// ── Types ──────────────────────────────────────────────────────────────────────

interface Campaign {
  id: string
  name: string
  status: string
  channels: string[] | null
  contact_count: number | null
  sent_at: string | null
  schedule_at: string | null
}

interface ByChannel {
  channel: string
  total_sent: number
  delivered: number
  opened: number
  clicked: number
  opted_out: number
  failed: number
}

interface PerfSummary {
  total_sent: number
  delivered: number
  opened: number
  clicked: number
  opted_out: number
  failed: number
  delivery_rate: number
  open_rate: number
  click_rate: number
  opt_out_rate: number
  by_channel: ByChannel[]
}

interface SendRow {
  id: string
  contact_name: string | null
  phone_masked: string | null
  channel: string
  status: string
  sent_at: string | null
  delivered_at: string | null
  opened_at: string | null
  clicked_at: string | null
  error_msg: string | null
}

interface SendsResponse {
  data: SendRow[]
  total: number
  page: number
}

// ── Helpers ────────────────────────────────────────────────────────────────────

const CHANNEL_COLORS: Record<string, string> = {
  sms: '#007A6E',
  email: '#0047FF',
  social: '#7C3AED',
}
const CHANNEL_LABEL: Record<string, string> = { sms: 'SMS', email: 'Email', social: 'Social' }

const STATUS_ORDER: Record<string, number> = {
  failed: 0,
  sent: 1,
  delivered: 2,
  opened: 3,
  clicked: 4,
  opted_out: 5,
}

const STATUS_CLS: Record<string, string> = {
  delivered: 'bg-green-50 text-green-700',
  opened: 'bg-blue-50 text-blue-700',
  clicked: 'bg-teal-50 text-teal-700',
  failed: 'bg-red-50 text-red-600',
  opted_out: 'bg-gray-100 text-gray-500',
  sent: 'bg-gray-100 text-gray-600',
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString(undefined, { dateStyle: 'medium' })
}

function fmtTime(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleTimeString(undefined, { timeStyle: 'short' })
}

// ── Skeleton ───────────────────────────────────────────────────────────────────

function SkeletonCard() {
  return (
    <div className="bg-white border border-border-brand rounded-xl p-5 animate-pulse">
      <div className="h-8 bg-gray-200 rounded w-20 mb-2" />
      <div className="h-3.5 bg-gray-100 rounded w-16" />
    </div>
  )
}

// ── Stat card ──────────────────────────────────────────────────────────────────

function StatCard({
  value,
  label,
  accent,
}: {
  value: string
  label: string
  accent?: 'amber' | 'red'
}) {
  const numCls =
    accent === 'red' ? 'text-red-600' : accent === 'amber' ? 'text-amber-600' : 'text-ink'
  return (
    <div className="bg-white border border-border-brand rounded-xl p-5">
      <p className={`text-2xl font-bold ${numCls}`}>{value}</p>
      <p className="text-xs text-ink3 mt-1">{label}</p>
    </div>
  )
}

// ── Custom tooltip ─────────────────────────────────────────────────────────────

interface ChartPayloadItem {
  name: string
  value: number
  fill: string
}

function FunnelTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean
  payload?: ChartPayloadItem[]
  label?: string
}) {
  if (!active || !payload || payload.length === 0) return null
  return (
    <div className="bg-white border border-border-brand rounded-lg shadow-lg px-4 py-3 text-xs space-y-1.5">
      <p className="font-semibold text-ink mb-1">{label}</p>
      {payload.map((entry) => (
        <div key={entry.name} className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: entry.fill }} />
          <span className="text-ink2 min-w-[40px]">{entry.name}:</span>
          <span className="font-semibold text-ink">{entry.value.toLocaleString()}</span>
        </div>
      ))}
    </div>
  )
}

// ── Channel chip ───────────────────────────────────────────────────────────────

function ChannelChip({ channel }: { channel: string }) {
  const cls =
    channel === 'sms'
      ? 'bg-teal-50 text-teal-700'
      : channel === 'email'
        ? 'bg-blue-50 text-blue-700'
        : 'bg-purple-50 text-purple-700'
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${cls}`}>
      {CHANNEL_LABEL[channel] ?? channel}
    </span>
  )
}

// ── Status badge ───────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_CLS[status] ?? 'bg-gray-100 text-gray-600'}`}
    >
      {status.replace('_', ' ')}
    </span>
  )
}

// ── Campaign status badge (header) ─────────────────────────────────────────────

const CAMP_STATUS_CLS: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-600',
  scheduled: 'bg-amber-50 text-amber-700',
  running: 'bg-blue-50 text-blue-700',
  complete: 'bg-green-50 text-green-700',
  paused: 'bg-orange-50 text-orange-700',
  cancelled: 'bg-gray-100 text-gray-400',
}

// ── Main page ──────────────────────────────────────────────────────────────────

const PAGE_LIMIT = 50

export default function CampaignPerformancePage() {
  const params = useParams()
  const id = params?.id as string

  const [campaign, setCampaign] = useState<Campaign | null>(null)
  const [summary, setSummary] = useState<PerfSummary | null>(null)
  const [sends, setSends] = useState<SendRow[]>([])
  const [sendsTotal, setSendsTotal] = useState(0)
  const [sendsPage, setSendsPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [sendsLoading, setSendsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!id) return
    setLoading(true)
    Promise.all([
      fetch(`/api/campaigns/${id}`).then((r) => {
        if (!r.ok) throw new Error('Campaign not found')
        return r.json() as Promise<{ campaign: Campaign }>
      }),
      fetch(`/api/campaigns/${id}/performance/summary`).then((r) => {
        if (!r.ok) throw new Error('Failed to load performance')
        return r.json() as Promise<PerfSummary>
      }),
      fetch(`/api/campaigns/${id}/sends?limit=${PAGE_LIMIT}&page=1`).then((r) => {
        if (!r.ok) throw new Error('Failed to load sends')
        return r.json() as Promise<SendsResponse>
      }),
    ])
      .then(([campaignRes, summaryRes, sendsRes]) => {
        setCampaign(campaignRes.campaign)
        setSummary(summaryRes)
        setSends(sendsRes.data ?? [])
        setSendsTotal(sendsRes.total ?? 0)
      })
      .catch(() => setError('Failed to load campaign performance.'))
      .finally(() => setLoading(false))
  }, [id])

  const loadSendsPage = useCallback(
    async (page: number) => {
      setSendsLoading(true)
      const res = await fetch(`/api/campaigns/${id}/sends?limit=${PAGE_LIMIT}&page=${page}`)
      if (res.ok) {
        const d = (await res.json()) as SendsResponse
        setSends(d.data ?? [])
        setSendsTotal(d.total ?? 0)
        setSendsPage(page)
      }
      setSendsLoading(false)
    },
    [id]
  )

  // ── Loading ─────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="px-8 py-8 space-y-6">
        <div className="animate-pulse space-y-1.5">
          <div className="h-4 bg-gray-100 rounded w-28" />
          <div className="h-7 bg-gray-200 rounded w-56" />
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </div>
        <div className="bg-white border border-border-brand rounded-xl h-64 animate-pulse" />
      </div>
    )
  }

  // ── Error ───────────────────────────────────────────────────────────────────
  if (error || !campaign || !summary) {
    return (
      <div className="px-8 py-8">
        <Link
          href={`/campaigns/${id}`}
          className="text-sm text-teal-700 hover:text-teal-800 font-medium"
        >
          ← Back to campaign
        </Link>
        <div className="mt-6 bg-white border border-border-brand rounded-xl px-6 py-12 text-center">
          <p className="text-sm text-red-600">{error ?? 'Failed to load performance.'}</p>
        </div>
      </div>
    )
  }

  // ── Build funnel chart data ─────────────────────────────────────────────────
  const activeChannels = summary.by_channel.filter((ch) => ch.total_sent > 0)

  type ChartEntry = { stage: string } & { [ch: string]: string | number }
  const chartData: ChartEntry[] = (['Sent', 'Delivered', 'Opened', 'Clicked'] as const).map(
    (stage) => {
      const entry: ChartEntry = { stage }
      for (const ch of activeChannels) {
        if (stage === 'Sent') entry[ch.channel] = ch.total_sent
        else if (stage === 'Delivered') entry[ch.channel] = ch.delivered + ch.opened + ch.clicked
        else if (stage === 'Opened') entry[ch.channel] = ch.opened + ch.clicked
        else if (stage === 'Clicked') entry[ch.channel] = ch.clicked
      }
      return entry
    }
  )

  // ── Sort sends ──────────────────────────────────────────────────────────────
  const sortedSends = [...sends].sort((a, b) => {
    const ao = STATUS_ORDER[a.status] ?? 99
    const bo = STATUS_ORDER[b.status] ?? 99
    return ao - bo
  })

  const totalPages = Math.max(1, Math.ceil(sendsTotal / PAGE_LIMIT))
  const optOutAccent =
    summary.opt_out_rate > 3 ? 'red' : summary.opt_out_rate > 1 ? 'amber' : undefined

  return (
    <div className="px-8 py-8 space-y-6">
      {/* ── Header ───────────────────────────────────────────────────────────── */}
      <div>
        <Link
          href={`/campaigns/${id}`}
          className="text-sm text-teal-700 hover:text-teal-800 font-medium"
        >
          ← Back to campaign
        </Link>
        <div className="mt-3 flex items-start gap-3 flex-wrap">
          <div className="flex-1 min-w-0">
            <h1 className="text-xl font-bold text-ink truncate">{campaign.name}</h1>
            <p className="text-sm text-ink3 mt-0.5">
              {campaign.sent_at
                ? `Sent ${fmtDate(campaign.sent_at)}`
                : campaign.schedule_at
                  ? `Scheduled for ${fmtDate(campaign.schedule_at)}`
                  : 'Campaign performance'}
            </p>
          </div>
          <span
            className={`px-2.5 py-1 rounded-full text-xs font-semibold ${CAMP_STATUS_CLS[campaign.status] ?? 'bg-gray-100 text-gray-600'}`}
          >
            {campaign.status}
          </span>
        </div>
      </div>

      {/* ── Section 1: Stat cards ─────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <StatCard value={`${summary.delivery_rate}%`} label="Delivered" />
        <StatCard
          value={`${summary.open_rate}%`}
          label={activeChannels.some((c) => c.channel === 'email') ? 'Opened (email)' : 'Opened'}
        />
        <StatCard value={`${summary.click_rate}%`} label="Clicked" />
        <StatCard value={`${summary.opt_out_rate}%`} label="Opted out" accent={optOutAccent} />
      </div>

      {/* ── Section 3: Opt-out alert ──────────────────────────────────────────── */}
      {summary.opt_out_rate > 1 && (
        <div
          className={`flex items-start gap-3 px-5 py-4 rounded-xl border ${
            summary.opt_out_rate > 3
              ? 'bg-red-50 border-red-200 text-red-800'
              : 'bg-amber-50 border-amber-200 text-amber-800'
          }`}
        >
          <span className="text-xl shrink-0">⚠</span>
          <p className="text-sm">
            <span className="font-semibold">High opt-out rate ({summary.opt_out_rate}%)</span>
            {' — '}
            review your targeting and send frequency. 10DLC guidelines recommend keeping opt-out
            rates below 1%.
          </p>
        </div>
      )}

      {/* ── Section 2: Funnel chart ───────────────────────────────────────────── */}
      <div className="bg-white border border-border-brand rounded-xl p-6">
        <h2 className="text-sm font-semibold text-ink mb-1">Delivery funnel</h2>
        <p className="text-xs text-ink3 mb-5">
          {activeChannels.map((c) => CHANNEL_LABEL[c.channel] ?? c.channel).join(' + ')} ·{' '}
          {summary.total_sent.toLocaleString()} total sends
        </p>

        {summary.total_sent === 0 ? (
          <div className="h-48 flex items-center justify-center text-sm text-ink3">
            No sends recorded yet.
          </div>
        ) : (
          <div style={{ width: '100%', overflowX: 'auto' }}>
            <div style={{ minWidth: 320 }}>
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={chartData} barCategoryGap="30%">
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
                  <XAxis dataKey="stage" tick={{ fontSize: 12 }} stroke="#9ca3af" />
                  <YAxis
                    tick={{ fontSize: 11 }}
                    stroke="#9ca3af"
                    allowDecimals={false}
                    width={40}
                  />
                  <Tooltip content={<FunnelTooltip />} />
                  <Legend
                    formatter={(value: string) => (
                      <span style={{ fontSize: 12, color: '#374151' }}>
                        {CHANNEL_LABEL[value] ?? value}
                      </span>
                    )}
                  />
                  {activeChannels.map((ch) => (
                    <Bar
                      key={ch.channel}
                      dataKey={ch.channel}
                      name={ch.channel}
                      fill={CHANNEL_COLORS[ch.channel] ?? '#6b7280'}
                      radius={[4, 4, 0, 0]}
                    />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}
      </div>

      {/* ── By-channel breakdown table (compact) ─────────────────────────────── */}
      {activeChannels.length > 1 && (
        <div className="bg-white border border-border-brand rounded-xl overflow-hidden">
          <div className="px-6 py-4 border-b border-border-brand">
            <h2 className="text-sm font-semibold text-ink">By channel</h2>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border-brand">
                {['Channel', 'Sent', 'Delivered', 'Opened', 'Clicked', 'Opted out', 'Failed'].map(
                  (h) => (
                    <th
                      key={h}
                      className="px-4 py-2.5 text-left text-xs font-semibold text-ink3 uppercase tracking-wide first:pl-6 last:pr-6"
                    >
                      {h}
                    </th>
                  )
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {activeChannels.map((ch) => (
                <tr key={ch.channel} className="hover:bg-gray-50/50">
                  <td className="pl-6 pr-4 py-3">
                    <ChannelChip channel={ch.channel} />
                  </td>
                  <td className="px-4 py-3 text-ink2">{ch.total_sent.toLocaleString()}</td>
                  <td className="px-4 py-3 text-ink2">{ch.delivered.toLocaleString()}</td>
                  <td className="px-4 py-3 text-ink2">{ch.opened.toLocaleString()}</td>
                  <td className="px-4 py-3 text-ink2">{ch.clicked.toLocaleString()}</td>
                  <td className="px-4 py-3 text-ink2">{ch.opted_out.toLocaleString()}</td>
                  <td className="pr-6 pl-4 py-3 text-ink2">{ch.failed.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Section 4: Contact-level table ───────────────────────────────────── */}
      <div className="bg-white border border-border-brand rounded-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-border-brand flex items-center justify-between flex-wrap gap-2">
          <h2 className="text-sm font-semibold text-ink">
            Contact delivery log{' '}
            <span className="text-ink3 font-normal">({sendsTotal.toLocaleString()})</span>
          </h2>
          {sendsTotal > 0 && (
            <span className="text-xs text-ink3">
              Sorted: failed first, then unconfirmed, then engaged
            </span>
          )}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border-brand">
                {['Contact', 'Channel', 'Status', 'Sent', 'Delivered', 'Opened', 'Clicked'].map(
                  (h) => (
                    <th
                      key={h}
                      className="px-4 py-2.5 text-left text-xs font-semibold text-ink3 uppercase tracking-wide first:pl-6"
                    >
                      {h}
                    </th>
                  )
                )}
              </tr>
            </thead>
            <tbody className={`divide-y divide-gray-50 ${sendsLoading ? 'opacity-50' : ''}`}>
              {sortedSends.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-6 py-12 text-center text-sm text-ink3">
                    No delivery records yet.
                  </td>
                </tr>
              ) : (
                sortedSends.map((row) => (
                  <tr key={row.id} className="hover:bg-gray-50/50 transition-colors">
                    <td className="pl-6 pr-4 py-3">
                      <p className="font-medium text-ink">
                        {row.contact_name ?? row.phone_masked ?? '—'}
                      </p>
                      {row.status === 'failed' && row.error_msg && (
                        <p
                          className="text-xs text-red-500 mt-0.5 max-w-[200px] truncate"
                          title={row.error_msg}
                        >
                          {row.error_msg}
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <ChannelChip channel={row.channel} />
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={row.status} />
                    </td>
                    <td className="px-4 py-3 text-ink2">
                      {row.sent_at ? (
                        <span title={new Date(row.sent_at).toLocaleString()}>
                          {fmtTime(row.sent_at)}
                        </span>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="px-4 py-3 text-ink2">
                      {row.delivered_at ? fmtTime(row.delivered_at) : '—'}
                    </td>
                    <td className="px-4 py-3 text-ink2">
                      {row.opened_at ? fmtTime(row.opened_at) : '—'}
                    </td>
                    <td className="px-4 py-3 text-ink2">
                      {row.clicked_at ? fmtTime(row.clicked_at) : '—'}
                    </td>
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
              onClick={() => loadSendsPage(sendsPage - 1)}
              disabled={sendsPage <= 1 || sendsLoading}
              className="text-sm font-medium text-teal-700 hover:text-teal-800 disabled:text-gray-300 disabled:cursor-not-allowed transition-colors"
            >
              ← Prev
            </button>
            <span className="text-xs text-ink3">
              Page {sendsPage} of {totalPages}
            </span>
            <button
              type="button"
              onClick={() => loadSendsPage(sendsPage + 1)}
              disabled={sendsPage >= totalPages || sendsLoading}
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
