'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

const API_URL = process.env['NEXT_PUBLIC_API_URL'] ?? ''

type PlanKey = 'core' | 'pro' | 'scale'
type Interval = 'month' | 'year'

interface PlanCard {
  key: PlanKey
  name: string
  monthly: number
  annual: number
  mayaMinutes: string
  overage: string
  highlight: boolean
  tagline: string
  features: string[]
}

const PLANS: PlanCard[] = [
  {
    key: 'core',
    name: 'Core',
    monthly: 149,
    annual: 1490,
    mayaMinutes: '300 minutes / mo',
    overage: '$0.05 / extra min',
    highlight: false,
    tagline: 'Everything you need to run the front office.',
    features: [
      'Maya AI receptionist',
      'CRM contacts + companies',
      'Scheduling + appointments',
      'Pipeline + deals',
      '300 Maya minutes / month',
      'Overage billed at $0.05/min',
    ],
  },
  {
    key: 'pro',
    name: 'Pro',
    monthly: 299,
    annual: 2990,
    mayaMinutes: '600 minutes / mo',
    overage: '$0.04 / extra min',
    highlight: true,
    tagline: 'Add automation, insights, and campaigns.',
    features: [
      'Everything in Core',
      'Automation (follow-ups, scanners)',
      'Insights dashboards',
      'Multi-channel campaigns',
      '600 Maya minutes / month',
      'Overage billed at $0.04/min',
    ],
  },
  {
    key: 'scale',
    name: 'Scale',
    monthly: 499,
    annual: 4990,
    mayaMinutes: 'Unlimited',
    overage: 'No overage',
    highlight: false,
    tagline: 'Unlimited Maya + quoting (CPQ).',
    features: [
      'Everything in Pro',
      'CPQ — quotes + packages',
      'Unlimited Maya minutes',
      'No per-minute overage',
      'Priority support',
    ],
  },
]

// Comparison table — every row, whether each tier includes it.
const COMPARISON: Array<{ feature: string; core: boolean; pro: boolean; scale: boolean }> = [
  { feature: 'Maya AI receptionist', core: true, pro: true, scale: true },
  { feature: 'CRM (contacts, companies)', core: true, pro: true, scale: true },
  { feature: 'Scheduling + appointments', core: true, pro: true, scale: true },
  { feature: 'Pipeline + deals', core: true, pro: true, scale: true },
  { feature: 'Automation + follow-ups', core: false, pro: true, scale: true },
  { feature: 'Insights dashboards', core: false, pro: true, scale: true },
  { feature: 'Campaigns (SMS / email)', core: false, pro: true, scale: true },
  { feature: 'CPQ — quotes + packages', core: false, pro: false, scale: true },
  { feature: 'Unlimited Maya minutes', core: false, pro: false, scale: true },
  { feature: '7-day free trial', core: true, pro: true, scale: true },
]

const FAQS: Array<{ q: string; a: string }> = [
  {
    q: 'Can I change plans later?',
    a: 'Yes — upgrade or downgrade any time from your billing settings. Upgrades take effect instantly; downgrades take effect at the next billing cycle.',
  },
  {
    q: 'What happens after my 7-day trial?',
    a: "Your card on file is charged automatically. You'll receive a reminder email 3 days before the trial ends so there are no surprises.",
  },
  {
    q: 'What are Maya minutes?',
    a: 'One minute of live phone call handled by Maya AI. Calls under 60 seconds count as one minute. Scale includes unlimited; Core and Pro charge per-minute overage if you exceed the included pool.',
  },
  {
    q: 'Can I cancel anytime?',
    a: 'Yes. Cancel from your billing settings and you keep access until the end of your current billing period.',
  },
]

function Check({ active }: { active: boolean }) {
  if (active) {
    return (
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="#16a34a"
        strokeWidth="3"
        aria-hidden="true"
      >
        <polyline points="20 6 9 17 4 12" />
      </svg>
    )
  }
  return (
    <span className="text-ink4" aria-hidden="true">
      —
    </span>
  )
}

