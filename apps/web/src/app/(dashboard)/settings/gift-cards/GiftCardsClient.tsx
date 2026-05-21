'use client'

import { useState, useEffect } from 'react'

// ── Types ──────────────────────────────────────────────────────────────────────

interface GiftCard {
  id: string
  code: string
  amount_cents: number
  balance_cents: number
  status: 'active' | 'redeemed' | 'expired' | 'cancelled'
  recipient_name: string | null
  recipient_email: string | null
  expires_at: string | null
  created_at: string
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function formatDollars(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '—'
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

// ── Status badge ──────────────────────────────────────────────────────────────

const STATUS_BADGE: Record<
  GiftCard['status'],
  { bg: string; text: string; label: string }
> = {
  active: { bg: 'bg-green-100', text: 'text-green-700', label: 'Active' },
  redeemed: { bg: 'bg-gray-100', text: 'text-gray-500', label: 'Redeemed' },
  expired: { bg: 'bg-red-100', text: 'text-red-700', label: 'Expired' },
  cancelled: { bg: 'bg-red-100', text: 'text-red-700', label: 'Cancelled' },
}

function StatusBadge({ status }: { status: GiftCard['status'] }) {
  const cfg = STATUS_BADGE[status] ?? STATUS_BADGE.cancelled
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${cfg.bg} ${cfg.text}`}
    >
      {cfg.label}
    </span>
  )
}

// ── Redeem Modal ──────────────────────────────────────────────────────────────

interface RedeemModalProps {
  onClose: () => void
  onSuccess: () => void
  apiUrl: string
  prefillCode?: string
}

function RedeemModal({ onClose, onSuccess, apiUrl, prefillCode }: RedeemModalProps) {
  const [code, setCode] = useState(prefillCode ?? '')
  const [amountDollars, setAmountDollars] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<{ new_balance_cents: number } | null>(null)

  async function handleRedeem() {
    setError(null)
    const dollars = parseFloat(amountDollars)
    if (!code.trim()) { setError('Gift card code is required'); return }
    if (!dollars || dollars <= 0) { setError('Redemption amount must be greater than $0'); return }
    const amount_cents = Math.round(dollars * 100)
    setLoading(true)
    try {
      const res = await fetch(`${apiUrl}/api/gift-cards/redeem`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: code.trim().toUpperCase(), amount_cents }),
      })
      const json = await res.json() as { success?: boolean; new_balance_cents?: number; error?: string; balance_cents?: number }
      if (!res.ok) {
        const msg = json.error ?? 'Redemption failed'
        const balance = json.balance_cents != null ? ` (balance: ${formatDollars(json.balance_cents)})` : ''
        setError(msg + balance)
      } else {
        setResult({ new_balance_cents: json.new_balance_cents ?? 0 })
      }
    } catch {
      setError('Network error — please try again')
    } finally {
      setLoading(false)
    }
  }

  if (result) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
        <div className="bg-white rounded-xl border border-border-brand shadow-xl w-full max-w-sm mx-4 p-6 text-center">
          <div className="flex items-center justify-center w-12 h-12 rounded-full bg-green-100 mx-auto mb-4">
            <svg className="w-6 h-6 text-green-600" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
            </svg>
          </div>
          <h3 className="text-base font-semibold text-ink mb-1">Redeemed successfully</h3>
          <p className="text-sm text-ink3">
            Remaining balance:{' '}
            <span className="font-semibold text-ink">{formatDollars(result.new_balance_cents)}</span>
          </p>
          <button
            onClick={() => { onSuccess(); onClose() }}
            className="mt-5 w-full rounded-lg bg-teal-600 px-4 py-2 text-sm font-medium text-white hover:bg-teal-700"
          >
            Done
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl border border-border-brand shadow-xl w-full max-w-sm mx-4">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border-brand">
          <h2 className="text-sm font-semibold text-ink">Redeem Gift Card</h2>
          <button onClick={onClose} className="text-ink4 hover:text-ink">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="px-5 py-5 space-y-4">
          <div>
            <label className="block text-xs font-medium text-ink3 mb-1">Gift Card Code</label>
            <input
              type="text"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="e.g. GC-ABCD1234"
              className="w-full rounded-lg border border-border-brand bg-white px-3 py-2 text-sm font-mono text-ink placeholder-ink4 focus:outline-none focus:ring-2 focus:ring-teal-500"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-ink3 mb-1">Redemption Amount ($)</label>
            <input
              type="number"
              min="0.01"
              step="0.01"
              value={amountDollars}
              onChange={(e) => setAmountDollars(e.target.value)}
              placeholder="0.00"
              className="w-full rounded-lg border border-border-brand bg-white px-3 py-2 text-sm text-ink placeholder-ink4 focus:outline-none focus:ring-2 focus:ring-teal-500"
            />
          </div>
          {error && (
            <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              {error}
            </p>
          )}
        </div>
        <div className="flex justify-end gap-2 px-5 py-4 border-t border-border-brand">
          <button
            onClick={onClose}
            className="rounded-lg border border-border-brand px-3 py-2 text-sm font-medium text-ink3 hover:text-ink"
          >
            Cancel
          </button>
          <button
            onClick={() => void handleRedeem()}
            disabled={loading}
            className="rounded-lg bg-teal-600 px-4 py-2 text-sm font-medium text-white hover:bg-teal-700 disabled:opacity-60"
          >
            {loading ? 'Redeeming…' : 'Redeem'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Issue Form ────────────────────────────────────────────────────────────────

interface IssueFormProps {
  apiUrl: string
  onSuccess: () => void
  onCancel: () => void
}

function IssueForm({ apiUrl, onSuccess, onCancel }: IssueFormProps) {
  const [amountDollars, setAmountDollars] = useState('')
  const [recipientName, setRecipientName] = useState('')
  const [recipientEmail, setRecipientEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit() {
    setError(null)
    const dollars = parseFloat(amountDollars)
    if (!dollars || dollars <= 0) { setError('Amount must be greater than $0'); return }
    const amount_cents = Math.round(dollars * 100)
    setLoading(true)
    try {
      const res = await fetch(`${apiUrl}/api/gift-cards`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount_cents,
          recipient_name: recipientName.trim() || undefined,
          recipient_email: recipientEmail.trim() || undefined,
        }),
      })
      const json = await res.json() as { error?: string }
      if (!res.ok) {
        setError(json.error ?? 'Failed to issue gift card')
      } else {
        onSuccess()
      }
    } catch {
      setError('Network error — please try again')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="bg-white rounded-xl border border-border-brand mt-4">
      <div className="px-5 py-4 border-b border-border-brand">
        <h2 className="text-sm font-semibold text-ink">Issue New Gift Card</h2>
      </div>
      <div className="px-5 py-5 grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div>
          <label className="block text-xs font-medium text-ink3 mb-1">Amount ($) <span className="text-red-500">*</span></label>
          <input
            type="number"
            min="0.01"
            step="0.01"
            value={amountDollars}
            onChange={(e) => setAmountDollars(e.target.value)}
            placeholder="0.00"
            className="w-full rounded-lg border border-border-brand bg-white px-3 py-2 text-sm text-ink placeholder-ink4 focus:outline-none focus:ring-2 focus:ring-teal-500"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-ink3 mb-1">Recipient Name</label>
          <input
            type="text"
            value={recipientName}
            onChange={(e) => setRecipientName(e.target.value)}
            placeholder="Jane Smith"
            className="w-full rounded-lg border border-border-brand bg-white px-3 py-2 text-sm text-ink placeholder-ink4 focus:outline-none focus:ring-2 focus:ring-teal-500"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-ink3 mb-1">Recipient Email</label>
          <input
            type="email"
            value={recipientEmail}
            onChange={(e) => setRecipientEmail(e.target.value)}
            placeholder="jane@example.com"
            className="w-full rounded-lg border border-border-brand bg-white px-3 py-2 text-sm text-ink placeholder-ink4 focus:outline-none focus:ring-2 focus:ring-teal-500"
          />
        </div>
      </div>
      {error && (
        <div className="mx-5 mb-4 text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          {error}
        </div>
      )}
      <div className="flex justify-end gap-2 px-5 py-4 border-t border-border-brand">
        <button
          onClick={onCancel}
          className="rounded-lg border border-border-brand px-3 py-2 text-sm font-medium text-ink3 hover:text-ink"
        >
          Cancel
        </button>
        <button
          onClick={() => void handleSubmit()}
          disabled={loading}
          className="rounded-lg bg-teal-600 px-4 py-2 text-sm font-medium text-white hover:bg-teal-700 disabled:opacity-60"
        >
          {loading ? 'Issuing…' : 'Issue Gift Card'}
        </button>
      </div>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? ''

export default function GiftCardsClient() {
  const [giftCards, setGiftCards] = useState<GiftCard[]>([])
  const [loading, setLoading] = useState(true)
  const [showIssueForm, setShowIssueForm] = useState(false)
  const [redeemCode, setRedeemCode] = useState<string | null>(null)
  const [toast, setToast] = useState<{ type: 'success' | 'error'; msg: string } | null>(null)

  function showToast(type: 'success' | 'error', msg: string) {
    setToast({ type, msg })
    setTimeout(() => setToast(null), 3500)
  }

  async function fetchCards() {
    setLoading(true)
    try {
      const res = await fetch(`${API_URL}/api/gift-cards`)
      if (res.ok) {
        const json = await res.json() as { gift_cards: GiftCard[] }
        setGiftCards(json.gift_cards)
      }
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void fetchCards()
  }, [])

  function handleIssueSuccess() {
    setShowIssueForm(false)
    showToast('success', 'Gift card issued successfully')
    void fetchCards()
  }

  function handleRedeemSuccess() {
    showToast('success', 'Gift card redeemed successfully')
    void fetchCards()
  }

  return (
    <div className="px-8 py-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-ink">Gift Cards</h1>
          <p className="text-sm text-ink3 mt-0.5">Issue and manage gift cards for your customers.</p>
        </div>
        {!showIssueForm && (
          <button
            onClick={() => setShowIssueForm(true)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-teal-600 px-4 py-2 text-sm font-medium text-white hover:bg-teal-700"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            Issue Gift Card
          </button>
        )}
      </div>

      {/* Issue form */}
      {showIssueForm && (
        <IssueForm
          apiUrl={API_URL}
          onSuccess={handleIssueSuccess}
          onCancel={() => setShowIssueForm(false)}
        />
      )}

      {/* Table */}
      <div className="bg-white rounded-xl border border-border-brand mt-4 overflow-hidden">
        {loading ? (
          <div className="px-5 py-10 text-center text-sm text-ink4">Loading…</div>
        ) : giftCards.length === 0 ? (
          <div className="px-5 py-14 text-center">
            <svg
              className="mx-auto mb-3 w-10 h-10 text-ink4"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={1.5}
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M21 11.25v8.25a1.5 1.5 0 01-1.5 1.5H5.25a1.5 1.5 0 01-1.5-1.5v-8.25M12 4.875A2.625 2.625 0 1 0 9.375 7.5H12m0-2.625V7.5m0-2.625A2.625 2.625 0 1 1 14.625 7.5H12m0 0V21m-8.625-9.75h18c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125h-18c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z"
              />
            </svg>
            <p className="text-sm font-medium text-ink">No gift cards issued yet.</p>
            <p className="text-xs text-ink4 mt-1">Click "Issue Gift Card" to get started.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-border-brand bg-bg3/40">
                  <th className="px-4 py-3 text-left text-xs font-medium text-ink3 uppercase tracking-wide">
                    Code
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-ink3 uppercase tracking-wide">
                    Amount
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-ink3 uppercase tracking-wide">
                    Balance
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-ink3 uppercase tracking-wide">
                    Recipient
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-ink3 uppercase tracking-wide">
                    Status
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-ink3 uppercase tracking-wide">
                    Expires
                  </th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border-brand">
                {giftCards.map((card) => (
                  <tr key={card.id} className="hover:bg-bg3/30 transition-colors">
                    <td className="px-4 py-3">
                      <span className="font-mono text-xs font-semibold text-ink tracking-wide">
                        {card.code}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-ink">
                      {formatDollars(card.amount_cents)}
                    </td>
                    <td className="px-4 py-3 text-sm text-ink">
                      {formatDollars(card.balance_cents)}
                    </td>
                    <td className="px-4 py-3">
                      {card.recipient_name || card.recipient_email ? (
                        <div>
                          {card.recipient_name && (
                            <p className="text-sm text-ink">{card.recipient_name}</p>
                          )}
                          {card.recipient_email && (
                            <p className="text-xs text-ink4">{card.recipient_email}</p>
                          )}
                        </div>
                      ) : (
                        <span className="text-sm text-ink4">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={card.status} />
                    </td>
                    <td className="px-4 py-3 text-sm text-ink3">
                      {formatDate(card.expires_at)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {card.status === 'active' && (
                        <button
                          onClick={() => setRedeemCode(card.code)}
                          className="text-xs font-medium text-teal-600 hover:text-teal-700 hover:underline"
                        >
                          Redeem
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Redeem modal */}
      {redeemCode !== null && (
        <RedeemModal
          apiUrl={API_URL}
          prefillCode={redeemCode}
          onClose={() => setRedeemCode(null)}
          onSuccess={handleRedeemSuccess}
        />
      )}

      {/* Toast */}
      {toast && (
        <div
          className={`fixed top-4 right-4 z-[60] px-4 py-2 text-sm rounded-lg shadow-lg ${
            toast.type === 'success'
              ? 'bg-teal-600 text-white'
              : 'bg-red-50 text-red-700 border border-red-200'
          }`}
        >
          {toast.msg}
        </div>
      )}
    </div>
  )
}
