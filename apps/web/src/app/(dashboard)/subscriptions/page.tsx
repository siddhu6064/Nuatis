'use client'

import { useState, useEffect, useCallback } from 'react'
import { formatCurrency } from '@nuatis/shared'
import Radio from '@mui/material/Radio'
import RadioGroup from '@mui/material/RadioGroup'
import FormControlLabel from '@mui/material/FormControlLabel'
import Button from '@mui/material/Button'
import IconButton from '@mui/material/IconButton'
import TextField from '@mui/material/TextField'
import MenuItem from '@mui/material/MenuItem'
import MenuList from '@mui/material/MenuList'
import { Modal } from '@/components/ui/Modal'
import { bucketAmountsByDay, sumTrend, MiniSparkline } from '@/lib/sparkline'

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
  created_at: string
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
    <Modal
      onClose={onClose}
      title="Cancel Subscription"
      maxWidth="xs"
      footer={
        <>
          <Button onClick={onClose} disabled={loading} variant="text" color="inherit">
            Keep
          </Button>
          {/* color="error" (theme red) replaces the original's one-off bg-red-600 —
              same intent, now the app-wide semantic danger color. */}
          <Button
            onClick={() => void onConfirm(subscriptionId, immediately)}
            disabled={loading}
            variant="contained"
            color="error"
          >
            {loading ? 'Cancelling…' : 'Confirm Cancel'}
          </Button>
        </>
      }
    >
      <p className="text-sm text-ink3 mb-4">Choose when to cancel this subscription.</p>

      <RadioGroup
        value={immediately ? 'immediately' : 'period_end'}
        onChange={(e) => setImmediately(e.target.value === 'immediately')}
      >
        <FormControlLabel
          value="period_end"
          control={<Radio size="small" />}
          sx={{ alignItems: 'flex-start', mb: 1 }}
          label={
            <div>
              <p className="text-sm font-medium text-ink">Cancel at period end</p>
              <p className="text-xs text-ink4">
                Subscription remains active until the billing period ends.
              </p>
            </div>
          }
        />
        <FormControlLabel
          value="immediately"
          control={<Radio size="small" />}
          sx={{ alignItems: 'flex-start' }}
          label={
            <div>
              <p className="text-sm font-medium text-ink">Cancel immediately</p>
              <p className="text-xs text-ink4">
                Subscription is cancelled right away. No refund is issued.
              </p>
            </div>
          }
        />
      </RadioGroup>
    </Modal>
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
      <Modal
        onClose={onCreated}
        title="Subscription Created"
        maxWidth="xs"
        footer={
          <Button onClick={onCreated} variant="contained" fullWidth>
            Done
          </Button>
        }
      >
        <p className="text-sm text-ink3 mb-4">
          Payment is required to activate this subscription. A payment intent has been created.
        </p>
        <div className="bg-bg rounded-lg p-3 mb-4">
          <p className="text-[10px] font-mono text-ink4 break-all">{clientSecret}</p>
        </div>
        <p className="text-xs text-ink4">
          Stripe Elements integration will be added in a future step to collect payment.
        </p>
      </Modal>
    )
  }

  return (
    <Modal
      onClose={onClose}
      title="New Subscription"
      maxWidth="sm"
      footer={
        <>
          <Button onClick={onClose} disabled={loading} variant="text" color="inherit">
            Cancel
          </Button>
          <Button type="submit" form="new-subscription-form" disabled={loading} variant="contained">
            {loading ? 'Creating…' : 'Create Subscription'}
          </Button>
        </>
      }
    >
      <form onSubmit={(e) => void handleSubmit(e)} id="new-subscription-form" className="space-y-4">
        {/* Contact search */}
        <div className="relative">
          <label className="block text-xs font-medium text-ink3 mb-1">Contact</label>
          {selectedContact ? (
            <div className="flex items-center gap-2 px-3 py-2 border border-border-brand rounded-lg bg-bg">
              <span className="text-sm text-ink flex-1">{selectedContact.full_name}</span>
              <IconButton
                onClick={() => {
                  setSelectedContact(null)
                  setContactQuery('')
                }}
                size="small"
                aria-label="Clear selected contact"
              >
                <span className="text-ink4 text-sm leading-none">&times;</span>
              </IconButton>
            </div>
          ) : (
            <>
              <TextField
                placeholder="Search contacts…"
                value={contactQuery}
                onChange={(e) => {
                  setContactQuery(e.target.value)
                  setSelectedContact(null)
                }}
                autoComplete="off"
                fullWidth
                size="small"
              />
              {searchOpen && contactSuggestions.length > 0 && (
                <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-border-brand rounded-lg shadow-lg z-10 max-h-48 overflow-y-auto">
                  <MenuList disablePadding>
                    {contactSuggestions.map((c) => (
                      <MenuItem
                        key={c.id}
                        onClick={() => {
                          setSelectedContact(c)
                          setContactQuery(c.full_name)
                          setSearchOpen(false)
                        }}
                        sx={{ fontSize: 14, py: 1, px: 1.5, whiteSpace: 'normal' }}
                      >
                        <span className="font-medium">{c.full_name}</span>
                        {c.email && <span className="text-ink4 ml-2 text-xs">{c.email}</span>}
                      </MenuItem>
                    ))}
                  </MenuList>
                </div>
              )}
            </>
          )}
        </div>

        {/* Plan name */}
        <TextField
          label="Plan Name"
          placeholder="e.g. Monthly Retainer"
          value={planName}
          onChange={(e) => setPlanName(e.target.value)}
          required
          fullWidth
          size="small"
        />

        {/* Amount + Interval */}
        <div className="grid grid-cols-2 gap-3">
          <TextField
            label="Amount (USD)"
            type="number"
            slotProps={{ htmlInput: { step: '0.01', min: '0.01' } }}
            placeholder="0.00"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            required
            fullWidth
            size="small"
          />
          <TextField
            select
            label="Billing Interval"
            value={interval}
            onChange={(e) => setInterval(e.target.value)}
            fullWidth
            size="small"
          >
            <MenuItem value="weekly">Weekly</MenuItem>
            <MenuItem value="monthly">Monthly</MenuItem>
            <MenuItem value="quarterly">Quarterly</MenuItem>
            <MenuItem value="annually">Annually</MenuItem>
          </TextField>
        </div>

        {/* Description */}
        <TextField
          label="Description (optional)"
          placeholder="Additional details…"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          multiline
          rows={2}
          fullWidth
          size="small"
        />

        {error && <p className="text-xs text-red-600">{error}</p>}
      </form>
    </Modal>
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

  // 7-day sparklines — real created_at timestamps from the already-fetched
  // subscription list, no fabricated trend data.
  const newSubsTrend = bucketAmountsByDay(
    allSubscriptions.map((s) => ({ date: s.created_at, amount: 1 }))
  )
  const newMrrTrend = bucketAmountsByDay(
    allSubscriptions
      .filter((s) => s.status === 'active')
      .map((s) => ({ date: s.created_at, amount: computeMRR(s) }))
  )
  const newSubsThisWeek = sumTrend(newSubsTrend)
  const newMrrThisWeek = sumTrend(newMrrTrend)

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
        <Button onClick={() => setShowNewModal(true)} variant="contained">
          + New Subscription
        </Button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="bg-white rounded-xl border border-border-brand px-5 py-4 transition-shadow hover:shadow-md">
          <p className="text-xs text-ink4 font-medium uppercase tracking-wide mb-1">
            Active Subscriptions
          </p>
          <div className="flex items-end justify-between gap-2">
            <p className="text-2xl font-bold text-ink">{activeCount}</p>
            <MiniSparkline trend={newSubsTrend} color="#1b1d1f" />
          </div>
          <p className="text-xs text-ink4 mt-0.5">
            {newSubsThisWeek > 0
              ? `+${newSubsThisWeek} new this week`
              : 'No new subscriptions this week'}
          </p>
        </div>
        <div className="bg-white rounded-xl border border-border-brand px-5 py-4 transition-shadow hover:shadow-md">
          <p className="text-xs text-ink4 font-medium uppercase tracking-wide mb-1">MRR</p>
          <div className="flex items-end justify-between gap-2">
            <p className="text-2xl font-bold text-teal-600">{formatCurrency(mrr)}</p>
            <MiniSparkline trend={newMrrTrend} color="#0d9488" />
          </div>
          <p className="text-xs text-ink4 mt-0.5">
            {newMrrThisWeek > 0
              ? `+${formatCurrency(newMrrThisWeek)} added this week`
              : 'No MRR added this week'}
          </p>
        </div>
        <div className="bg-white rounded-xl border border-border-brand px-5 py-4 transition-shadow hover:shadow-md">
          <p className="text-xs text-ink4 font-medium uppercase tracking-wide mb-1">ARR</p>
          <div className="flex items-end justify-between gap-2">
            <p className="text-2xl font-bold text-green-600">{formatCurrency(arr)}</p>
            <MiniSparkline trend={newMrrTrend} color="#16a34a" />
          </div>
          <p className="text-xs text-ink4 mt-0.5">
            {newMrrThisWeek > 0
              ? `+${formatCurrency(newMrrThisWeek * 12)} annualized this week`
              : 'No ARR added this week'}
          </p>
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
            <Button onClick={() => setShowNewModal(true)} size="small" sx={{ mt: 2 }}>
              New Subscription &rarr;
            </Button>
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
                            <Button
                              disabled={isPauseLoading}
                              onClick={() => void handlePause(sub.id)}
                              size="small"
                              sx={{ color: 'warning.main', minWidth: 0 }}
                            >
                              {isPauseLoading ? 'Pausing…' : 'Pause'}
                            </Button>
                          )}

                          {/* Resume — paused only */}
                          {sub.status === 'paused' && (
                            <Button
                              disabled={isResumeLoading}
                              onClick={() => void handleResume(sub.id)}
                              size="small"
                              color="success"
                              sx={{ minWidth: 0 }}
                            >
                              {isResumeLoading ? 'Resuming…' : 'Resume'}
                            </Button>
                          )}

                          {/* Cancel — not cancelled */}
                          {sub.status !== 'cancelled' && (
                            <Button
                              onClick={() => setCancelTarget(sub.id)}
                              size="small"
                              color="error"
                              sx={{ minWidth: 0 }}
                            >
                              Cancel
                            </Button>
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
                <Button
                  disabled={page <= 1}
                  onClick={() => setPage((p) => p - 1)}
                  size="small"
                  color="inherit"
                >
                  ← Previous
                </Button>
                <span className="text-xs text-ink4">
                  Page {page} of {totalPages}
                </span>
                <Button
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => p + 1)}
                  size="small"
                  color="inherit"
                >
                  Next →
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
