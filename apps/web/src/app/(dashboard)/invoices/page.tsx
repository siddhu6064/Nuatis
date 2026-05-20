'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'

// ── Types ──────────────────────────────────────────────────────────────────────

interface Invoice {
  id: string
  invoice_number: string
  status: string
  issue_date: string | null
  due_date: string | null
  total: number
  amount_paid: number
  paid_at: string | null
  contacts: { full_name: string } | null
}

type FilterTab = 'all' | 'draft' | 'sent' | 'due' | 'overdue' | 'received'

// ── Helpers ────────────────────────────────────────────────────────────────────

function formatCurrency(value: number): string {
  return (
    '$' +
    Number(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  )
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '—'
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

function balanceDue(invoice: Invoice): number {
  return Math.max(0, Number(invoice.total) - Number(invoice.amount_paid ?? 0))
}

// ── Status badge config ────────────────────────────────────────────────────────

const STATUS_BADGE: Record<string, { bg: string; text: string; label: string; extra?: string }> = {
  draft: { bg: 'bg-gray-100', text: 'text-gray-600', label: 'Draft' },
  sent: { bg: 'bg-blue-100', text: 'text-blue-700', label: 'Sent' },
  due: { bg: 'bg-amber-100', text: 'text-amber-700', label: 'Due' },
  overdue: { bg: 'bg-red-100', text: 'text-red-700', label: 'Overdue' },
  received: { bg: 'bg-green-100', text: 'text-green-700', label: 'Received' },
  void: { bg: 'bg-gray-100', text: 'text-gray-400', label: 'Void', extra: 'line-through' },
}

const FILTER_TABS: { key: FilterTab; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'draft', label: 'Draft' },
  { key: 'sent', label: 'Sent' },
  { key: 'due', label: 'Due' },
  { key: 'overdue', label: 'Overdue' },
  { key: 'received', label: 'Received' },
]

// ── Component ──────────────────────────────────────────────────────────────────

export default function InvoicesPage() {
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [allInvoices, setAllInvoices] = useState<Invoice[]>([])
  const [filter, setFilter] = useState<FilterTab>('all')
  const [loading, setLoading] = useState(true)
  const [totalPages, setTotalPages] = useState(1)
  const [page, setPage] = useState(1)
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [toast, setToast] = useState<{ type: 'success' | 'error'; msg: string } | null>(null)

  function showToast(type: 'success' | 'error', msg: string) {
    setToast({ type, msg })
    setTimeout(() => setToast(null), 4000)
  }

  // Fetch all invoices (up to 200) for stats — runs once on mount
  useEffect(() => {
    fetch('/api/invoices?limit=200')
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { invoices?: Invoice[] } | null) => {
        if (d?.invoices) setAllInvoices(d.invoices)
      })
      .catch(() => {})
  }, [])

  // Fetch filtered list
  const fetchInvoices = useCallback(async (f: FilterTab, p: number) => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ page: String(p), limit: '20' })
      if (f !== 'all') params.set('status', f)
      const res = await fetch(`/api/invoices?${params.toString()}`)
      if (!res.ok) throw new Error('Failed to load')
      const data = (await res.json()) as { invoices: Invoice[]; pages: number }
      setInvoices(data.invoices ?? [])
      setTotalPages(data.pages ?? 1)
    } catch {
      showToast('error', 'Failed to load invoices')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void fetchInvoices(filter, page)
  }, [filter, page, fetchInvoices])

  // ── Stats ──────────────────────────────────────────────────────────────────

  const totalOutstanding = allInvoices
    .filter((inv) => ['sent', 'due', 'overdue'].includes(inv.status))
    .reduce((sum, inv) => sum + balanceDue(inv), 0)

  const totalOverdue = allInvoices
    .filter((inv) => inv.status === 'overdue')
    .reduce((sum, inv) => sum + balanceDue(inv), 0)

  const now = new Date()
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
  const receivedThisMonth = allInvoices
    .filter(
      (inv) => inv.status === 'received' && inv.paid_at != null && inv.paid_at >= startOfMonth
    )
    .reduce((sum, inv) => sum + Number(inv.total), 0)

  // ── Actions ────────────────────────────────────────────────────────────────

  async function handleSend(id: string) {
    setActionLoading(id + ':send')
    try {
      const res = await fetch(`/api/invoices/${id}/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
      if (!res.ok) {
        const err = (await res.json()) as { error?: string }
        throw new Error(err.error ?? 'Failed to send')
      }
      showToast('success', 'Invoice sent')
      void fetchInvoices(filter, page)
      // Refresh all invoices stats
      fetch('/api/invoices?limit=200')
        .then((r) => (r.ok ? r.json() : null))
        .then((d: { invoices?: Invoice[] } | null) => {
          if (d?.invoices) setAllInvoices(d.invoices)
        })
        .catch(() => {})
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : 'Failed to send')
    } finally {
      setActionLoading(null)
    }
  }

  async function handleVoid(id: string, invoiceNumber: string) {
    if (!confirm(`Void invoice ${invoiceNumber}? This cannot be undone.`)) return
    setActionLoading(id + ':void')
    try {
      const res = await fetch(`/api/invoices/${id}/void`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
      if (!res.ok) {
        const err = (await res.json()) as { error?: string }
        throw new Error(err.error ?? 'Failed to void')
      }
      showToast('success', 'Invoice voided')
      void fetchInvoices(filter, page)
      fetch('/api/invoices?limit=200')
        .then((r) => (r.ok ? r.json() : null))
        .then((d: { invoices?: Invoice[] } | null) => {
          if (d?.invoices) setAllInvoices(d.invoices)
        })
        .catch(() => {})
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : 'Failed to void')
    } finally {
      setActionLoading(null)
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="px-8 py-8">
      {/* Toast */}
      {toast && (
        <div
          className={`fixed top-4 right-4 z-50 px-4 py-3 rounded-lg shadow-lg text-sm font-medium transition-all ${
            toast.type === 'success'
              ? 'bg-green-50 text-green-700 border border-green-200'
              : 'bg-red-50 text-red-700 border border-red-200'
          }`}
        >
          {toast.msg}
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-ink">Invoices</h1>
          <p className="text-sm text-ink3 mt-0.5">
            {filter === 'all' ? `${invoices.length} shown` : `${invoices.length} ${filter}`}
          </p>
        </div>
        <Link
          href="/invoices/new"
          className="flex items-center gap-2 px-4 py-2 bg-teal-600 text-white text-sm font-medium rounded-lg hover:bg-teal-700 transition-colors"
        >
          <span className="text-base leading-none">+</span>
          New Invoice
        </Link>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="bg-white rounded-xl border border-border-brand px-5 py-4">
          <p className="text-xs text-ink4 font-medium uppercase tracking-wide mb-1">
            Total Outstanding
          </p>
          <p className="text-2xl font-bold text-ink">{formatCurrency(totalOutstanding)}</p>
          <p className="text-xs text-ink4 mt-0.5">sent + due + overdue</p>
        </div>
        <div className="bg-white rounded-xl border border-border-brand px-5 py-4">
          <p className="text-xs text-ink4 font-medium uppercase tracking-wide mb-1">Overdue</p>
          <p className="text-2xl font-bold text-red-600">{formatCurrency(totalOverdue)}</p>
          <p className="text-xs text-ink4 mt-0.5">past due date</p>
        </div>
        <div className="bg-white rounded-xl border border-border-brand px-5 py-4">
          <p className="text-xs text-ink4 font-medium uppercase tracking-wide mb-1">
            Received This Month
          </p>
          <p className="text-2xl font-bold text-green-600">{formatCurrency(receivedThisMonth)}</p>
          <p className="text-xs text-ink4 mt-0.5">payments received</p>
        </div>
      </div>

      {/* Filter tabs */}
      <div className="flex items-center gap-1 mb-4 bg-bg rounded-lg p-1 w-fit">
        {FILTER_TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => {
              setFilter(tab.key)
              setPage(1)
            }}
            className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
              filter === tab.key
                ? 'bg-white text-ink shadow-sm'
                : 'text-ink3 hover:text-ink hover:bg-white/60'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-border-brand">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="w-5 h-5 border-2 border-teal-600 border-t-transparent rounded-full animate-spin" />
            <span className="ml-2 text-sm text-ink4">Loading…</span>
          </div>
        ) : invoices.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="w-10 h-10 rounded-full bg-bg flex items-center justify-center mb-3">
              <span className="text-gray-300 text-xl">◫</span>
            </div>
            <p className="text-sm font-medium text-ink4">No invoices</p>
            <p className="text-xs text-gray-300 mt-1">
              {filter === 'all'
                ? 'Create your first invoice to bill customers'
                : `No ${filter} invoices`}
            </p>
            {filter === 'all' && (
              <Link href="/invoices/new" className="mt-4 text-xs text-teal-600 font-medium">
                New Invoice &rarr;
              </Link>
            )}
          </div>
        ) : (
          <>
            <table className="w-full">
              <thead>
                <tr className="border-b border-border-brand">
                  <th className="text-left text-xs font-medium text-ink4 px-6 py-3">Invoice #</th>
                  <th className="text-left text-xs font-medium text-ink4 px-6 py-3">Contact</th>
                  <th className="text-left text-xs font-medium text-ink4 px-6 py-3">Issue Date</th>
                  <th className="text-left text-xs font-medium text-ink4 px-6 py-3">Due Date</th>
                  <th className="text-right text-xs font-medium text-ink4 px-6 py-3">Total</th>
                  <th className="text-right text-xs font-medium text-ink4 px-6 py-3">
                    Balance Due
                  </th>
                  <th className="text-left text-xs font-medium text-ink4 px-6 py-3">Status</th>
                  <th className="text-left text-xs font-medium text-ink4 px-6 py-3">Actions</th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((inv) => {
                  const badge = STATUS_BADGE[inv.status] ?? STATUS_BADGE['draft']!
                  const balance = balanceDue(inv)
                  const isSendLoading = actionLoading === inv.id + ':send'
                  const isVoidLoading = actionLoading === inv.id + ':void'
                  return (
                    <tr
                      key={inv.id}
                      className="border-b border-gray-50 last:border-0 hover:bg-gray-50/50"
                    >
                      {/* Invoice # */}
                      <td className="px-6 py-4">
                        <Link
                          href={`/invoices/${inv.id}`}
                          className="text-sm font-mono text-teal-600 hover:text-teal-700"
                        >
                          {inv.invoice_number}
                        </Link>
                      </td>

                      {/* Contact */}
                      <td className="px-6 py-4 text-sm text-ink2">
                        {inv.contacts?.full_name ?? '—'}
                      </td>

                      {/* Issue Date */}
                      <td className="px-6 py-4 text-sm text-ink4">{formatDate(inv.issue_date)}</td>

                      {/* Due Date */}
                      <td className="px-6 py-4 text-sm text-ink4">{formatDate(inv.due_date)}</td>

                      {/* Total */}
                      <td className="px-6 py-4 text-sm font-medium text-ink text-right">
                        {formatCurrency(Number(inv.total))}
                      </td>

                      {/* Balance Due */}
                      <td className="px-6 py-4 text-sm font-medium text-right">
                        <span
                          className={
                            balance > 0 && inv.status !== 'void'
                              ? inv.status === 'overdue'
                                ? 'text-red-600'
                                : 'text-ink'
                              : 'text-ink4'
                          }
                        >
                          {inv.status === 'void' ? '—' : formatCurrency(balance)}
                        </span>
                      </td>

                      {/* Status */}
                      <td className="px-6 py-4">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${badge.bg} ${badge.text} ${badge.extra ?? ''}`}
                        >
                          {badge.label}
                        </span>
                      </td>

                      {/* Actions */}
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-2">
                          {/* View */}
                          <Link
                            href={`/invoices/${inv.id}`}
                            className="text-xs text-teal-600 hover:text-teal-700 font-medium"
                          >
                            View
                          </Link>

                          {/* Send — draft or due */}
                          {(inv.status === 'draft' || inv.status === 'due') && (
                            <button
                              type="button"
                              disabled={isSendLoading}
                              onClick={() => void handleSend(inv.id)}
                              className="text-xs text-blue-600 hover:text-blue-700 font-medium disabled:opacity-50"
                            >
                              {isSendLoading ? 'Sending…' : 'Send'}
                            </button>
                          )}

                          {/* Record Payment — sent, due, overdue */}
                          {['sent', 'due', 'overdue'].includes(inv.status) && (
                            <Link
                              href={`/invoices/${inv.id}?action=payment`}
                              className="text-xs text-green-600 hover:text-green-700 font-medium"
                            >
                              Record Payment
                            </Link>
                          )}

                          {/* Void — not received, not already void */}
                          {inv.status !== 'received' && inv.status !== 'void' && (
                            <button
                              type="button"
                              disabled={isVoidLoading}
                              onClick={() => void handleVoid(inv.id, inv.invoice_number)}
                              className="text-xs text-red-500 hover:text-red-600 font-medium disabled:opacity-50"
                            >
                              {isVoidLoading ? 'Voiding…' : 'Void'}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between px-6 py-3 border-t border-border-brand">
                <button
                  type="button"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => p - 1)}
                  className="text-xs text-ink3 hover:text-ink disabled:opacity-40 font-medium"
                >
                  ← Previous
                </button>
                <span className="text-xs text-ink4">
                  Page {page} of {totalPages}
                </span>
                <button
                  type="button"
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => p + 1)}
                  className="text-xs text-ink3 hover:text-ink disabled:opacity-40 font-medium"
                >
                  Next →
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
