'use client'

import { useState, useEffect } from 'react'

type Preset = '7d' | '30d' | '90d'
type Direction = 'all' | 'inbound' | 'outbound'

interface DayPoint {
  date: string
  count: number
}

interface SourceRow {
  source: string
  totalCalls: number
  wonDeals: number
  avgDuration: number
}

interface MetricsData {
  totalCalls: number
  answeredPct: number
  bookingRate: number
  escalationRate: number
  avgDurationSeconds: number
  sentimentPct: number | null
  callsByDay: DayPoint[]
  topSources: SourceRow[]
  inboundCount: number
  outboundCount: number
}

function getDateRange(preset: Preset): { startDate: string; endDate: string } {
  const now = new Date()
  const end = now.toISOString()
  switch (preset) {
    case '7d':
      return { startDate: new Date(now.getTime() - 7 * 86400000).toISOString(), endDate: end }
    case '30d':
      return { startDate: new Date(now.getTime() - 30 * 86400000).toISOString(), endDate: end }
    case '90d':
      return { startDate: new Date(now.getTime() - 90 * 86400000).toISOString(), endDate: end }
  }
}

function formatDuration(secs: number): string {
  if (secs <= 0) return '0s'
  const m = Math.floor(secs / 60)
  const s = secs % 60
  return m > 0 ? `${m}m ${s}s` : `${s}s`
}

