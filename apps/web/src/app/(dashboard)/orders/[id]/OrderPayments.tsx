'use client'

import { useState } from 'react'
import TextField from '@mui/material/TextField'
import InputAdornment from '@mui/material/InputAdornment'
import Button from '@mui/material/Button'
import { Modal } from '@/components/ui/Modal'

interface Payment {
  id: string
  amount: number
  method: string
  reference: string | null
  notes: string | null
  recorded_at: string
}

interface Props {
  orderId: string
  orderTotal: number
  initialPayments: Payment[]
  initialPaymentStatus: string
  initialAmountPaid: number
}

const METHOD_ICONS: Record<string, string> = {
  cash: '💵',
  card: '💳',
  other: '📝',
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

export default function OrderPayments({
  orderId,
  orderTotal,
  initialPayments,
  initialPaymentStatus,
  initialAmountPaid,
}: Props) {
  const [payments, setPayments] = useState<Payment[]>(initialPayments)
  const [paymentStatus, setPaymentStatus] = useState(initialPaymentStatus)
  const [amountPaid, setAmountPaid] = useState(initialAmountPaid)
  const [showModal, setShowModal] = useState(false)
  const [amount, setAmount] = useState('')
  const [method, setMethod] = useState<'cash' | 'card' | 'other'>('cash')
  const [reference, setReference] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')

  const balanceDue = Math.max(0, orderTotal - amountPaid)

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
      const res = await fetch(`/api/orders/${orderId}/payments`, {
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
        order: { payment_status: string; amount_paid: number }
      }
      setPayments((prev) => [data.payment, ...prev])
      setPaymentStatus(data.order.payment_status)
      setAmountPaid(Number(data.order.amount_paid))
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
        <Button onClick={openModal} variant="contained" size="small">
          Record Payment
        </Button>
      </div>

      <div className="flex items-center gap-4 text-sm mb-4 flex-wrap">
        <span className="text-ink3">
          Total: <span className="font-medium text-ink">${orderTotal.toFixed(2)}</span>
        </span>
        <span className="text-ink3">
          Paid: <span className="font-medium text-ink">${amountPaid.toFixed(2)}</span>
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

      {showModal && (
        <Modal
          onClose={() => setShowModal(false)}
          title="Record Payment"
          maxWidth="xs"
          footer={
            <>
              <Button
                onClick={() => setShowModal(false)}
                variant="text"
                color="inherit"
                size="small"
              >
                Cancel
              </Button>
              <Button
                onClick={() => void submit()}
                disabled={saving}
                variant="contained"
                size="small"
              >
                {saving ? 'Recording...' : 'Record Payment'}
              </Button>
            </>
          }
        >
          <div className="space-y-4">
            <TextField
              label="Amount"
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              fullWidth
              size="small"
              slotProps={{
                htmlInput: { min: '0.01', step: '0.01' },
                input: { startAdornment: <InputAdornment position="start">$</InputAdornment> },
              }}
            />

            <div>
              <label className="text-xs font-medium text-ink3 block mb-2">Method</label>
              <div className="grid grid-cols-3 gap-2">
                {(['cash', 'card', 'other'] as const).map((m) => (
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

            <TextField
              label="Reference (optional)"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              fullWidth
              size="small"
            />

            <TextField
              label="Notes (optional)"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              multiline
              rows={2}
              fullWidth
              size="small"
            />

            {formError && <p className="text-xs text-rose-600">{formError}</p>}
          </div>
        </Modal>
      )}
    </div>
  )
}