export default function PricingClient() {
  const router = useRouter()
  const [interval, setInterval] = useState<Interval>('month')
  const [pendingPlan, setPendingPlan] = useState<PlanKey | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function startCheckout(plan: PlanKey) {
    setError(null)
    setPendingPlan(plan)
    try {
      const res = await fetch(`${API_URL}/api/billing/checkout`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan, interval }),
      })

      // Unauthenticated → push them through sign-up first; carry plan/interval.
      if (res.status === 401) {
        router.push(`/sign-up?plan=${plan}&interval=${interval}`)
        return
      }

      const data = (await res.json()) as { url?: string; error?: string }

      if (!res.ok || !data.url) {
        setError(data.error ?? 'Could not start checkout. Please try again.')
        return
      }

      window.location.href = data.url
    } catch {
      setError('Could not reach the billing server. Please try again.')
    } finally {
      setPendingPlan(null)
    }
  }

  function priceFor(plan: PlanCard): string {
    if (interval === 'year') return `$${plan.annual.toLocaleString()}`
    return `$${plan.monthly}`
  }
  function priceSuffix(): string {
    return interval === 'year' ? '/ yr' : '/ mo'
  }

  return (
    <div className="min-h-screen" style={{ background: 'var(--bg)' }}>
      <div className="max-w-6xl mx-auto px-6 py-16">
        {/* Header */}
        <div className="text-center mb-12">
          <h1 className="text-4xl font-bold mb-4" style={{ color: 'var(--ink)' }}>
            Simple pricing. 7-day free trial.
          </h1>
          <p className="text-lg" style={{ color: 'var(--ink3)' }}>
            Pick a tier — switch any time. No setup fees, no contracts.
          </p>
        </div>

        {/* Monthly / Annual toggle */}
        <div className="flex justify-center mb-12">
          <div
            className="inline-flex items-center rounded-full p-1 border"
            style={{ borderColor: 'var(--border)', background: 'white' }}
          >
            <button
              type="button"
              onClick={() => setInterval('month')}
              className={`px-5 py-2 rounded-full text-sm font-medium transition-colors ${
                interval === 'month' ? 'text-white' : 'text-ink3'
              }`}
              style={interval === 'month' ? { background: 'var(--teal)' } : {}}
            >
              Monthly
            </button>
            <button
              type="button"
              onClick={() => setInterval('year')}
              className={`px-5 py-2 rounded-full text-sm font-medium transition-colors flex items-center gap-2 ${
                interval === 'year' ? 'text-white' : 'text-ink3'
              }`}
              style={interval === 'year' ? { background: 'var(--teal)' } : {}}
            >
              Annual
              <span
                className="text-[10px] px-2 py-0.5 rounded-full font-semibold"
                style={{
                  background: interval === 'year' ? 'rgba(255,255,255,0.2)' : 'var(--teal-light)',
                  color: interval === 'year' ? 'white' : 'var(--teal-dark)',
                }}
              >
                2 months free
              </span>
            </button>
          </div>
        </div>

        {/* Tier cards */}
        <div className="grid md:grid-cols-3 gap-6 mb-16">
          {PLANS.map((plan) => {
            const isHighlight = plan.highlight
            return (
              <div
                key={plan.key}
                className="rounded-2xl p-8 flex flex-col"
                style={{
                  background: 'white',
                  border: `2px solid ${isHighlight ? 'var(--teal)' : 'var(--border)'}`,
                  boxShadow: isHighlight ? '0 4px 24px rgba(13,148,136,0.10)' : 'none',
                  position: 'relative',
                }}
              >
                {isHighlight && (
                  <div
                    className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full text-xs font-semibold"
                    style={{ background: 'var(--teal)', color: 'white' }}
                  >
                    Most popular
                  </div>
                )}

                <h2 className="text-xl font-bold mb-1" style={{ color: 'var(--ink)' }}>
                  {plan.name}
                </h2>
                <p className="text-sm mb-6" style={{ color: 'var(--ink3)' }}>
                  {plan.tagline}
                </p>

                <div className="flex items-baseline gap-1 mb-2">
                  <span className="text-4xl font-bold" style={{ color: 'var(--ink)' }}>
                    {priceFor(plan)}
                  </span>
                  <span className="text-sm" style={{ color: 'var(--ink3)' }}>
                    {priceSuffix()}
                  </span>
                </div>

                <span
                  className="inline-flex items-center self-start mb-6 px-2 py-0.5 rounded text-xs font-medium"
                  style={{ background: 'var(--teal-light)', color: 'var(--teal-dark)' }}
                >
                  7-day free trial
                </span>

                <ul className="space-y-2 mb-8 text-sm" style={{ color: 'var(--ink2)' }}>
                  {plan.features.map((f) => (
                    <li key={f} className="flex items-start gap-2">
                      <span className="mt-0.5 shrink-0">
                        <Check active />
                      </span>
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>

                <button
                  type="button"
                  onClick={() => startCheckout(plan.key)}
                  disabled={pendingPlan === plan.key}
                  className="mt-auto w-full py-3 rounded-lg font-medium text-white transition-colors disabled:opacity-60"
                  style={{ background: isHighlight ? 'var(--teal)' : 'var(--ink)' }}
                >
                  {pendingPlan === plan.key ? 'Starting…' : 'Start free trial'}
                </button>
              </div>
            )
          })}
        </div>

        {error && (
          <div
            className="mb-12 rounded-lg p-4 text-sm text-center"
            style={{ background: '#fef2f2', color: '#b91c1c' }}
          >
            {error}
          </div>
        )}

        {/* Comparison table */}
        <div className="mb-20">
          <h2 className="text-2xl font-bold mb-6 text-center" style={{ color: 'var(--ink)' }}>
            Compare plans
          </h2>

          {/* overflow-x-auto wrapper for mobile */}
          <div
            className="overflow-x-auto rounded-xl border"
            style={{ borderColor: 'var(--border)' }}
          >
            <table className="w-full bg-white min-w-[640px]">
              <thead>
                <tr className="bg-gray-50">
                  <th
                    className="text-left text-sm font-semibold px-6 py-4"
                    style={{ color: 'var(--ink)' }}
                  >
                    Feature
                  </th>
                  <th
                    className="text-center text-sm font-semibold px-6 py-4"
                    style={{ color: 'var(--ink)' }}
                  >
                    Core
                  </th>
                  {/* Pro column header — teal tint + teal text + top accent
                      border so it visually ties back to the "Most popular"
                      tier card above. */}
                  <th
                    className="text-center text-sm font-semibold px-6 py-4 bg-teal-50 border-t-2"
                    style={{ color: 'var(--teal-dark)', borderTopColor: 'var(--teal)' }}
                  >
                    Pro
                  </th>
                  <th
                    className="text-center text-sm font-semibold px-6 py-4"
                    style={{ color: 'var(--ink)' }}
                  >
                    Scale
                  </th>
                </tr>
              </thead>
              <tbody>
                {COMPARISON.map((row, i) => (
                  <tr
                    key={row.feature}
                    className={i % 2 === 1 ? 'bg-gray-50/50' : 'bg-white'}
                    style={{ borderTop: i === 0 ? 'none' : '1px solid var(--border)' }}
                  >
                    <td className="text-sm px-6 py-3 font-medium" style={{ color: 'var(--ink)' }}>
                      {row.feature}
                    </td>
                    <td className="text-center px-6 py-3">
                      <Check active={row.core} />
                    </td>
                    {/* Pro column cell — same teal tint as the header for a
                        full-height column highlight. */}
                    <td className="text-center px-6 py-3 bg-teal-50">
                      <Check active={row.pro} />
                    </td>
                    <td className="text-center px-6 py-3">
                      <Check active={row.scale} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* FAQ */}
        <div className="max-w-3xl mx-auto">
          <h2 className="text-2xl font-bold mb-6 text-center" style={{ color: 'var(--ink)' }}>
            Frequently asked questions
          </h2>
          <div className="space-y-4">
            {FAQS.map(({ q, a }) => (
              <details
                key={q}
                className="rounded-xl border p-5 bg-white group"
                style={{ borderColor: 'var(--border)' }}
              >
                <summary
                  className="cursor-pointer font-semibold text-sm flex items-center justify-between"
                  style={{ color: 'var(--ink)' }}
                >
                  {q}
                  <span
                    className="text-lg group-open:rotate-45 transition-transform"
                    style={{ color: 'var(--ink3)' }}
                  >
                    +
                  </span>
                </summary>
                <p className="mt-3 text-sm leading-relaxed" style={{ color: 'var(--ink3)' }}>
                  {a}
                </p>
              </details>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
