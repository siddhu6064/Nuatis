'use client'

import { useState } from 'react'

interface Payment {
  id: string
  amount: number
  method: string
  reference: string | null
  notes: string | null
  recorded_at: string
}

interface Props {
  quoteId: string
  quoteTotal: number
  initialPayments: Payment[]
  initialPaymentStatus: string | null
}

const METHOD_ICONS: Record<string, string> = {
  cash: '💵',
  check: '📋',
  stripe: '💳',
  other: '📝',
}

const METHOD_PLACEHOLDER: Record<string, string> = {
  cash: 'e.g. received in person',
  check: 'Check #1234',
  stripe: 'Transaction ID',
  other: 'Reference or notes',
}

function calcSummary(payments: Payment[], total: number) {
  const totalPaid = payments.reduce((s, p) => s + Number(p.amount), 0)
  const balanceDue = Math.max(0, total - totalPaid)
  let status = 'unpaid'
  if (totalPaid >= total) status = 'paid'
  else if (totalPaid > 0) status = 'partial'
  return { totalPaid, balanceDue, status }
}

const BADGE_COLORS: Record<string, string> = {
  paid: 'bg-green-50 text-green-700',
  partial: 'bg-amber-50 text-amber-700',
  unpaid: 'bg-rose-50 text-rose-600',
}

const BALANCE_COLORS: Record<string, string> = {
  paid: 'text-green-600',
  partial: 'text-amber-600',
  unpaid: 'text-rose-600',
}