function sourceLabel(s: string): string {
  return s
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

function smoothPath(pts: { x: number; y: number }[]): string {
  if (pts.length < 2) return ''
  const cmds = [`M ${pts[0]!.x.toFixed(1)} ${pts[0]!.y.toFixed(1)}`]
  for (let i = 1; i < pts.length; i++) {
    const p0 = pts[i - 1]!
    const p1 = pts[i]!
    const dx = (p1.x - p0.x) / 3
    cmds.push(
      `C ${(p0.x + dx).toFixed(1)} ${p0.y.toFixed(1)}, ${(p1.x - dx).toFixed(1)} ${p1.y.toFixed(1)}, ${p1.x.toFixed(1)} ${p1.y.toFixed(1)}`
    )
  }
  return cmds.join(' ')
}

function SkeletonCard() {
  return (
    <div className="bg-white rounded-lg border border-border-brand p-4 animate-pulse">
      <div className="h-7 bg-gray-100 rounded w-12 mb-2" />
      <div className="h-2.5 bg-gray-100 rounded w-20" />
    </div>
  )
}

function SkeletonPanel() {
  return (
    <div className="bg-white rounded-lg border border-border-brand p-5 animate-pulse space-y-3">
      <div className="h-3 bg-gray-100 rounded w-40" />
      <div className="h-20 bg-gray-100 rounded" />
      <div className="h-3 bg-gray-100 rounded w-full" />
    </div>
  )
}

export default function CallMetrics() {
  const [preset, setPreset] = useState<Preset>('30d')
  const [direction, setDirection] = useState<Direction>('all')
  const [data, setData] = useState<MetricsData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    const { startDate, endDate } = getDateRange(preset)
    const params = new URLSearchParams({ startDate, endDate, direction })
    void fetch(`/api/calls/metrics?${params}`, { credentials: 'include' })
      .then((r) => r.json())
      .then((d: MetricsData) => {
        setData(d)
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [preset, direction])

  // Sparkline geometry
  const W = 300
  const H = 80
  const PAD = { t: 8, b: 16, l: 4, r: 4 }
  const iW = W - PAD.l - PAD.r
  const iH = H - PAD.t - PAD.b
  const days = data?.callsByDay ?? []
  const maxCount = Math.max(...days.map((d) => d.count), 1)
  const pts = days.map((d, i) => ({
    x: PAD.l + (days.length > 1 ? (i / (days.length - 1)) * iW : iW / 2),
    y: PAD.t + iH - (d.count / maxCount) * iH,
  }))
  const firstDate = days[0]?.date ?? ''
  const lastDate = days[days.length - 1]?.date ?? ''

  function fmtDate(iso: string): string {
    if (!iso) return ''
    const d = new Date(iso + 'T00:00:00')
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  }

  const answeredColor =
    !data || data.totalCalls === 0
      ? 'text-ink2'
      : data.answeredPct >= 80
        ? 'text-green-700'
        : data.answeredPct >= 60
          ? 'text-amber-700'
          : 'text-rose-700'

  const STAT_CARDS = data
    ? [
        {
          label: 'Total Calls',
          value: String(data.totalCalls),
          accent: 'border-t-blue-500',
          numClass: 'text-blue-700',
        },
        {
          label: 'Answered %',
          value: `${data.answeredPct}%`,
          accent: 'border-t-green-500',
          numClass: answeredColor,
        },
        {
          label: 'Booking Rate',
          value: `${data.bookingRate}%`,
          accent: 'border-t-teal-500',
          numClass: 'text-teal-700',
        },
        {
          label: 'Escalation',
          value: `${data.escalationRate}%`,
          accent: 'border-t-amber-500',
          numClass: 'text-amber-700',
        },
        {
          label: 'Avg Duration',
          value: formatDuration(data.avgDurationSeconds),
          accent: 'border-t-purple-500',
          numClass: 'text-purple-700',
        },
        {
          label: 'In / Out',
          value: `${data.inboundCount} / ${data.outboundCount}`,
          accent: 'border-t-indigo-500',
          numClass: 'text-indigo-700',
        },
      ]
    : []

  return (
    <div>
      {/* Filters */}
      <div className="flex items-center gap-3 mb-6 flex-wrap">
        {/* Direction pills */}
        <div className="flex rounded-lg border border-border-brand overflow-hidden text-xs">
          {(['all', 'inbound', 'outbound'] as Direction[]).map((d) => (
            <button
              key={d}
              onClick={() => setDirection(d)}
              className={`px-3 py-1.5 font-medium capitalize transition-colors ${
                direction === d ? 'bg-teal-600 text-white' : 'text-ink3 hover:bg-bg'
              }`}
            >
              {d === 'all' ? 'All' : d.charAt(0).toUpperCase() + d.slice(1)}
            </button>
          ))}
        </div>

        {/* Date preset */}
        <select
          value={preset}
          onChange={(e) => setPreset(e.target.value as Preset)}
          className="px-3 py-1.5 text-sm border border-border-brand rounded-lg focus:ring-1 focus:ring-teal-500 focus:border-teal-500 text-ink2 bg-white"
        >
          <option value="7d">Last 7 days</option>
          <option value="30d">Last 30 days</option>
          <option value="90d">Last 90 days</option>
        </select>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-3 md:grid-cols-6 gap-3 mb-6">
        {loading
          ? Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} />)
          : STAT_CARDS.map(({ label, value, accent, numClass }) => (
              <div
                key={label}
                className={`bg-white rounded-lg border border-border-brand border-t-[3px] p-4 text-center ${accent}`}
              >
                <p className={`text-2xl font-bold ${numClass}`}>{value}</p>
                <p className="text-[10px] uppercase tracking-wide text-ink3 mt-1">{label}</p>
              </div>
            ))}
      </div>

      {/* Panels */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Sparkline */}
        {loading ? (
          <SkeletonPanel />
        ) : (
          <div className="bg-white rounded-lg border border-border-brand p-5">
            <h2 className="text-sm font-semibold text-ink mb-3">Calls This Period</h2>
            {days.length === 0 || maxCount === 0 ? (
              <div className="flex items-center justify-center h-20 text-sm text-ink4">
                No call data yet
              </div>
            ) : (
              <div className="relative">
                <svg
                  viewBox={`0 0 ${W} ${H}`}
                  className="w-full"
                  preserveAspectRatio="none"
                  style={{ height: H }}
                >
                  {/* Y-axis max label */}
                  <text x={PAD.l} y={PAD.t - 2} fontSize="8" fill="#9ca3af">
                    {maxCount}
                  </text>
                  {/* Sparkline path */}
                  <path
                    d={smoothPath(pts)}
                    fill="none"
                    stroke="#0d9488"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  {/* Dots on data points — only if ≤30 points */}
                  {days.length <= 30 &&
                    pts.map((p, i) => <circle key={i} cx={p.x} cy={p.y} r="2" fill="#0d9488" />)}
                </svg>
                {/* X-axis labels */}
                <div className="flex justify-between text-[10px] text-ink4 mt-1">
                  <span>{fmtDate(firstDate)}</span>
                  <span>{fmtDate(lastDate)}</span>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Top Sources + Won Deals */}
        {loading ? (
          <SkeletonPanel />
        ) : (
          <div className="bg-white rounded-lg border border-border-brand p-5">
            <h2 className="text-sm font-semibold text-ink mb-3">Top Call Sources</h2>
            {!data?.topSources.length ? (
              <div className="flex flex-col items-center justify-center py-8 text-center">
                <p className="text-sm text-ink4">No call data yet</p>
              </div>
            ) : (
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border-brand">
                    <th className="text-left font-medium text-ink4 pb-2 pr-3">Source</th>
                    <th className="text-right font-medium text-ink4 pb-2 px-2">Calls</th>
                    <th className="text-right font-medium text-ink4 pb-2 px-2">💰 Won Deals</th>
                    <th className="text-right font-medium text-ink4 pb-2 pl-2">Avg Dur</th>
                  </tr>
                </thead>
                <tbody>
                  {data.topSources.map((row) => (
                    <tr
                      key={row.source}
                      className="border-b border-gray-50 last:border-0 hover:bg-gray-50/50 transition-colors"
                    >
                      <td className="py-2.5 pr-3 text-ink2 font-medium">
                        {sourceLabel(row.source)}
                      </td>
                      <td className="py-2.5 text-right text-ink2 px-2">{row.totalCalls}</td>
                      <td className="py-2.5 text-right px-2">
                        <span
                          className={`font-bold ${row.wonDeals > 0 ? 'text-green-700' : 'text-ink4'}`}
                        >
                          {row.wonDeals}
                        </span>
                      </td>
                      <td className="py-2.5 text-right text-ink3 pl-2">
                        {formatDuration(row.avgDuration)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
