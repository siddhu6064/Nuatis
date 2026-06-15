'use client'

import { useState, useEffect, useCallback } from 'react'
import { formatCurrency } from '@nuatis/shared'

// ── Types ──────────────────────────────────────────────────────────────────────

interface Subscription {
  id: string
  contact_id: string
  name: string
  description: string | null
  amount: number
  currency: string
  interval: string
  interval_count: number
  status: string
  current_period_end: string | null
  cancel_at: string | null
  cancelled_at: string | null
  contacts: { full_name: string } | null
}

interface ContactSuggestion {
  id: string
  full_name: string
  email: string | null
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '—'
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

function intervalLabel(interval: string): string {
  const map: Record<string, string> = {
    weekly: 'Weekly',
    monthly: 'Monthly',
    quarterly: 'Quarterly',
    annually: 'Annually',
  }
  return map[interval] ?? interval
}

function intervalSuffix(interval: string): string {
  const map: Record<string, string> = {
    weekly: 'wk',
    monthly: 'mo',
    quarterly: 'qtr',
    annually: 'yr',
  }
  return map[interval] ?? interval
}

function computeMRR(sub: Subscription): number {
  const amt = Number(sub.amount)
  switch (sub.interval) {
    case 'weekly':
      return (amt * 52) / 12
    case 'monthly':
      return amt
    case 'quarterly':
      return amt / 3
    case 'annually':
      return amt / 12
    default:
      return 0
  }
}

// ── Status badge config ────────────────────────────────────────────────────────

const STATUS_BADGE: Record<string, { bg: string; text: string; label: string }> = {
  active: { bg: 'bg-green-100', text: 'text-green-700', label: 'Active' },
  paused: { bg: 'bg-amber-100', text: 'text-amber-700', label: 'Paused' },
  cancelled: { bg: 'bg-gray-100', text: 'text-gray-500', label: 'Cancelled' },
  past_due: { bg: 'bg-red-100', text: 'text-red-700', label: 'Past Due' },
  incomplete: { bg: 'bg-orange-100', text: 'text-orange-700', label: 'Incomplete' },
}

// ── Cancel Modal ───────────────────────────────────────────────────────────────

interface CancelModalProps {
  subscriptionId: string
  onClose: () => void
  onConfirm: (id: string, immediately: boolean) => Promise<void>
  loading: boolean
}

function CancelModal({ subscriptionId, onClose, onConfirm, loading }: CancelModalProps) {
  const [immediately, setImmediately] = useState(false)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
      <div className="bg-white rounded-xl border border-border-brand shadow-xl w-full max-w-sm mx-4 p-6">
        <h2 className="text-base font-semibold text-ink mb-1">Cancel Subscription</h2>
        <p className="text-sm text-ink3 mb-4">Choose when to cancel this subscription.</p>

        <div className="space-y-2 mb-6">
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="radio"
              name="cancel_mode"
              checked={!immediately}
              onChange={() => setImmediately(false)}
              className="mt-0.5 text-teal-600"
            />
            <div>
              <p className="text-sm font-medium text-ink">Cancel at period end</p>
              <p className="text-xs text-ink4">
                Subscription remains active until the billing period ends.
              </p>
            </div>
          </label>
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="radio"
              name="cancel_mode"
              checked={immediately}
              onChange={() => setImmediately(true)}
              className="mt-0.5 text-teal-600"
            />
            <div>
              <p className="text-sm font-medium text-ink">Cancel immediately</p>
              <p className="text-xs text-ink4">
                Subscription is cancelled right away. No refund is issued.
              </p>
            </div>
          </label>
        </div>

        <div className="flex items-center gap-3 justify-end">
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="px-4 py-2 text-sm text-ink3 hover:text-ink rounded-lg hover:bg-bg transition-colors disabled:opacity-50"
          >
            Keep
          </button>
          <button
            type="button"
            disabled={loading}
            onClick={() => void onConfirm(subscriptionId, immediately)}
            className="px-4 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors disabled:opacity-50"
          >
            {loading ? 'Cancelling…' : 'Confirm Cancel'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── New Subscription Modal ─────────────────────────────────────────────────────

interface NewSubModalProps {
  onClose: () => void
  onCreated: () => void
}

function NewSubscriptionModal({ onClose, onCreated }: NewSubModalProps) {
  const [contactQuery, setContactQuery] = useState('')
  const [contactSuggestions, setContactSuggestions] = useState<ContactSuggestion[]>([])
  const [selectedContact, setSelectedContact] = useState<ContactSuggestion | null>(null)
  const [planName, setPlanName] = useState('')
  const [amount, setAmount] = useState('')
  const [currency] = useState('usd')
  const [interval, setInterval] = useState('monthly')
  const [description, setDescription] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [clientSecret, setClientSecret] = useState<string | null>(null)
  const [searchOpen, setSearchOpen] = useState(false)

  useEffect(() => {
    if (!contactQuery || selectedContact) return
    const t = setTimeout(() => {
      fetch(`/api/contacts?q=${encodeURIComponent(contactQuery)}&limit=8`)
        .then((r) => (r.ok ? r.json() : null))
        .then((d: { contacts?: ContactSuggestion[] } | null) => {
          setContactSuggestions(d?.contacts ?? [])
          setSearchOpen(true)
        })
        .catch(() => {})
    }, 250)
    return () => clearTimeout(t)
  }, [contactQuery, selectedContact])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!selectedContact) {
      setError('Please select a contact.')
      return
    }
    const amtNum = parseFloat(amount)
    if (!amount || isNaN(amtNum) || amtNum <= 0) {
      setError('Amount must be a positive number.')
      return
    }
    if (!planName.trim()) {
      setError('Plan name is required.')
      return
    }

    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/subscriptions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contact_id: selectedContact.id,
          name: planName.trim(),
          amount: amtNum,
          currency,
          interval,
          description: description.trim() || undefined,
        }),
      })
      const data = (await res.json()) as { error?: string; client_secret?: string }
      if (!res.ok) {
        setError(data.error ?? 'Failed to create subscription')
        return
      }
      if (data.client_secret) {
        setClientSecret(data.client_secret)
      } else {
        onCreated()
      }
    } catch {
      setError('Network error. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  if (clientSecret) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
        <div className="bg-white rounded-xl border border-border-brand shadow-xl w-full max-w-sm mx-4 p-6">
          <h2 className="text-base font-semibold text-ink mb-2">Subscription Created</h2>
          <p className="text-sm text-ink3 mb-4">
            Payment is required to activate this subscription. A payment intent has been created.
          </p>
          <div className="bg-bg rounded-lg p-3 mb-4">
            <p className="text-[10px] font-mono text-ink4 break-all">{clientSecret}</p>
          </div>
          <p className="text-xs text-ink4 mb-4">
            Stripe Elements integration will be added in a future step to collect payment.
          </p>
          <button
            type="button"
            onClick={() => {
              onCreated()
            }}
            className="w-full px-4 py-2 text-sm font-medium text-white bg-teal-600 hover:bg-teal-700 rounded-lg transition-colors"
          >
            Done
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
      <div className="bg-white rounded-xl border border-border-brand shadow-xl w-full max-w-md mx-4">
        <div className="px-6 py-5 border-b border-border-brand flex items-center justify-between">
          <h2 className="text-base font-semibold text-ink">New Subscription</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-ink4 hover:text-ink transition-colors text-lg leading-none"
          >
            ×
          </button>
        </div>

        <form onSubmit={(e) => void handleSubmit(e)} className="px-6 py-5 space-y-4">
          {/* Contact search */}
          <div className="relative">
            <label className="block text-xs font-medium text-ink3 mb-1">Contact</label>
            {selectedContact ? (
              <div className="flex items-center gap-2 px-3 py-2 border border-border-brand rounded-lg bg-bg">
                <span className="text-sm text-ink flex-1">{selectedContact.full_name}</span>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedContact(null)
                    setContactQuery('')
                  }}
                  className="text-ink4 hover:text-ink text-sm leading-none"
                >
                  ×
                </button>
              </div>
            ) : (
              <>
                <input
                  type="text"
                  placeholder="Search contacts…"
                  value={contactQuery}
                  onChange={(e) => {
                    setContactQuery(e.target.value)
                    setSelectedContact(null)
                  }}
                  className="w-full px-3 py-2 text-sm border border-border-brand rounded-lg bg-white text-ink placeholder-ink4 focus:outline-none focus:ring-1 focus:ring-teal-500"
                  autoComplete="off"
                />
                {searchOpen && contactSuggestions.length > 0 && (
                  <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-border-brand rounded-lg shadow-lg z-10 max-h-48 overflow-y-auto">
                    {contactSuggestions.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => {
                          setSelectedContact(c)
                          setContactQuery(c.full_name)
                          setSearchOpen(false)
                        }}
                        className="w-full text-left px-3 py-2 text-sm text-ink hover:bg-bg transition-colors"
                      >
                        <span className="font-medium">{c.full_name}</span>
                        {c.email && <span className="text-ink4 ml-2 text-xs">{c.email}</span>}
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>

          {/* Plan name */}
          <div>
            <label className="block text-xs font-medium text-ink3 mb-1">Plan Name</label>
            <input
              type="text"
              placeholder="e.g. Monthly Retainer"
              value={planName}
              onChange={(e) => setPlanName(e.target.value)}
              required
              className="w-full px-3 py-2 text-sm border border-border-brand rounded-lg bg-white text-ink placeholder-ink4 focus:outline-none focus:ring-1 focus:ring-teal-500"
            />
          </div>

          {/* Amount + Interval */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-ink3 mb-1">Amount (USD)</label>
              <input
                type="number"
                step="0.01"
                min="0.01"
                placeholder="0.00"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                required
                className="w-full px-3 py-2 text-sm border border-border-brand rounded-lg bg-white text-ink placeholder-ink4 focus:outline-none focus:ring-1 focus:ring-teal-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-ink3 mb-1">Billing Interval</label>
              <select
                value={interval}
                onChange={(e) => setInterval(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-border-brand rounded-lg bg-white text-ink focus:outline-none focus:ring-1 focus:ring-teal-500"
              >
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
                <option value="quarterly">Quarterly</option>
                <option value="annually">Annually</option>
              </select>
            </div>
          </div>

          {/* Description */}
          <div>
            <label className="block text-xs font-medium text-ink3 mb-1">
              Description (optional)
            </label>
            <textarea
              rows={2}
              placeholder="Additional details…"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-border-brand rounded-lg bg-white text-ink placeholder-ink4 focus:outline-none focus:ring-1 focus:ring-teal-500 resize-none"
            />
          </div>

          {error && <p className="text-xs text-red-600">{error}</p>}

          <div className="flex items-center gap-3 justify-end pt-1">
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className="px-4 py-2 text-sm text-ink3 hover:text-ink rounded-lg hover:bg-bg transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="px-4 py-2 text-sm font-medium text-white bg-teal-600 hover:bg-teal-700 rounded-lg transition-colors disabled:opacity-50"
            >
              {loading ? 'Creating…' : 'Create Subscription'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function SubscriptionsPage() {
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([])
  const [allSubscriptions, setAllSubscriptions] = useState<Subscription[]>([])
  const [loading, setLoading] = useState(true)
  const [totalPages, setTotalPages] = useState(1)
  const [page, setPage] = useState(1)
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [toast, setToast] = useState<{ type: 'success' | 'error'; msg: string } | null>(null)
  const [cancelTarget, setCancelTarget] = useState<string | null>(null)
  const [showNewModal, setShowNewModal] = useState(false)

  function showToast(type: 'success' | 'error', msg: string) {
    setToast({ type, msg })
    setTimeout(() => setToast(null), 4000)
  }

  // Fetch all subscriptions for stats
  const fetchAllSubs = useCallback(() => {
    fetch('/api/subscriptions?limit=200')
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { subscriptions?: Subscription[] } | null) => {
        if (d?.subscriptions) setAllSubscriptions(d.subscriptions)
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    fetchAllSubs()
  }, [fetchAllSubs])

  // Fetch paginated list
  const fetchSubscriptions = useCallback(async (p: number) => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ page: String(p), limit: '20' })
      const res = await fetch(`/api/subscriptions?${params.toString()}`)
      if (!res.ok) throw new Error('Failed to load')
      const data = (await res.json()) as { subscriptions: Subscription[]; pages: number }
      setSubscriptions(data.subscriptions ?? [])
      setTotalPages(data.pages ?? 1)
    } catch {
      showToast('error', 'Failed to load subscriptions')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void fetchSubscriptions(page)
  }, [page, fetchSubscriptions])

  // ── Stats ──────────────────────────────────────────────────────────────────

  const activeCount = allSubscriptions.filter((s) => s.status === 'active').length

  const mrr = allSubscriptions
    .filter((s) => s.status === 'active')
    .reduce((sum, s) => sum + computeMRR(s), 0)

  const arr = mrr * 12

  // ── Actions ────────────────────────────────────────────────────────────────

  async function handlePause(id: string) {
    setActionLoading(id + ':pause')
    try {
      const res = await fetch(`/api/subscriptions/${id}/pause`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
      if (!res.ok) {
        const err = (await res.json()) as { error?: string }
        throw new Error(err.error ?? 'Failed to pause')
      }
      showToast('success', 'Subscription paused')
      void fetchSubscriptions(page)
      fetchAllSubs()
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : 'Failed to pause')
    } finally {
      setActionLoading(null)
    }
  }

  async function handleResume(id: string) {
    setActionLoading(id + ':resume')
    try {
      const res = await fetch(`/api/subscriptions/${id}/resume`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
      if (!res.ok) {
        const err = (await res.json()) as { error?: string }
        throw new Error(err.error ?? 'Failed to resume')
      }
      showToast('success', 'Subscription resumed')
      void fetchSubscriptions(page)
      fetchAllSubs()
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : 'Failed to resume')
    } finally {
      setActionLoading(null)
    }
  }

  async function handleCancelConfirm(id: string, immediately: boolean) {
    setActionLoading(id + ':cancel')
    try {
      const res = await fetch(`/api/subscriptions/${id}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ immediately }),
      })
      if (!res.ok) {
        const err = (await res.json()) as { error?: string }
        throw new Error(err.error ?? 'Failed to cancel')
      }
      showToast(
        'success',
        immediately
          ? 'Subscription cancelled immediately'
          : 'Subscription will cancel at period end'
      )
      setCancelTarget(null)
      void fetchSubscriptions(page)
      fetchAllSubs()
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : 'Failed to cancel')
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

      {/* Cancel modal */}
      {cancelTarget && (
        <CancelModal
          subscriptionId={cancelTarget}
          onClose={() => setCancelTarget(null)}
          onConfirm={handleCancelConfirm}
          loading={actionLoading === cancelTarget + ':cancel'}
        />
      )}

      {/* New subscription modal */}
      {showNewModal && (
        <NewSubscriptionModal
          onClose={() => setShowNewModal(false)}
          onCreated={() => {
            setShowNewModal(false)
            showToast('success', 'Subscription created')
            void fetchSubscriptions(page)
            fetchAllSubs()
          }}
        />
      )}

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-ink">Subscriptions</h1>
          <p className="text-sm text-ink3 mt-0.5">{subscriptions.length} shown</p>
        </div>
        <button
          type="button"
          onClick={() => setShowNewModal(true)}
          className="flex items-center gap-2 px-4 py-2 bg-teal-600 text-white text-sm font-medium rounded-lg hover:bg-teal-700 transition-colors"
        >
          <span className="text-base leading-none">+</span>
          New Subscription
        </button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="bg-white rounded-xl border border-border-brand px-5 py-4">
          <p className="text-xs text-ink4 font-medium uppercase tracking-wide mb-1">
            Active Subscriptions
          </p>
          <p className="text-2xl font-bold text-ink">{activeCount}</p>
          <p className="text-xs text-ink4 mt-0.5">currently active</p>
        </div>
        <div className="bg-white rounded-xl border border-border-brand px-5 py-4">
          <p className="text-xs text-ink4 font-medium uppercase tracking-wide mb-1">MRR</p>
          <p className="text-2xl font-bold text-teal-600">{formatCurrency(mrr)}</p>
          <p className="text-xs text-ink4 mt-0.5">monthly recurring revenue</p>
        </div>
        <div className="bg-white rounded-xl border border-border-brand px-5 py-4">
          <p className="text-xs text-ink4 font-medium uppercase tracking-wide mb-1">ARR</p>
          <p className="text-2xl font-bold text-green-600">{formatCurrency(arr)}</p>
          <p className="text-xs text-ink4 mt-0.5">annual run rate</p>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-border-brand">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="w-5 h-5 border-2 border-teal-600 border-t-transparent rounded-full animate-spin" />
            <span className="ml-2 text-sm text-ink4">Loading…</span>
          </div>
        ) : subscriptions.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="w-10 h-10 rounded-full bg-bg flex items-center justify-center mb-3">
              <span className="text-gray-300 text-xl">↻</span>
            </div>
            <p className="text-sm font-medium text-ink4">No subscriptions</p>
            <p className="text-xs text-gray-300 mt-1">
              Create your first subscription to start recurring billing
            </p>
            <button
              type="button"
              onClick={() => setShowNewModal(true)}
              className="mt-4 text-xs text-teal-600 font-medium hover:text-teal-700"
            >
              New Subscription &rarr;
            </button>
          </div>
        ) : (
          <>
            <table className="w-full">
              <thead>
                <tr className="border-b border-border-brand">
                  <th className="text-left text-xs font-medium text-ink4 px-6 py-3">Contact</th>
                  <th className="text-left text-xs font-medium text-ink4 px-6 py-3">Plan Name</th>
                  <th className="text-right text-xs font-medium text-ink4 px-6 py-3">Amount</th>
                  <th className="text-left text-xs font-medium text-ink4 px-6 py-3">Interval</th>
                  <th className="text-left text-xs font-medium text-ink4 px-6 py-3">Status</th>
                  <th className="text-left text-xs font-medium text-ink4 px-6 py-3">
                    Next Billing
                  </th>
                  <th className="text-left text-xs font-medium text-ink4 px-6 py-3">Actions</th>
                </tr>
              </thead>
              <tbody>
                {subscriptions.map((sub) => {
                  const badge = STATUS_BADGE[sub.status] ?? STATUS_BADGE['active']!
                  const isPauseLoading = actionLoading === sub.id + ':pause'
                  const isResumeLoading = actionLoading === sub.id + ':resume'

                  return (
                    <tr
                      key={sub.id}
                      className="border-b border-gray-50 last:border-0 hover:bg-gray-50/50"
                    >
                      {/* Contact */}
                      <td className="px-6 py-4 text-sm text-ink2">
                        {sub.contacts?.full_name ?? '—'}
                      </td>

                      {/* Plan Name */}
                      <td className="px-6 py-4 text-sm font-medium text-ink">{sub.name}</td>

                      {/* Amount */}
                      <td className="px-6 py-4 text-sm font-medium text-ink text-right">
                        {formatCurrency(Number(sub.amount))} / {intervalSuffix(sub.interval)}
                      </td>

                      {/* Interval */}
                      <td className="px-6 py-4 text-sm text-ink4">{intervalLabel(sub.interval)}</td>

                      {/* Status */}
                      <td className="px-6 py-4">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${badge.bg} ${badge.text}`}
                        >
                          {badge.label}
                        </span>
                      </td>

                      {/* Next Billing */}
                      <td className="px-6 py-4 text-sm text-ink4">
                        {formatDate(sub.current_period_end)}
                      </td>

                      {/* Actions */}
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-2">
                          {/* Pause — active only */}
                          {sub.status === 'active' && (
                            <button
                              type="button"
                              disabled={isPauseLoading}
                              onClick={() => void handlePause(sub.id)}
                              className="text-xs text-amber-600 hover:text-amber-700 font-medium disabled:opacity-50"
                            >
                              {isPauseLoading ? 'Pausing…' : 'Pause'}
                            </button>
                          )}

                          {/* Resume — paused only */}
                          {sub.status === 'paused' && (
                            <button
                              type="button"
                              disabled={isResumeLoading}
                              onClick={() => void handleResume(sub.id)}
                              className="text-xs text-green-600 hover:text-green-700 font-medium disabled:opacity-50"
                            >
                              {isResumeLoading ? 'Resuming…' : 'Resume'}
                            </button>
                          )}

                          {/* Cancel — not cancelled */}
                          {sub.status !== 'cancelled' && (
                            <button
                              type="button"
                              onClick={() => setCancelTarget(sub.id)}
                              className="text-xs text-red-500 hover:text-red-600 font-medium"
                            >
                              Cancel
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