export default function QuotePayments({
  quoteId,
  quoteTotal,
  initialPayments,
  initialPaymentStatus,
}: Props) {
  const [payments, setPayments] = useState<Payment[]>(initialPayments)
  const [paymentStatus, setPaymentStatus] = useState(initialPaymentStatus ?? 'unpaid')
  const [showModal, setShowModal] = useState(false)
  const [amount, setAmount] = useState('')
  const [method, setMethod] = useState<'cash' | 'check' | 'stripe' | 'other'>('cash')
  const [reference, setReference] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')

  const { totalPaid, balanceDue } = calcSummary(payments, quoteTotal)

  function openModal() {
    setAmount(balanceDue > 0 ? balanceDue.toFixed(2) : '')
    setMethod('cash')
    setReference('')
    setNotes('')
    setFormError('')
    setShowModal(true)
  }

  async function submit() {
    const amt = parseFloat(amount)
    if (isNaN(amt) || amt <= 0) {
      setFormError('Enter a valid amount.')
      return
    }
    setSaving(true)
    setFormError('')
    try {
      const res = await fetch(`/api/quotes/${quoteId}/payments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: amt,
          method,
          reference: reference || null,
          notes: notes || null,
        }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        setFormError((d as { error?: string }).error ?? 'Failed to record payment.')
        return
      }
      const data = (await res.json()) as {
        payment: Payment
        quote: { payment_status: string; total_paid: number; balance_due: number }
      }
      setPayments((prev) => [...prev, data.payment])
      setPaymentStatus(data.quote.payment_status)
      setShowModal(false)
    } catch {
      setFormError('Network error.')
    } finally {
      setSaving(false)
    }
  }

  const badgeLabel =
    paymentStatus === 'paid' ? 'Paid ✓' : paymentStatus === 'partial' ? 'Partial' : 'Unpaid'

  return (
    <div className="bg-white rounded-xl border border-border-brand p-6 mb-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-ink">Payments</h2>
          <span
            className={`text-xs px-2 py-0.5 rounded font-medium ${BADGE_COLORS[paymentStatus] ?? BADGE_COLORS['unpaid']}`}
          >
            {badgeLabel}
          </span>
        </div>
        <button
          onClick={openModal}
          className="text-xs text-teal-600 border border-teal-300 hover:bg-teal-50 px-3 py-1.5 rounded-lg font-medium"
        >
          Record Payment
        </button>
      </div>

      {/* Summary bar */}
      <div className="flex items-center gap-4 text-sm mb-4 flex-wrap">
        <span className="text-ink3">
          Total: <span className="font-medium text-ink">${quoteTotal.toFixed(2)}</span>
        </span>
        <span className="text-ink3">
          Paid: <span className="font-medium text-ink">${totalPaid.toFixed(2)}</span>
        </span>
        <span className="text-ink3">
          Balance:{' '}
          <span
            className={`font-medium ${BALANCE_COLORS[paymentStatus] ?? BALANCE_COLORS['unpaid']}`}
          >
            ${balanceDue.toFixed(2)}
          </span>
        </span>
      </div>

      {/* Payment history */}
      {payments.length > 0 ? (
        <div className="space-y-2">
          {payments.map((p) => (
            <div
              key={p.id}
              className="flex items-start justify-between text-sm border-t border-gray-50 pt-2"
            >
              <div className="flex items-center gap-2">
                <span className="text-base">{METHOD_ICONS[p.method] ?? '📝'}</span>
                <div>
                  <span className="font-medium text-ink capitalize">{p.method}</span>
                  {p.reference && <span className="text-ink4 ml-1">· {p.reference}</span>}
                  {p.notes && <p className="text-xs text-ink4 mt-0.5">{p.notes}</p>}
                </div>
              </div>
              <div className="text-right shrink-0 ml-4">
                <p className="font-medium text-ink">${Number(p.amount).toFixed(2)}</p>
                <p className="text-xs text-ink4">
                  {new Date(p.recorded_at).toLocaleDateString('en-US', {
                    month: 'short',
                    day: 'numeric',
                    year: 'numeric',
                  })}
                </p>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-xs text-ink4">No payments recorded yet.</p>
      )}

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl p-6 w-full max-w-sm shadow-xl">
            <h3 className="text-sm font-semibold text-ink mb-4">Record Payment</h3>

            <div className="space-y-4">
              <div>
                <label className="text-xs font-medium text-ink3 block mb-1">Amount</label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-ink3 text-sm">
                    $
                  </span>
                  <input
                    type="number"
                    min="0.01"
                    step="0.01"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    className="w-full pl-7 pr-3 py-2 text-sm border border-border-brand rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500"
                    placeholder="0.00"
                  />
                </div>
              </div>

              <div>
                <label className="text-xs font-medium text-ink3 block mb-2">Method</label>
                <div className="grid grid-cols-2 gap-2">
                  {(['cash', 'check', 'stripe', 'other'] as const).map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setMethod(m)}
                      className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm border transition-colors ${
                        method === m
                          ? 'border-teal-500 bg-teal-50 text-teal-700 font-medium'
                          : 'border-border-brand text-ink3 hover:bg-bg'
                      }`}
                    >
                      <span>{METHOD_ICONS[m]}</span>
                      <span className="capitalize">{m}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="text-xs font-medium text-ink3 block mb-1">
                  Reference <span className="text-ink4 font-normal">(optional)</span>
                </label>
                <input
                  type="text"
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                  placeholder={METHOD_PLACEHOLDER[method]}
                  className="w-full px-3 py-2 text-sm border border-border-brand rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500"
                />
              </div>

              <div>
                <label className="text-xs font-medium text-ink3 block mb-1">
                  Notes <span className="text-ink4 font-normal">(optional)</span>
                </label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={2}
                  className="w-full px-3 py-2 text-sm border border-border-brand rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500 resize-none"
                />
              </div>

              {formError && <p className="text-xs text-rose-600">{formError}</p>}
            </div>

            <div className="flex items-center gap-2 justify-end mt-5">
              <button
                onClick={() => setShowModal(false)}
                className="text-xs text-ink3 px-3 py-1.5 rounded-lg hover:bg-bg"
              >
                Cancel
              </button>
              <button
                onClick={submit}
                disabled={saving}
                className="text-xs text-white bg-teal-600 hover:bg-teal-700 px-4 py-1.5 rounded-lg font-medium disabled:opacity-50"
              >
                {saving ? 'Recording...' : 'Record Payment'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
