'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'

const API_URL = process.env['NEXT_PUBLIC_API_URL'] ?? ''

type PlanKey = 'core' | 'pro' | 'scale'
type Status = 'trialing' | 'active' | 'past_due' | 'canceled' | 'paused' | 'unpaid'

interface Props {
  plan: PlanKey | null
  status: Status
  planLabel: string | null
  planPrice: string | null
  trialEndsAt: string | null
  currentPeriodEnd: string | null
  mayaMinutesUsed: number
  mayaMinutesLimit: number | null
  mayaOverageRate: number | null
}

const STATUS_STYLE: Record<Status, { bg: string; fg: string; label: string }> = {
  trialing: { bg: '#fef3c7', fg: '#92400e', label: 'Trialing' },
  active: { bg: '#dcfce7', fg: '#166534', label: 'Active' },
  past_due: { bg: '#fee2e2', fg: '#b91c1c', label: 'Past due' },
  canceled: { bg: '#fee2e2', fg: '#b91c1c', label: 'Canceled' },
  paused: { bg: '#f3f4f6', fg: '#374151', label: 'Paused' },
  unpaid: { bg: '#fef3c7', fg: '#92400e', label: 'Unpaid' },
}

function daysUntil(iso: string | null, now: number): number | null {
  if (!iso) return null
  const target = new Date(iso).getTime()
  return Math.max(0, Math.ceil((target - now) / 86_400_000))
}

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}

