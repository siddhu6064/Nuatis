'use client'

import { useState, useEffect, useCallback } from 'react'
import TextField from '@mui/material/TextField'
import { signIn } from 'next-auth/react'
import { Modal } from '@/components/ui/Modal'
import { bucketAmountsByDay, sumTrend, MiniSparkline } from '@/lib/sparkline'

interface TenantRow {
  id: string
  name: string
  slug: string | null
  vertical: string | null
  product: string | null
  subscription_plan: string | null
  subscription_status: string | null
  trial_ends_at: string | null
  created_at: string
  billing_email: string | null
}

interface Summary {
  total_tenants: number
  by_status: Record<string, number>
  by_plan: Record<string, number>
  estimated_mrr_cents: number
}

interface ReferralRow {
  id: string
  referring_tenant_name: string
  referred_email: string
  status: 'active' | 'paid'
  commission_amount: number | null
  activated_at: string | null
}

interface TenantActivity {
  counts: { contacts: number; appointments: number; deals: number; calls: number }
  recent_activity: Array<{
    id: string
    type: string
    body: string | null
    actor_type: string
    created_at: string
  }>
}

interface ReferralCodeRow {
  id: string
  tenant_id: string
  tenant_name: string
  code: string
  commission_rate: number
  reward_type: 'percent' | 'fixed'
  fixed_reward_cents: number | null
}

interface FeatureUsageRow {
  moduleId: string
  label: string
  tenantsEnabled: number
  tenantsActive: number
  adoptionPct: number
}

interface TrialFunnel {
  still_trialing: number
  converted: number
  expired_no_convert: number
  canceled: number
  payment_issue: number
  conversion_rate: number
}

interface ImpersonationSessionRow {
  id: string
  platform_user_email: string
  target_tenant_id: string
  tenant_name: string
  reason: string
  started_at: string
  expires_at: string
  ended_at: string | null
}

const STATUS_COLOR: Record<string, string> = {
  active: 'bg-green-50 text-green-700',
  trialing: 'bg-amber-50 text-amber-700',
  past_due: 'bg-red-50 text-red-700',
  canceled: 'bg-red-50 text-red-700',
  paused: 'bg-gray-100 text-gray-700',
}

