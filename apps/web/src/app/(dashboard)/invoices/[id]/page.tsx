'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'

// ── Types ──────────────────────────────────────────────────────────────────────

interface LineItem {
  id?: string
  description: string
  quantity: number
  unit_price: number
}

interface Contact {
  full_name: string
  phone: string | null
  email: string | null
}

interface Invoice {
  id: string
  invoice_number: string
  status: string
  issue_date: string | null
  due_date: string | null
  contact_id: string | null
  contacts: Contact | null
  subtotal: number
  tax_rate: number
  tax_amount: number
  total: number
  amount_paid: number
  paid_at: string | null
  sent_at: string | null
  created_at: string
  notes: string | null
  line_items: LineItem[]
}

interface ContactResult {
  id: string
  full_name: string
  email: string | null
  phone: string | null
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function formatCurrency(value: number): string {
  return (
    '$' +
    Number(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  )
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '—'
  return new Date(dateStr).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
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

const PAYMENT_METHODS = ['stripe', 'square', 'cash', 'check', 'other'] as const

// ── Component ──────────────────────────────────────────────────────────────────

export default function InvoiceDetailPage() {
  const params = useParams()
  const id = params['id'] as string

  // ── Core state ─────────────────────────────────────────────────────────────
  const [invoice, setInvoice] = useState<Invoice | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // ── Editor state ───────────────────────────────────────────────────────────
  const [issueDate, setIssueDate] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [notes, setNotes] = useState('')
  const [taxRate, setTaxRate] = useState(0)
  const [lineItems, setLineItems] = useState<LineItem[]>([])

  // ── Contact picker ─────────────────────────────────────────────────────────
  const [contactSearch, setContactSearch] = useState('')
  const [contactId, setContactId] = useState<string | null>(null)
  const [contactName, setContactName] = useState('')
  const [contactResults, setContactResults] = useState<ContactResult[]>([])
  const [contactDropOpen, setContactDropOpen] = useState(false)
  const contactSearchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ── Action state ───────────────────────────────────────────────────────────
  const [saving, setSaving] = useState(false)
  const [acting, setActing] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [toast, setToast] = useState<{ type: 'success' | 'error'; msg: string } | null>(null)

  // ── Payment form ───────────────────────────────────────────────────────────
  const [payAmount, setPayAmount] = useState('')
  const [payMethod, setPayMethod] = useState<string>('cash')
  const [payNotes, setPayNotes] = useState('')

  // ── Fetch invoice ──────────────────────────────────────────────────────────
  const fetchInvoice = useCallback(async () => {
    try {
      const res = await fetch(`/api/invoices/${id}`)
      if (!res.ok) throw new Error('Invoice not found')
      const data = (await res.json()) as Invoice
      setInvoice(data)
      setIssueDate(data.issue_date ?? '')
      setDueDate(data.due_date ?? '')
      setNotes(data.notes ?? '')
      setTaxRate(Number(data.tax_rate ?? 0))
      setLineItems(
        data.line_items.length > 0
          ? data.line_items.map((li) => ({
              id: li.id,
              description: li.description,
              quantity: Number(li.quantity),
              unit_price: Number(li.unit_price),
            }))
          : [{ description: '', quantity: 1, unit_price: 0 }]
      )
      setContactId(data.contact_id)
      setContactName(data.contacts?.full_name ?? '')
      setContactSearch(data.contacts?.full_name ?? '')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load invoice')
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    void fetchInvoice()
  }, [fetchInvoice])

  // ── Contact search ─────────────────────────────────────────────────────────
  function handleContactInput(val: string) {
    setContactSearch(val)
    setContactDropOpen(true)
    if (contactSearchTimer.current) clearTimeout(contactSearchTimer.current)
    if (!val.trim()) {
      setContactResults([])
      return
    }
    contactSearchTimer.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/contacts?q=${encodeURIComponent(val)}&limit=8`)
        if (!res.ok) return
        const data = (await res.json()) as { contacts?: ContactResult[] }
        setContactResults(data.contacts ?? [])
      } catch {
        // ignore
      }
    }, 300)
  }

  function selectContact(c: ContactResult) {
    setContactId(c.id)
    setContactName(c.full_name)
    setContactSearch(c.full_name)
    setContactResults([])
    setContactDropOpen(false)
  }

  // ── Line item helpers ──────────────────────────────────────────────────────
  function updateLineItem(index: number, field: keyof LineItem, value: string | number) {
    setLineItems((prev) =>
      prev.map((item, i) => (i === index ? { ...item, [field]: value } : item))
    )
  }

  function addLineItem() {
    setLineItems((prev) => [...prev, { description: '', quantity: 1, unit_price: 0 }])
  }

  function removeLineItem(index: number) {
    setLineItems((prev) => (prev.length > 1 ? prev.filter((_, i) => i !== index) : prev))
  }

  // ── Computed totals ────────────────────────────────────────────────────────
  const subtotal = lineItems.reduce(
    (sum, li) => sum + Number(li.quantity) * Number(li.unit_price),
    0
  )
  const taxAmount = (subtotal * taxRate) / 100
  const total = subtotal + taxAmount
  const amountPaid = Number(invoice?.amount_paid ?? 0)
  const balanceDue = Math.max(0, total - amountPaid)

  function showToast(type: 'success' | 'error', msg: string) {
    setToast({ type, msg })
    setTimeout(() => setToast(null), 4000)
  }

  // ── Save ────────────────────────────────────────────────────────────────────
  async function handleSave() {
    if (!invoice || invoice.status !== 'draft') return
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/invoices/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contact_id: contactId,
          issue_date: issueDate || null,
          due_date: dueDate || null,
          notes: notes || null,
          tax_rate: taxRate,
          line_items: lineItems.map((li) => ({
            description: li.description,
            quantity: Number(li.quantity),
            unit_price: Number(li.unit_price),
          })),
        }),
      })
      if (!res.ok) {
        const err = (await res.json()) as { error?: string }
        throw new Error(err.error ?? 'Failed to save')
      }
      showToast('success', 'Invoice saved')
      await fetchInvoice()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  // ── Send ────────────────────────────────────────────────────────────────────
  async function handleSend() {
    setActing(true)
    setActionError(null)
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
      await fetchInvoice()
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to send')
    } finally {
      setActing(false)
    }
  }

  // ── Record Payment ──────────────────────────────────────────────────────────
  async function handleRecordPayment() {
    const amount = parseFloat(payAmount)
    if (isNaN(amount) || amount <= 0) {
      setActionError('Enter a valid amount')
      return
    }
    setActing(true)
    setActionError(null)
    try {
      const res = await fetch(`/api/invoices/${id}/record-payment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount, method: payMethod, notes: payNotes || null }),
      })
      if (!res.ok) {
        const err = (await res.json()) as { error?: string }
        throw new Error(err.error ?? 'Failed to record payment')
      }
      showToast('success', 'Payment recorded')
      setPayAmount('')
      setPayNotes('')
      await fetchInvoice()
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to record payment')
    } finally {
      setActing(false)
    }
  }

  // ── Void ────────────────────────────────────────────────────────────────────
  async function handleVoid() {
    if (!invoice) return
    if (!confirm(`Void invoice ${invoice.invoice_number}? This cannot be undone.`)) return
    setActing(true)
    setActionError(null)
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
      await fetchInvoice()
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to void')
    } finally {
      setActing(false)
    }
  }

  // ── Render: loading / error ────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex items-center justify-center py-32">
        <div className="w-5 h-5 border-2 border-teal-600 border-t-transparent rounded-full animate-spin" />
        <span className="ml-2 text-sm text-ink4">Loading invoice…</span>
      </div>
    )
  }

  if (error && !invoice) {
    return (
      <div className="px-8 py-8">
        <Link
          href="/invoices"
          className="inline-flex items-center gap-1 text-sm text-ink4 hover:text-ink3 mb-6"
        >
          &larr; Back to Invoices
        </Link>
        <div className="bg-red-50 border border-red-200 rounded-xl p-6 text-sm text-red-700">
          {error}
        </div>
      </div>
    )
  }

  if (!invoice) return null

  const badge = STATUS_BADGE[invoice.status] ?? STATUS_BADGE['draft']!
  const isDraft = invoice.status === 'draft'
  const canRecordPayment = ['sent', 'due', 'overdue'].includes(invoice.status)
  const canVoid = invoice.status !== 'received' && invoice.status !== 'void'

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

      {/* Back link */}
      <Link
        href="/invoices"
        className="inline-flex items-center gap-1 text-sm text-ink4 hover:text-ink3 mb-6"
      >
        &larr; Back to Invoices
      </Link>

      {/* Two-column layout */}
      <div className="flex gap-6 items-start">
        {/* ── LEFT: Invoice Editor (2/3) ────────────────────────────────────── */}
        <div className="flex-1 min-w-0 space-y-6">
          {/* Header */}
          <div className="bg-white rounded-xl border border-border-brand p-6">
            <div className="flex items-center gap-3 mb-4">
              <h1 className="text-xl font-bold font-mono text-ink">{invoice.invoice_number}</h1>
              <span
                className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${badge.bg} ${badge.text} ${badge.extra ?? ''}`}
              >
                {badge.label}
              </span>
            </div>

            {/* Dates */}
            <div className="grid grid-cols-2 gap-4 mb-4">
              <div>
                <label className="block text-xs font-medium text-ink4 mb-1">Issue Date</label>
                <input
                  type="date"
                  value={issueDate}
                  onChange={(e) => setIssueDate(e.target.value)}
                  disabled={!isDraft}
                  className="w-full border border-border-brand rounded-lg px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-teal-500 disabled:bg-bg disabled:text-ink4"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-ink4 mb-1">Due Date</label>
                <input
                  type="date"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                  disabled={!isDraft}
                  className="w-full border border-border-brand rounded-lg px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-teal-500 disabled:bg-bg disabled:text-ink4"
                />
              </div>
            </div>

            {/* Contact picker */}
            <div className="relative">
              <label className="block text-xs font-medium text-ink4 mb-1">Contact</label>
              <input
                type="text"
                value={contactSearch}
                onChange={(e) => handleContactInput(e.target.value)}
                onFocus={() => {
                  if (contactSearch) setContactDropOpen(true)
                }}
                onBlur={() => setTimeout(() => setContactDropOpen(false), 150)}
                disabled={!isDraft}
                placeholder="Search contacts…"
                className="w-full border border-border-brand rounded-lg px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-teal-500 disabled:bg-bg disabled:text-ink4"
              />
              {contactDropOpen && contactResults.length > 0 && (
                <div className="absolute z-10 w-full bg-white border border-border-brand rounded-lg shadow-lg mt-1 max-h-48 overflow-auto">
                  {contactResults.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onMouseDown={() => selectContact(c)}
                      className="w-full text-left px-3 py-2.5 hover:bg-bg text-sm"
                    >
                      <span className="font-medium text-ink">{c.full_name}</span>
                      {c.email && <span className="text-ink4 ml-2 text-xs">{c.email}</span>}
                    </button>
                  ))}
                </div>
              )}
              {contactId && contactName && (
                <p className="text-xs text-ink4 mt-1">
                  Selected: <span className="text-ink3 font-medium">{contactName}</span>
                  {isDraft && (
                    <button
                      type="button"
                      onClick={() => {
                        setContactId(null)
                        setContactName('')
                        setContactSearch('')
                      }}
                      className="ml-2 text-red-400 hover:text-red-600"
                    >
                      ×
                    </button>
                  )}
                </p>
              )}
            </div>
          </div>

          {/* Line items */}
          <div className="bg-white rounded-xl border border-border-brand">
            <div className="px-6 pt-5 pb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-ink">Line Items</h2>
              {isDraft && (
                <div className="flex gap-2">
                  {/* Import from Catalog — placeholder (services endpoint exists but requires CPQ module) */}
                  <button
                    type="button"
                    disabled
                    title="Import from Catalog (CPQ module required)"
                    className="text-xs text-ink4 border border-border-brand rounded-md px-2.5 py-1 opacity-50 cursor-not-allowed"
                  >
                    Import from Catalog
                  </button>
                  <button
                    type="button"
                    onClick={addLineItem}
                    className="text-xs text-teal-600 hover:text-teal-700 border border-teal-200 rounded-md px-2.5 py-1 font-medium"
                  >
                    + Add Line Item
                  </button>
                </div>
              )}
            </div>

            <table className="w-full">
              <thead>
                <tr className="border-y border-border-brand bg-bg/40">
                  <th className="text-left text-xs font-medium text-ink4 px-4 py-2.5">
                    Description
                  </th>
                  <th className="text-right text-xs font-medium text-ink4 px-3 py-2.5 w-20">Qty</th>
                  <th className="text-right text-xs font-medium text-ink4 px-3 py-2.5 w-28">
                    Unit Price
                  </th>
                  <th className="text-right text-xs font-medium text-ink4 px-4 py-2.5 w-24">
                    Amount
                  </th>
                  {isDraft && <th className="w-10 px-2" />}
                </tr>
              </thead>
              <tbody>
                {lineItems.map((item, index) => {
                  const amount = Number(item.quantity) * Number(item.unit_price)
                  return (
                    <tr key={index} className="border-b border-gray-50 last:border-0">
                      <td className="px-4 py-2">
                        {isDraft ? (
                          <input
                            type="text"
                            value={item.description}
                            onChange={(e) => updateLineItem(index, 'description', e.target.value)}
                            placeholder="Item description"
                            className="w-full text-sm text-ink border border-transparent focus:border-border-brand focus:bg-white rounded px-2 py-1 focus:outline-none bg-transparent"
                          />
                        ) : (
                          <span className="text-sm text-ink px-2">{item.description || '—'}</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {isDraft ? (
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={item.quantity}
                            onChange={(e) =>
                              updateLineItem(index, 'quantity', parseFloat(e.target.value) || 0)
                            }
                            className="w-full text-sm text-ink text-right border border-transparent focus:border-border-brand focus:bg-white rounded px-2 py-1 focus:outline-none bg-transparent"
                          />
                        ) : (
                          <span className="text-sm text-ink3">{item.quantity}</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {isDraft ? (
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={item.unit_price}
                            onChange={(e) =>
                              updateLineItem(index, 'unit_price', parseFloat(e.target.value) || 0)
                            }
                            className="w-full text-sm text-ink text-right border border-transparent focus:border-border-brand focus:bg-white rounded px-2 py-1 focus:outline-none bg-transparent"
                          />
                        ) : (
                          <span className="text-sm text-ink3">
                            {formatCurrency(Number(item.unit_price))}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2 text-right text-sm font-medium text-ink">
                        {formatCurrency(amount)}
                      </td>
                      {isDraft && (
                        <td className="px-2 py-2 text-center">
                          <button
                            type="button"
                            onClick={() => removeLineItem(index)}
                            className="text-ink4 hover:text-red-500 text-base leading-none w-6 h-6 flex items-center justify-center rounded"
                            title="Remove line item"
                          >
                            ×
                          </button>
                        </td>
                      )}
                    </tr>
                  )
                })}
              </tbody>
            </table>

            {/* Totals */}
            <div className="border-t border-border-brand px-6 py-4">
              <div className="flex justify-end">
                <div className="w-64 space-y-1.5 text-sm">
                  <div className="flex justify-between">
                    <span className="text-ink3">Subtotal</span>
                    <span className="text-ink">{formatCurrency(subtotal)}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-ink3">
                      Tax
                      {isDraft ? (
                        <input
                          type="number"
                          min="0"
                          max="100"
                          step="0.5"
                          value={taxRate}
                          onChange={(e) => setTaxRate(parseFloat(e.target.value) || 0)}
                          className="ml-1 w-12 text-right border border-border-brand rounded px-1 py-0.5 text-xs focus:outline-none focus:ring-1 focus:ring-teal-500"
                        />
                      ) : (
                        <span className="ml-1">({taxRate}%)</span>
                      )}
                      {isDraft && <span className="ml-0.5 text-xs">%</span>}
                    </span>
                    <span className="text-ink">{formatCurrency(taxAmount)}</span>
                  </div>
                  <div className="flex justify-between border-t border-border-brand pt-1.5">
                    <span className="font-semibold text-ink">Total</span>
                    <span className="font-semibold text-teal-600">{formatCurrency(total)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-ink3">Amount Paid</span>
                    <span className="text-green-600">{formatCurrency(amountPaid)}</span>
                  </div>
                  <div className="flex justify-between border-t border-border-brand pt-1.5">
                    <span className="font-bold text-ink">Balance Due</span>
                    <span className="font-bold text-ink">{formatCurrency(balanceDue)}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Notes */}
          <div className="bg-white rounded-xl border border-border-brand p-6">
            <label className="block text-sm font-semibold text-ink mb-2">Notes</label>
            <textarea
              rows={4}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              disabled={!isDraft}
              placeholder="Additional notes for the invoice…"
              className="w-full border border-border-brand rounded-lg px-3 py-2 text-sm text-ink resize-none focus:outline-none focus:ring-2 focus:ring-teal-500 disabled:bg-bg disabled:text-ink4"
            />
          </div>

          {/* Save button */}
          {isDraft && (
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => void handleSave()}
                disabled={saving}
                className="px-5 py-2 bg-teal-600 text-white text-sm font-medium rounded-lg hover:bg-teal-700 disabled:opacity-50 transition-colors"
              >
                {saving ? 'Saving…' : 'Save Changes'}
              </button>
              {error && <span className="text-sm text-red-600">{error}</span>}
            </div>
          )}
        </div>

        {/* ── RIGHT: Actions Panel (1/3) ────────────────────────────────────── */}
        <div className="w-72 flex-shrink-0 space-y-4">
          {/* Action errors */}
          {actionError && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-sm text-red-700">
              {actionError}
            </div>
          )}

          {/* Send Invoice */}
          {isDraft && (
            <div className="bg-white rounded-xl border border-border-brand p-4">
              <h3 className="text-sm font-semibold text-ink mb-3">Send Invoice</h3>
              <button
                type="button"
                onClick={() => void handleSend()}
                disabled={acting}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
              >
                <span>✉</span>
                {acting ? 'Sending…' : 'Send Invoice'}
              </button>
              <p className="text-xs text-ink4 mt-2">
                Sends an email to the contact and marks the invoice as sent.
              </p>
            </div>
          )}

          {/* Record Payment */}
          {canRecordPayment && (
            <div className="bg-white rounded-xl border border-border-brand p-4">
              <h3 className="text-sm font-semibold text-ink mb-3">Record Payment</h3>
              <div className="space-y-2">
                <div>
                  <label className="block text-xs text-ink4 mb-1">Amount</label>
                  <input
                    type="number"
                    min="0.01"
                    step="0.01"
                    value={payAmount}
                    onChange={(e) => setPayAmount(e.target.value)}
                    placeholder="0.00"
                    className="w-full border border-border-brand rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
                  />
                </div>
                <div>
                  <label className="block text-xs text-ink4 mb-1">Method</label>
                  <select
                    value={payMethod}
                    onChange={(e) => setPayMethod(e.target.value)}
                    className="w-full border border-border-brand rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 bg-white"
                  >
                    {PAYMENT_METHODS.map((m) => (
                      <option key={m} value={m}>
                        {m.charAt(0).toUpperCase() + m.slice(1)}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-ink4 mb-1">Notes</label>
                  <input
                    type="text"
                    value={payNotes}
                    onChange={(e) => setPayNotes(e.target.value)}
                    placeholder="Optional note…"
                    className="w-full border border-border-brand rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => void handleRecordPayment()}
                  disabled={acting}
                  className="w-full px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 disabled:opacity-50 transition-colors"
                >
                  {acting ? 'Recording…' : 'Record Payment'}
                </button>
              </div>
            </div>
          )}

          {/* Void Invoice */}
          {canVoid && (
            <div className="bg-white rounded-xl border border-border-brand p-4">
              <h3 className="text-sm font-semibold text-ink mb-3">Danger Zone</h3>
              <button
                type="button"
                onClick={() => void handleVoid()}
                disabled={acting}
                className="w-full px-4 py-2 bg-red-50 text-red-600 border border-red-200 text-sm font-medium rounded-lg hover:bg-red-100 disabled:opacity-50 transition-colors"
              >
                {acting ? 'Voiding…' : 'Void Invoice'}
              </button>
              <p className="text-xs text-ink4 mt-2">This action cannot be undone.</p>
            </div>
          )}

          {/* Download PDF */}
          <div className="bg-white rounded-xl border border-border-brand p-4">
            <h3 className="text-sm font-semibold text-ink mb-3">Download</h3>
            <a
              href={`/api/invoices/${id}/pdf`}
              target="_blank"
              rel="noopener noreferrer"
              className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-gray-50 text-ink2 border border-border-brand text-sm font-medium rounded-lg hover:bg-gray-100 transition-colors"
            >
              <span>⬇</span>
              Download PDF
            </a>
          </div>

          {/* Invoice info */}
          <div className="bg-white rounded-xl border border-border-brand p-4">
            <h3 className="text-sm font-semibold text-ink mb-3">Invoice Info</h3>
            <div className="space-y-2 text-xs text-ink3">
              <div>
                <span className="text-ink4">Created</span>
                <p className="text-ink2 mt-0.5">{formatDate(invoice.created_at)}</p>
              </div>
              {invoice.sent_at && (
                <div>
                  <span className="text-ink4">Sent</span>
                  <p className="text-ink2 mt-0.5">{formatDate(invoice.sent_at)}</p>
                </div>
              )}
              {invoice.paid_at && (
                <div>
                  <span className="text-ink4 text-green-600">Paid</span>
                  <p className="text-green-600 mt-0.5">{formatDate(invoice.paid_at)}</p>
                </div>
              )}
              {invoice.contacts && (
                <div>
                  <span className="text-ink4">Contact</span>
                  <p className="text-ink2 mt-0.5 font-medium">{invoice.contacts.full_name}</p>
                  {invoice.contacts.email && (
                    <p className="text-ink4 mt-0.5">{invoice.contacts.email}</p>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