export default function BillingClient(props: Props) {
  const [portalLoading, setPortalLoading] = useState(false)
  const [portalError, setPortalError] = useState<string | null>(null)
  const [now, setNow] = useState<number | null>(null)

  useEffect(() => {
    setNow(Date.now())
  }, [])

  async function openPortal() {
    setPortalError(null)
    setPortalLoading(true)
    try {
      const res = await fetch(`${API_URL}/api/billing/portal`, {
        method: 'POST',
        credentials: 'include',
      })
      const data = (await res.json()) as { url?: string; error?: string }
      if (!res.ok || !data.url) {
        setPortalError(data.error ?? 'Could not open billing portal')
        return
      }
      window.location.href = data.url
    } catch {
      setPortalError('Could not reach the billing server')
    } finally {
      setPortalLoading(false)
    }
  }

  const statusStyle = STATUS_STYLE[props.status]
  // `now` is null during SSR and the first client render, populated after mount.
  // Keeps the trial-days display out of the SSR markup, avoiding hydration
  // mismatch (#418) from server-now vs client-now.
  const trialDaysLeft =
    props.status === 'trialing' && now !== null ? daysUntil(props.trialEndsAt, now) : null

  // Maya minutes display state
  const isUnlimited = props.mayaMinutesLimit === null
  const usagePct = isUnlimited
    ? 0
    : Math.min(100, Math.round((props.mayaMinutesUsed / (props.mayaMinutesLimit ?? 1)) * 100))
  const isOverLimit =
    !isUnlimited &&
    props.mayaMinutesLimit !== null &&
    props.mayaMinutesUsed > props.mayaMinutesLimit
  const isWarning = !isOverLimit && usagePct >= 80

  return (
    <div className="px-8 py-8">
      <div className="mb-8">
        <h1 className="text-xl font-bold" style={{ color: 'var(--ink)' }}>
          Billing
        </h1>
        <p className="text-sm mt-0.5" style={{ color: 'var(--ink3)' }}>
          Manage your Nuatis subscription, payment method, and invoices.
        </p>
      </div>

      {props.status === 'past_due' && (
        <div
          className="mb-6 max-w-2xl rounded-xl p-4 border"
          style={{ background: '#fef2f2', borderColor: '#fecaca' }}
        >
          <p className="text-sm font-semibold mb-1" style={{ color: '#b91c1c' }}>
            Payment failed
          </p>
          <p className="text-sm" style={{ color: '#7f1d1d' }}>
            Your last invoice could not be charged. Service continues for 7 days while you update
            your payment method.
          </p>
        </div>
      )}

      <div className="max-w-2xl space-y-6">
        {/* Plan card */}
        <div className="rounded-xl border p-6 bg-white" style={{ borderColor: 'var(--border)' }}>
          <div className="flex items-start justify-between mb-4">
            <div>
              <p className="text-xs uppercase tracking-wide mb-1" style={{ color: 'var(--ink4)' }}>
                Current plan
              </p>
              <h2 className="text-2xl font-bold" style={{ color: 'var(--ink)' }}>
                {props.planLabel ?? 'No active plan'}
              </h2>
              {props.planPrice && (
                <p className="text-sm mt-1" style={{ color: 'var(--ink3)' }}>
                  {props.planPrice}
                </p>
              )}
            </div>
            <span
              className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium"
              style={{ background: statusStyle.bg, color: statusStyle.fg }}
            >
              {statusStyle.label}
            </span>
          </div>

          {trialDaysLeft !== null && (
            <div
              className="mb-4 rounded-lg p-3"
              style={{ background: 'var(--teal-light)', color: 'var(--teal-dark)' }}
            >
              <p className="text-sm font-medium">
                {trialDaysLeft} {trialDaysLeft === 1 ? 'day' : 'days'} remaining in your trial
              </p>
            </div>
          )}

          <div
            className="text-sm py-3 flex justify-between"
            style={{ color: 'var(--ink3)', borderTop: '1px solid var(--border)' }}
          >
            <span>{props.status === 'canceled' ? 'Access until' : 'Next billing date'}</span>
            <span style={{ color: 'var(--ink)' }}>{formatDate(props.currentPeriodEnd)}</span>
          </div>

          <div className="flex gap-3 mt-4">
            <button
              type="button"
              onClick={openPortal}
              disabled={portalLoading}
              className="px-4 py-2 rounded-lg text-sm font-medium text-white disabled:opacity-60"
              style={{ background: 'var(--teal)' }}
            >
              {portalLoading ? 'Opening…' : 'Manage billing'}
            </button>
            {props.plan !== 'scale' && (
              <Link
                href="/pricing"
                className="px-4 py-2 rounded-lg text-sm font-medium border"
                style={{ borderColor: 'var(--border)', color: 'var(--ink)' }}
              >
                Upgrade plan
              </Link>
            )}
          </div>

          {portalError && (
            <p className="mt-3 text-sm" style={{ color: '#b91c1c' }}>
              {portalError}
            </p>
          )}
        </div>

        {/* Maya minutes gauge */}
        <div className="rounded-xl border p-6 bg-white" style={{ borderColor: 'var(--border)' }}>
          <p className="text-xs uppercase tracking-wide mb-3" style={{ color: 'var(--ink4)' }}>
            Maya minutes — this period
          </p>

          {isUnlimited ? (
            <div>
              <p className="text-2xl font-bold mb-1" style={{ color: 'var(--ink)' }}>
                Unlimited
              </p>
              <p className="text-sm" style={{ color: 'var(--ink3)' }}>
                {props.mayaMinutesUsed.toLocaleString()} minutes used this period.
              </p>
            </div>
          ) : (
            <div>
              <div className="flex items-baseline justify-between mb-2">
                <p className="text-2xl font-bold" style={{ color: 'var(--ink)' }}>
                  {props.mayaMinutesUsed.toLocaleString()}{' '}
                  <span className="text-sm font-normal" style={{ color: 'var(--ink3)' }}>
                    / {(props.mayaMinutesLimit ?? 0).toLocaleString()} min
                  </span>
                </p>
                <span className="text-sm font-medium" style={{ color: 'var(--ink3)' }}>
                  {usagePct}%
                </span>
              </div>

              <div
                className="h-2 rounded-full overflow-hidden"
                style={{ background: 'var(--bg2)' }}
              >
                <div
                  className="h-full"
                  style={{
                    width: `${Math.min(100, usagePct)}%`,
                    background: isOverLimit
                      ? '#dc2626'
                      : isWarning
                        ? 'var(--amber)'
                        : 'var(--teal)',
                  }}
                />
              </div>

              {isOverLimit && props.mayaOverageRate !== null && (
                <p className="mt-3 text-sm" style={{ color: '#b91c1c' }}>
                  Overage billing active — ${props.mayaOverageRate.toFixed(2)}/min over your limit.
                </p>
              )}
              {!isOverLimit && isWarning && (
                <p className="mt-3 text-sm" style={{ color: 'var(--amber)' }}>
                  Approaching your minute limit. Overage will be billed at $
                  {(props.mayaOverageRate ?? 0).toFixed(2)}/min.
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