export default function AdminConsolePage() {
  const [authorized, setAuthorized] = useState<boolean | null>(null)
  const [summary, setSummary] = useState<Summary | null>(null)
  const [tenants, setTenants] = useState<TenantRow[] | null>(null)
  const [q, setQ] = useState('')
  const [referrals, setReferrals] = useState<ReferralRow[] | null>(null)
  const [markingPaid, setMarkingPaid] = useState<string | null>(null)
  const [referralCodes, setReferralCodes] = useState<ReferralCodeRow[] | null>(null)
  const [editingCodeId, setEditingCodeId] = useState<string | null>(null)
  const [fixedAmountDraft, setFixedAmountDraft] = useState('')
  const [viewingTenant, setViewingTenant] = useState<TenantRow | null>(null)
  const [tenantActivity, setTenantActivity] = useState<TenantActivity | null>(null)
  const [activityLoading, setActivityLoading] = useState(false)
  const [impersonateReason, setImpersonateReason] = useState('')
  const [impersonating, setImpersonating] = useState(false)
  const [impersonateError, setImpersonateError] = useState<string | null>(null)
  const [sessions, setSessions] = useState<ImpersonationSessionRow[] | null>(null)
  const [features, setFeatures] = useState<FeatureUsageRow[] | null>(null)
  const [trialFunnel, setTrialFunnel] = useState<TrialFunnel | null>(null)

  const loadSessions = useCallback(() => {
    fetch('/api/admin-console/impersonate/sessions')
      .then((r) => r.json())
      .then((data: { sessions: ImpersonationSessionRow[] }) => setSessions(data.sessions))
  }, [])

  async function handleImpersonate() {
    if (!viewingTenant || !impersonateReason.trim()) return
    setImpersonating(true)
    setImpersonateError(null)
    try {
      const res = await fetch(`/api/admin-console/tenants/${viewingTenant.id}/impersonate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: impersonateReason.trim() }),
      })
      const body = (await res.json().catch(() => ({}))) as {
        exchangeCode?: string
        error?: string
      }
      if (!res.ok || !body.exchangeCode) {
        setImpersonateError(body.error ?? 'Failed to start session')
        return
      }
      await signIn('impersonate', {
        exchangeCode: body.exchangeCode,
        redirect: true,
        callbackUrl: '/dashboard',
      })
    } finally {
      setImpersonating(false)
    }
  }

  function openTenantActivity(t: TenantRow) {
    setViewingTenant(t)
    setTenantActivity(null)
    setImpersonateReason('')
    setImpersonateError(null)
    setActivityLoading(true)
    fetch(`/api/admin-console/tenants/${t.id}/activity`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data: TenantActivity | null) => setTenantActivity(data))
      .finally(() => setActivityLoading(false))
  }

  const loadReferrals = useCallback(() => {
    fetch('/api/admin-console/referrals')
      .then((r) => r.json())
      .then((data: { data: ReferralRow[] }) => setReferrals(data.data))
  }, [])

  const loadReferralCodes = useCallback(() => {
    fetch('/api/admin-console/referral-codes')
      .then((r) => r.json())
      .then((data: { data: ReferralCodeRow[] }) => setReferralCodes(data.data))
  }, [])

  async function setFixedReward(id: string) {
    const dollars = Number(fixedAmountDraft)
    if (!Number.isFinite(dollars) || dollars < 0) return
    await fetch(`/api/admin-console/referral-codes/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reward_type: 'fixed', fixed_reward_cents: Math.round(dollars * 100) }),
    })
    setEditingCodeId(null)
    setFixedAmountDraft('')
    loadReferralCodes()
  }

  async function revertToPercent(id: string) {
    await fetch(`/api/admin-console/referral-codes/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reward_type: 'percent' }),
    })
    loadReferralCodes()
  }

  async function markPaid(id: string) {
    setMarkingPaid(id)
    try {
      await fetch(`/api/admin-console/referrals/${id}/mark-paid`, { method: 'POST' })
      loadReferrals()
    } finally {
      setMarkingPaid(null)
    }
  }

  useEffect(() => {
    fetch('/api/admin-console/access-check').then((r) => setAuthorized(r.ok))
  }, [])

  const loadTenants = useCallback((query: string) => {
    const params = new URLSearchParams()
    if (query) params.set('q', query)
    fetch(`/api/admin-console/tenants?${params}`)
      .then((r) => r.json())
      .then((data: { data: TenantRow[] }) => setTenants(data.data))
  }, [])

  useEffect(() => {
    if (authorized !== true) return
    fetch('/api/admin-console/summary')
      .then((r) => r.json())
      .then(setSummary)
    fetch('/api/admin-console/product-health')
      .then((r) => r.json())
      .then((data: { features: FeatureUsageRow[] }) => setFeatures(data.features))
    fetch('/api/admin-console/trial-funnel')
      .then((r) => r.json())
      .then(setTrialFunnel)
    loadTenants('')
    loadReferrals()
    loadReferralCodes()
    loadSessions()
  }, [authorized, loadTenants, loadReferrals, loadReferralCodes, loadSessions])

  useEffect(() => {
    if (authorized !== true) return
    const t = setTimeout(() => loadTenants(q), 300)
    return () => clearTimeout(t)
  }, [q, authorized, loadTenants])

  if (authorized === null) {
    return <div className="px-8 py-8 text-sm text-ink4">Checking access…</div>
  }
  if (authorized === false) {
    return (
      <div className="px-8 py-8">
        <p className="text-sm text-ink4">Not authorized.</p>
      </div>
    )
  }

  // 7-day new-tenant trend from the already-fetched tenant page — real
  // created_at timestamps, no fabricated data. The list is ordered newest
  // first, so any tenant created this week is guaranteed to be on this page
  // regardless of total tenant count. Only meaningful for the unfiltered
  // (q === '') view — a search result isn't "new tenants," it's a subset.
  const newTenantsTrend =
    !q && tenants
      ? bucketAmountsByDay(tenants.map((t) => ({ date: t.created_at, amount: 1 })))
      : null
  const newTenantsThisWeek = newTenantsTrend ? sumTrend(newTenantsTrend) : 0

  return (
    <div className="px-8 py-8">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-ink">Admin Console</h1>
        <p className="text-sm text-ink3 mt-0.5">
          Internal — cross-tenant view. Click a tenant to view activity or log in as them; every
          impersonation session is fingerprinted below.
        </p>
      </div>

      {summary && (
        <div className="grid grid-cols-4 gap-3 mb-6">
          <div className="bg-white rounded-xl border border-border-brand p-4">
            <p className="text-xs text-ink4 uppercase tracking-wide">Total tenants</p>
            <div className="flex items-end justify-between gap-2">
              <p className="text-2xl font-bold text-ink mt-1">{summary.total_tenants}</p>
              {newTenantsTrend && <MiniSparkline trend={newTenantsTrend} color="#1b1d1f" />}
            </div>
            {newTenantsTrend && (
              <p className="text-[10px] text-ink4 mt-0.5">
                {newTenantsThisWeek > 0
                  ? `+${newTenantsThisWeek} new this week`
                  : 'No new tenants this week'}
              </p>
            )}
          </div>
          <div className="bg-white rounded-xl border border-border-brand p-4">
            <p className="text-xs text-ink4 uppercase tracking-wide">Active</p>
            <p className="text-2xl font-bold text-ink mt-1">{summary.by_status['active'] ?? 0}</p>
          </div>
          <div className="bg-white rounded-xl border border-border-brand p-4">
            <p className="text-xs text-ink4 uppercase tracking-wide">Trialing</p>
            <p className="text-2xl font-bold text-ink mt-1">{summary.by_status['trialing'] ?? 0}</p>
          </div>
          <div className="bg-white rounded-xl border border-border-brand p-4">
            <p className="text-xs text-ink4 uppercase tracking-wide">Est. MRR</p>
            <p className="text-2xl font-bold text-ink mt-1">
              ${(summary.estimated_mrr_cents / 100).toLocaleString()}
            </p>
            <p className="text-[10px] text-ink4 mt-0.5">
              Rough estimate — active tenants × list monthly price, not reconciled with Stripe.
            </p>
          </div>
        </div>
      )}

      <div className="mb-8 grid grid-cols-2 gap-6">
        <div>
          <h2 className="text-lg font-semibold text-ink mb-1">Product Health</h2>
          <p className="text-xs text-ink4 mb-3">
            Of tenants entitled to each feature, % who actually used it in the last 30 days.
          </p>
          <div className="bg-white rounded-xl border border-border-brand p-4 space-y-3">
            {features === null ? (
              <p className="text-sm text-ink4 text-center py-4">Loading…</p>
            ) : (
              features.map((f) => (
                <div key={f.moduleId}>
                  <div className="flex items-center justify-between text-xs mb-1">
                    <span className="text-ink font-medium">{f.label}</span>
                    <span className="text-ink4">
                      {f.tenantsActive}/{f.tenantsEnabled} tenants · {f.adoptionPct}%
                    </span>
                  </div>
                  <div className="h-1.5 bg-bg2 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-teal-600 rounded-full"
                      style={{ width: `${f.adoptionPct}%` }}
                    />
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <div>
          <h2 className="text-lg font-semibold text-ink mb-1">Trial → Paid Funnel</h2>
          <p className="text-xs text-ink4 mb-3">
            Where self-serve trial tenants land, keyed off trial_ends_at/subscription_status.
          </p>
          {trialFunnel === null ? (
            <div className="bg-white rounded-xl border border-border-brand p-4">
              <p className="text-sm text-ink4 text-center py-4">Loading…</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              <div className="bg-white rounded-xl border border-border-brand p-3">
                <p className="text-xs text-ink4 uppercase tracking-wide">Still trialing</p>
                <p className="text-xl font-bold text-ink mt-0.5">{trialFunnel.still_trialing}</p>
              </div>
              <div className="bg-white rounded-xl border border-border-brand p-3">
                <p className="text-xs text-ink4 uppercase tracking-wide">Converted</p>
                <p className="text-xl font-bold text-green-700 mt-0.5">{trialFunnel.converted}</p>
              </div>
              <div className="bg-white rounded-xl border border-border-brand p-3">
                <p className="text-xs text-ink4 uppercase tracking-wide">Expired, no card</p>
                <p className="text-xl font-bold text-ink mt-0.5">
                  {trialFunnel.expired_no_convert}
                </p>
              </div>
              <div className="bg-white rounded-xl border border-border-brand p-3">
                <p className="text-xs text-ink4 uppercase tracking-wide">Canceled</p>
                <p className="text-xl font-bold text-red-700 mt-0.5">{trialFunnel.canceled}</p>
              </div>
              <div className="bg-white rounded-xl border border-border-brand p-3 col-span-2">
                <div className="flex items-center justify-between">
                  <p className="text-xs text-ink4 uppercase tracking-wide">Conversion rate</p>
                  <p className="text-xs text-ink4">{trialFunnel.payment_issue} payment issue</p>
                </div>
                <p className="text-xl font-bold text-ink mt-0.5">{trialFunnel.conversion_rate}%</p>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="mb-4">
        <TextField
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search by name or billing email…"
          size="small"
          sx={{ width: '100%', maxWidth: 384 }}
        />
      </div>

      <div className="bg-white rounded-xl border border-border-brand overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-bg2 text-ink3 text-xs uppercase tracking-wide">
            <tr>
              <th className="text-left px-4 py-2">Tenant</th>
              <th className="text-left px-4 py-2">Plan</th>
              <th className="text-left px-4 py-2">Status</th>
              <th className="text-left px-4 py-2">Billing email</th>
              <th className="text-left px-4 py-2">Created</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border-brand">
            {tenants === null ? (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-ink4">
                  Loading…
                </td>
              </tr>
            ) : tenants.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-ink4">
                  No tenants match.
                </td>
              </tr>
            ) : (
              tenants.map((t) => (
                <tr
                  key={t.id}
                  onClick={() => openTenantActivity(t)}
                  className="cursor-pointer hover:bg-bg2"
                >
                  <td className="px-4 py-2.5 text-ink font-medium hover:underline">{t.name}</td>
                  <td className="px-4 py-2.5 text-ink3">{t.subscription_plan ?? '—'}</td>
                  <td className="px-4 py-2.5">
                    <span
                      className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${
                        STATUS_COLOR[t.subscription_status ?? ''] ?? 'bg-gray-100 text-gray-700'
                      }`}
                    >
                      {t.subscription_status ?? 'unknown'}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-ink3">{t.billing_email ?? '—'}</td>
                  <td className="px-4 py-2.5 text-ink4">
                    {new Date(t.created_at).toLocaleDateString()}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-8">
        <h2 className="text-lg font-semibold text-ink mb-3">Referral commission payouts</h2>
        <div className="bg-white rounded-xl border border-border-brand overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-bg2 text-ink3 text-xs uppercase tracking-wide">
              <tr>
                <th className="text-left px-4 py-2">Referring tenant</th>
                <th className="text-left px-4 py-2">Referred email</th>
                <th className="text-left px-4 py-2">Commission</th>
                <th className="text-left px-4 py-2">Status</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border-brand">
              {referrals === null ? (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-ink4">
                    Loading…
                  </td>
                </tr>
              ) : referrals.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-ink4">
                    No commissions earned yet.
                  </td>
                </tr>
              ) : (
                referrals.map((r) => (
                  <tr key={r.id}>
                    <td className="px-4 py-2.5 text-ink font-medium">{r.referring_tenant_name}</td>
                    <td className="px-4 py-2.5 text-ink3">{r.referred_email}</td>
                    <td className="px-4 py-2.5 text-ink3">
                      {r.commission_amount != null ? `$${r.commission_amount.toFixed(2)}` : '—'}
                    </td>
                    <td className="px-4 py-2.5">
                      <span
                        className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${
                          r.status === 'paid'
                            ? 'bg-blue-50 text-blue-700'
                            : 'bg-amber-50 text-amber-700'
                        }`}
                      >
                        {r.status}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      {r.status === 'active' && (
                        <button
                          type="button"
                          onClick={() => void markPaid(r.id)}
                          disabled={markingPaid === r.id}
                          className="text-xs text-teal-700 hover:underline"
                        >
                          {markingPaid === r.id ? 'Marking…' : 'Mark paid'}
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="mt-8">
        <h2 className="text-lg font-semibold text-ink mb-3">
          Referral codes &amp; reward structure
        </h2>
        <p className="text-xs text-ink4 mb-3">
          Defaults to a 20% recurring commission. Override to a flat dollar amount for a custom
          deal.
        </p>
        <div className="bg-white rounded-xl border border-border-brand overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-bg2 text-ink3 text-xs uppercase tracking-wide">
              <tr>
                <th className="text-left px-4 py-2">Tenant</th>
                <th className="text-left px-4 py-2">Code</th>
                <th className="text-left px-4 py-2">Reward</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border-brand">
              {referralCodes === null ? (
                <tr>
                  <td colSpan={4} className="px-4 py-6 text-center text-ink4">
                    Loading…
                  </td>
                </tr>
              ) : referralCodes.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-6 text-center text-ink4">
                    No referral codes yet.
                  </td>
                </tr>
              ) : (
                referralCodes.map((c) => (
                  <tr key={c.id}>
                    <td className="px-4 py-2.5 text-ink font-medium">{c.tenant_name}</td>
                    <td className="px-4 py-2.5 text-ink3 font-mono text-xs">{c.code}</td>
                    <td className="px-4 py-2.5 text-ink3">
                      {c.reward_type === 'fixed'
                        ? `$${((c.fixed_reward_cents ?? 0) / 100).toFixed(2)} flat`
                        : `${c.commission_rate}% recurring`}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      {editingCodeId === c.id ? (
                        <div className="flex items-center gap-2 justify-end">
                          <TextField
                            value={fixedAmountDraft}
                            onChange={(e) => setFixedAmountDraft(e.target.value)}
                            placeholder="$ amount"
                            size="small"
                            sx={{ width: 100 }}
                          />
                          <button
                            type="button"
                            onClick={() => void setFixedReward(c.id)}
                            className="text-xs text-teal-700 hover:underline"
                          >
                            Save
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditingCodeId(null)}
                            className="text-xs text-ink4 hover:underline"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <>
                          <button
                            type="button"
                            onClick={() => {
                              setEditingCodeId(c.id)
                              setFixedAmountDraft('')
                            }}
                            className="text-xs text-teal-700 hover:underline mr-3"
                          >
                            Set fixed reward
                          </button>
                          {c.reward_type === 'fixed' && (
                            <button
                              type="button"
                              onClick={() => void revertToPercent(c.id)}
                              className="text-xs text-ink4 hover:underline"
                            >
                              Revert to %
                            </button>
                          )}
                        </>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="mt-8">
        <h2 className="text-lg font-semibold text-ink mb-3">Impersonation sessions</h2>
        <p className="text-xs text-ink4 mb-3">
          Fingerprint of every "log in as this tenant" session — who, which tenant, why, when.
        </p>
        <div className="bg-white rounded-xl border border-border-brand overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-bg2 text-ink3 text-xs uppercase tracking-wide">
              <tr>
                <th className="text-left px-4 py-2">Platform admin</th>
                <th className="text-left px-4 py-2">Tenant</th>
                <th className="text-left px-4 py-2">Reason</th>
                <th className="text-left px-4 py-2">Started</th>
                <th className="text-left px-4 py-2">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-brand">
              {sessions === null ? (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-ink4">
                    Loading…
                  </td>
                </tr>
              ) : sessions.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-ink4">
                    No impersonation sessions yet.
                  </td>
                </tr>
              ) : (
                sessions.map((s) => {
                  const expired = !s.ended_at && new Date(s.expires_at) < new Date()
                  return (
                    <tr key={s.id}>
                      <td className="px-4 py-2.5 text-ink font-medium">{s.platform_user_email}</td>
                      <td className="px-4 py-2.5 text-ink3">{s.tenant_name}</td>
                      <td className="px-4 py-2.5 text-ink3">{s.reason}</td>
                      <td className="px-4 py-2.5 text-ink4">
                        {new Date(s.started_at).toLocaleString('en-US', {
                          month: 'short',
                          day: 'numeric',
                          hour: 'numeric',
                          minute: '2-digit',
                        })}
                      </td>
                      <td className="px-4 py-2.5">
                        <span
                          className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${
                            s.ended_at
                              ? 'bg-gray-100 text-gray-700'
                              : expired
                                ? 'bg-gray-100 text-gray-700'
                                : 'bg-red-50 text-red-700'
                          }`}
                        >
                          {s.ended_at ? 'Ended' : expired ? 'Expired' : 'Active'}
                        </span>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {viewingTenant && (
        <Modal
          onClose={() => setViewingTenant(null)}
          title={viewingTenant.name}
          footer={
            <button
              type="button"
              onClick={() => setViewingTenant(null)}
              className="text-sm text-ink4 hover:underline"
            >
              Close
            </button>
          }
        >
          {activityLoading || !tenantActivity ? (
            <p className="text-sm text-ink4 py-6 text-center">Loading…</p>
          ) : (
            <div>
              <div className="grid grid-cols-4 gap-2 mb-5">
                <div className="bg-bg2 rounded-lg p-3 text-center">
                  <p className="text-lg font-bold text-ink">{tenantActivity.counts.contacts}</p>
                  <p className="text-[10px] text-ink4 uppercase tracking-wide">Contacts</p>
                </div>
                <div className="bg-bg2 rounded-lg p-3 text-center">
                  <p className="text-lg font-bold text-ink">{tenantActivity.counts.appointments}</p>
                  <p className="text-[10px] text-ink4 uppercase tracking-wide">Appts</p>
                </div>
                <div className="bg-bg2 rounded-lg p-3 text-center">
                  <p className="text-lg font-bold text-ink">{tenantActivity.counts.deals}</p>
                  <p className="text-[10px] text-ink4 uppercase tracking-wide">Deals</p>
                </div>
                <div className="bg-bg2 rounded-lg p-3 text-center">
                  <p className="text-lg font-bold text-ink">{tenantActivity.counts.calls}</p>
                  <p className="text-[10px] text-ink4 uppercase tracking-wide">Calls</p>
                </div>
              </div>

              <h3 className="text-xs font-semibold text-ink3 uppercase tracking-wide mb-2">
                Recent activity
              </h3>
              {tenantActivity.recent_activity.length === 0 ? (
                <p className="text-sm text-ink4">No activity recorded yet.</p>
              ) : (
                <ul className="space-y-2 max-h-72 overflow-y-auto">
                  {tenantActivity.recent_activity.map((a) => (
                    <li key={a.id} className="text-xs flex items-start justify-between gap-2">
                      <span className="text-ink3">{a.body ?? a.type}</span>
                      <span className="text-ink4 shrink-0">
                        {new Date(a.created_at).toLocaleDateString('en-US', {
                          month: 'short',
                          day: 'numeric',
                        })}
                      </span>
                    </li>
                  ))}
                </ul>
              )}

              <div className="border-t border-border-brand mt-5 pt-5">
                <h3 className="text-xs font-semibold text-ink3 uppercase tracking-wide mb-2">
                  Log in as this tenant
                </h3>
                <p className="text-xs text-ink4 mb-2">
                  Real, read-write session — 30 minutes, reason required, every action logged.
                </p>
                <TextField
                  value={impersonateReason}
                  onChange={(e) => setImpersonateReason(e.target.value)}
                  placeholder="Reason (e.g. ticket #1234 — booking page broken)"
                  size="small"
                  fullWidth
                  sx={{ mb: 1.5 }}
                />
                {impersonateError && (
                  <p className="text-xs text-red-600 mb-2">{impersonateError}</p>
                )}
                <button
                  type="button"
                  onClick={() => void handleImpersonate()}
                  disabled={impersonating || !impersonateReason.trim()}
                  className="w-full py-2 px-4 bg-red-600 text-white text-sm font-medium rounded-lg
                             hover:bg-red-700 disabled:opacity-50"
                >
                  {impersonating ? 'Starting…' : `Log in as ${viewingTenant.name}`}
                </button>
              </div>
            </div>
          )}
        </Modal>
      )}
    </div>
  )
}
