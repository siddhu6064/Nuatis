'use client'

import { useState, useEffect, useCallback } from 'react'
import Button from '@mui/material/Button'
import TextField from '@mui/material/TextField'
import MenuItem from '@mui/material/MenuItem'
import { Modal } from '@/components/ui/Modal'

interface LedgerEntry {
  id: string
  source: 'stripe' | 'cash' | 'check' | 'square' | 'other'
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
  quote_payment_id: string | null
  refundable_amount: number | null
  refund_status: 'none' | 'partial' | 'full' | null
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
  square: 'Square',
  other: 'Other',
}

const SOURCE_COLORS: Record<string, string> = {
  stripe: 'bg-indigo-50 text-indigo-700',
  cash: 'bg-green-50 text-green-700',
  check: 'bg-amber-50 text-amber-700',
  square: 'bg-blue-50 text-blue-700',
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
  const [refunding, setRefunding] = useState<LedgerEntry | null>(null)
  const [refundAmount, setRefundAmount] = useState('')
  const [refundBusy, setRefundBusy] = useState(false)
  const [refundError, setRefundError] = useState<string | null>(null)

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

  function openRefund(entry: LedgerEntry) {
    setRefunding(entry)
    setRefundAmount(entry.refundable_amount != null ? String(entry.refundable_amount) : '')
    setRefundError(null)
  }

  async function confirmRefund() {
    if (!refunding || !refunding.quote_id || !refunding.quote_payment_id) return
    const amount = Number(refundAmount)
    if (!Number.isFinite(amount) || amount <= 0) {
      setRefundError('Enter a valid amount')
      return
    }
    setRefundBusy(true)
    setRefundError(null)
    try {
      const res = await fetch(
        `/api/quotes/${refunding.quote_id}/payments/${refunding.quote_payment_id}/refund`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ amount }),
        }
      )
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        throw new Error((d as { error?: string }).error ?? 'Refund failed')
      }
      setRefunding(null)
      load()
    } catch (err) {
      setRefundError(err instanceof Error ? err.message : 'Refund failed')
    } finally {
      setRefundBusy(false)
    }
  }

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
        <Button onClick={load} variant="outlined" color="inherit" size="small">
          ↻ Refresh
        </Button>
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
              <p className="text-xs text-ink4 mt-1">Cash, check, Square, other</p>
            </div>
          </>
        )}
      </div>

      {/* Filter bar */}
      <div className="flex flex-wrap gap-3 mb-4">
        <TextField
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search customer or description..."
          size="small"
          className="flex-1 min-w-48"
        />
        <TextField
          select
          value={sourceFilter}
          onChange={(e) => setSourceFilter(e.target.value)}
          size="small"
        >
          <MenuItem value="all">All sources</MenuItem>
          <MenuItem value="stripe">Stripe</MenuItem>
          <MenuItem value="cash">Cash</MenuItem>
          <MenuItem value="check">Check</MenuItem>
          <MenuItem value="square">Square</MenuItem>
          <MenuItem value="other">Other</MenuItem>
        </TextField>
        <TextField
          select
          value={dateFilter}
          onChange={(e) => setDateFilter(e.target.value)}
          size="small"
        >
          <MenuItem value="all">All time</MenuItem>
          <MenuItem value="7d">Last 7 days</MenuItem>
          <MenuItem value="30d">Last 30 days</MenuItem>
          <MenuItem value="90d">Last 90 days</MenuItem>
        </TextField>
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
                  <th className="text-left px-4 py-3 text-xs font-semibold text-ink4">Refund</th>
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
                    <td className="px-4 py-3">
                      {t.refund_status === 'full' ? (
                        <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">
                          Refunded
                        </span>
                      ) : t.quote_payment_id ? (
                        <button
                          type="button"
                          onClick={() => openRefund(t)}
                          className="text-xs text-teal-600 hover:underline"
                        >
                          {t.refund_status === 'partial' ? 'Refund more' : 'Refund'}
                        </button>
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

      {refunding && (
        <Modal
          onClose={() => (refundBusy ? null : setRefunding(null))}
          title="Refund payment"
          footer={
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setRefunding(null)}
                disabled={refundBusy}
                className="text-sm text-ink4 hover:underline disabled:opacity-50"
              >
                Cancel
              </button>
              <Button
                onClick={() => void confirmRefund()}
                disabled={refundBusy}
                variant="contained"
                color="error"
                size="small"
              >
                {refundBusy ? 'Refunding…' : 'Refund'}
              </Button>
            </div>
          }
        >
          <p className="text-sm text-ink3 mb-3">
            {refunding.contact_name ?? refunding.customer ?? 'This customer'} — up to $
            {fmt(refunding.refundable_amount ?? 0)} refundable via Square.
          </p>
          <TextField
            type="number"
            label="Amount"
            value={refundAmount}
            onChange={(e) => setRefundAmount(e.target.value)}
            size="small"
            fullWidth
            slotProps={{ htmlInput: { min: 0.01, step: 0.01 } }}
          />
          {refundError && <p className="text-xs text-red-600 mt-2">{refundError}</p>}
        </Modal>
      )}
    </div>
  )
}
