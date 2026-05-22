'use client'

import { useState, useEffect } from 'react'

interface SourceRow {
  source: string
  lead_count: number
  won_count: number
  lost_count: number
  open_count: number
  won_value: number
  win_rate: number
}

const SOURCE_ICONS: Record<string, string> = {
  inbound_call: '📞',
  outbound_call: '📤',
  web_form: '🌐',
  referral: '👥',
  manual: '✏️',
  import: '📥',
  unknown: '•',
}

function sourceLabel(s: string): string {
  return s
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

function formatValue(v: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(v)
}

function winRateBadge(rate: number, leadCount: number): React.ReactNode {
  if (leadCount === 0) return <span className="text-ink4">—</span>
  const cls =
    rate >= 40
      ? 'bg-green-50 text-green-700'
      : rate >= 20
        ? 'bg-amber-50 text-amber-700'
        : 'bg-rose-50 text-rose-700'
  return (
    <span
      className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold ${cls}`}
    >
      {rate}%
    </span>
  )
}

function SkeletonRow() {
  return (
    <tr className="border-b border-gray-50 animate-pulse">
      {[...Array(7)].map((_, i) => (
        <td key={i} className="px-3 py-3">
          <div className="h-3 bg-gray-100 rounded w-3/4" />
        </td>
      ))}
    </tr>
  )
}

export default function LeadSourceReport() {
  const [rows, setRows] = useState<SourceRow[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    void fetch('/api/contacts/source-report', { credentials: 'include' })
      .then((r) => r.json())
      .then((d: { sources: SourceRow[] }) => {
        setRows(d.sources ?? [])
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [])

  const totalLeads = rows.reduce((s, r) => s + r.lead_count, 0)
  const totalWonValue = rows.reduce((s, r) => s + r.won_value, 0)
  const totalWon = rows.reduce((s, r) => s + r.won_count, 0)
  const overallWinRate = totalLeads > 0 ? Math.round((totalWon / totalLeads) * 100) : 0

  return (
    <div className="bg-white rounded-xl border border-border-brand p-5 h-full">
      <div className="mb-4">
        <h2 className="text-sm font-semibold text-ink">Lead Source Report</h2>
        <p className="text-xs text-ink3 mt-0.5">Where your leads come from</p>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border-brand">
              <th className="text-left font-medium text-ink4 pb-2 pr-3">Source</th>
              <th className="text-right font-medium text-ink4 pb-2 px-2">Leads</th>
              <th className="text-right font-medium text-ink4 pb-2 px-2">Open</th>
              <th className="text-right font-medium text-ink4 pb-2 px-2">Won</th>
              <th className="text-right font-medium text-ink4 pb-2 px-2">Lost</th>
              <th className="text-right font-medium text-ink4 pb-2 px-2">Value</th>
              <th className="text-right font-medium text-ink4 pb-2 pl-2">Win %</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <>
                <SkeletonRow />
                <SkeletonRow />
                <SkeletonRow />
                <SkeletonRow />
              </>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="py-10 text-center text-sm text-ink4">
                  No lead data yet — leads will appear as contacts are added
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr
                  key={row.source}
                  className="border-b border-gray-50 last:border-0 hover:bg-gray-50/50 transition-colors"
                >
                  <td className="py-2.5 pr-3">
                    <span className="flex items-center gap-1.5">
                      <span className="text-sm leading-none">
                        {SOURCE_ICONS[row.source] ?? SOURCE_ICONS['unknown']}
                      </span>
                      <span className="text-ink2 font-medium">{sourceLabel(row.source)}</span>
                    </span>
                  </td>
                  <td className="py-2.5 text-right text-ink2 font-semibold px-2">
                    {row.lead_count}
                  </td>
                  <td className="py-2.5 text-right text-ink3 px-2">{row.open_count}</td>
                  <td className="py-2.5 text-right text-green-700 px-2">{row.won_count}</td>
                  <td className="py-2.5 text-right text-rose-600 px-2">{row.lost_count}</td>
                  <td className="py-2.5 text-right text-ink3 px-2">
                    {row.won_value > 0 ? formatValue(row.won_value) : '—'}
                  </td>
                  <td className="py-2.5 text-right pl-2">
                    {winRateBadge(row.win_rate, row.lead_count)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
          {!loading && rows.length > 0 && (
            <tfoot>
              <tr className="border-t border-border-brand">
                <td className="pt-2.5 pr-3 text-xs font-semibold text-ink">Total</td>
                <td className="pt-2.5 text-right text-ink font-bold px-2">{totalLeads}</td>
                <td className="pt-2.5 px-2" />
                <td className="pt-2.5 px-2" />
                <td className="pt-2.5 px-2" />
                <td className="pt-2.5 text-right text-ink font-bold px-2">
                  {totalWonValue > 0 ? formatValue(totalWonValue) : '—'}
                </td>
                <td className="pt-2.5 text-right pl-2">
                  {winRateBadge(overallWinRate, totalLeads)}
                </td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  )
}
