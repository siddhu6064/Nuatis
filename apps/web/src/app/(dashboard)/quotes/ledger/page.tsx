'use client'

import { useState, useEffect, useCallback } from 'react'

interface LedgerEntry {
  id: string
  source: 'stripe' | 'cash' | 'check' | 'other'
  amount: number
  currency: string
  status: string
  created_at: string
  description: string | null
  customer: string | null
  receipt_url: string | null
  quote_id: string | null
  contact_name: string | null
  metadata: Record<string, string>
}

interface LedgerResponse {
  transactions: LedgerEntry[]
  totalVolume: number
  totalCount: number
  stripeVolume: number
  manualVolume: number
}

const SOURCE_LABELS: Record<string, string> = {
  stripe: 'Stripe',
  cash: 'Cash',
  check: 'Check',
  other: 'Other',
}

const SOURCE_COLORS: Record<string, string> = {
  stripe: 'bg-indigo-50 text-indigo-700',
  cash: 'bg-green-50 text-green-700',
  check: 'bg-amber-50 text-amber-700',
  other: 'bg-gray-100 text-gray-600',
}

function fmt(n: number) {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function Skeleton({ className }: { className: string }) {
  return <div className={`animate-pulse bg-gray-100 rounded ${className}`} />
}

export default function LedgerPage() {
  const [data, setData] = useState<LedgerResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [sourceFilter, setSourceFilter] = useState<string>('all')
  const [dateFilter, setDateFilter] = useState<string>('all')

  const load = useCallback(() => {
    setLoading(true)
    fetch('/api/payments/ledger')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d) setData(d as LedgerResponse)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const filtered = (data?.transactions ?? []).filter((t) => {
    if (sourceFilter !== 'all' && t.source !== sourceFilter) return false

    if (dateFilter !== 'all') {
      const days = dateFilter === '7d' ? 7 : dateFilter === '30d' ? 30 : 90
      const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
      if (new Date(t.created_at) < cutoff) return false
    }

    if (search) {
      const q = search.toLowerCase()
      return (
        t.customer?.toLowerCase().includes(q) ||
        t.description?.toLowerCase().includes(q) ||
        t.contact_name?.toLowerCase().includes(q) ||
        false
      )
    }

    return true
  })

  return (
    <div className="p-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-ink">Payment Ledger</h1>
          <p className="text-sm text-ink4 mt-0.5">All collected payments across all channels</p>
        </div>
        <button
          onClick={load}
          className="text-xs text-ink4 hover:text-ink3 border border-border-brand rounded-lg px-3 py-1.5 transition-colors"
        >
          ↻ Refresh
        </button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        {loading ? (
          <>
            <Skeleton className="h-24" />
            <Skeleton className="h-24" />
            <Skeleton className="h-24" />
          </>
        ) : (
          <>
            <div className="bg-white rounded-xl border border-border-brand p-4">
              <p className="text-xs text-ink4 mb-1">Total Collected</p>
              <p className="text-2xl font-bold text-ink">${fmt(data?.totalVolume ?? 0)}</p>
              <p className="text-xs text-ink4 mt-1">{data?.totalCount ?? 0} transactions</p>
            </div>
            <div className="bg-white rounded-xl border border-border-brand p-4">
              <p className="text-xs text-ink4 mb-1">Via Stripe</p>
              <p className="text-2xl font-bold text-indigo-600">${fmt(data?.stripeVolume ?? 0)}</p>
              <p className="text-xs text-ink4 mt-1">Online payments</p>
            </div>
            <div className="bg-white rounded-xl border border-border-brand p-4">
              <p className="text-xs text-ink4 mb-1">Manual / Offline</p>
              <p className="text-2xl font-bold text-green-600">${fmt(data?.manualVolume ?? 0)}</p>
              <p className="text-xs text-ink4 mt-1">Cash, check, other</p>
            </div>
          </>
        )}
      </div>

      {/* Filter bar */}
      <div className="flex flex-wrap gap-3 mb-4">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search customer or description..."
          className="flex-1 min-w-48 text-sm border border-border-brand rounded-lg px-3 py-2 text-ink placeholder-ink4 focus:outline-none focus:ring-1 focus:ring-teal-500"
        />
        <select
          value={sourceFilter}
          onChange={(e) => setSourceFilter(e.target.value)}
          className="text-sm border border-border-brand rounded-lg px-3 py-2 text-ink focus:outline-none focus:ring-1 focus:ring-teal-500"
        >
          <option value="all">All sources</option>
          <option value="stripe">Stripe</option>
          <option value="cash">Cash</option>
          <option value="check">Check</option>
          <option value="other">Other</option>
        </select>
        <select
          value={dateFilter}
          onChange={(e) => setDateFilter(e.target.value)}
          className="text-sm border border-border-brand rounded-lg px-3 py-2 text-ink focus:outline-none focus:ring-1 focus:ring-teal-500"
        >
          <option value="all">All time</option>
          <option value="7d">Last 7 days</option>
          <option value="30d">Last 30 days</option>
          <option value="90d">Last 90 days</option>
        </select>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-border-brand overflow-hidden">
        {loading ? (
          <div className="p-6 space-y-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-10" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-16 text-center">
            <p className="text-2xl mb-2">📒</p>
            <p className="text-sm font-medium text-ink2">No transactions found</p>
            <p className="text-xs text-ink4 mt-1">
              {data?.totalCount === 0
                ? 'Payments will appear here once recorded.'
                : 'Try adjusting your filters.'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border-brand bg-gray-50">
                  <th className="text-left px-4 py-3 text-xs font-semibold text-ink4">Date</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-ink4">Customer</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-ink4">
                    Description
                  </th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-ink4">Amount</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-ink4">Method</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-ink4">Status</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-ink4">Receipt</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {filtered.map((t) => (
                  <tr key={t.id} className="hover:bg-gray-50/50 transition-colors">
                    <td className="px-4 py-3 text-xs text-ink3 whitespace-nowrap">
                      {new Date(t.created_at).toLocaleDateString('en-US', {
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric',
                      })}
                    </td>
                    <td className="px-4 py-3 text-ink2 max-w-[140px] truncate">
                      {t.contact_name ?? t.customer ?? '—'}
                    </td>
                    <td className="px-4 py-3 text-ink3 max-w-[200px] truncate">
                      {t.description ?? '—'}
                    </td>
                    <td className="px-4 py-3 text-right font-semibold text-ink">
                      ${fmt(t.amount)}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-block text-[11px] font-medium px-2 py-0.5 rounded-full ${SOURCE_COLORS[t.source] ?? 'bg-gray-100 text-gray-600'}`}
                      >
                        {SOURCE_LABELS[t.source] ?? t.source}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-block text-[11px] font-medium px-2 py-0.5 rounded-full ${
                          t.status === 'succeeded'
                            ? 'bg-green-50 text-green-700'
                            : t.status === 'pending'
                              ? 'bg-amber-50 text-amber-700'
                              : 'bg-rose-50 text-rose-700'
                        }`}
                      >
                        {t.status === 'succeeded' ? 'Paid' : t.status}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {t.receipt_url ? (
                        <a
                          href={t.receipt_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-teal-600 hover:underline"
                        >
                          View ↗
                        </a>
                      ) : (
                        <span className="text-xs text-ink4">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Footer count */}
        {!loading && filtered.length > 0 && (
          <div className="border-t border-border-brand px-4 py-3 flex items-center justify-between">
            <p className="text-xs text-ink4">
              Showing {filtered.length} of {data?.totalCount ?? 0} transactions
            </p>
            <p className="text-xs font-semibold text-ink">
              Total shown: ${fmt(filtered.reduce((s, t) => s + t.amount, 0))}
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
