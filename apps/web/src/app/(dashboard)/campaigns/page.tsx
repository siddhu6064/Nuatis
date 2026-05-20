'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'

// ── Types ──────────────────────────────────────────────────────────────────────

interface PrereqCheck {
  key: string
  label: string
  status: 'pass' | 'fail' | 'warning'
  detail: string
  action_url: string | null
}

interface PrereqResult {
  ready: boolean
  checks: PrereqCheck[]
}

// ── Status icon ────────────────────────────────────────────────────────────────

function StatusIcon({ status }: { status: 'pass' | 'fail' | 'warning' }) {
  if (status === 'pass') {
    return (
      <svg
        className="w-5 h-5 shrink-0 text-green-600"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={2.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-label="Pass"
      >
        <path d="M5 13l4 4L19 7" />
      </svg>
    )
  }
  if (status === 'warning') {
    return (
      <svg
        className="w-5 h-5 shrink-0 text-yellow-600"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={2.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-label="Warning"
      >
        <path d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
      </svg>
    )
  }
  // fail
  return (
    <svg
      className="w-5 h-5 shrink-0 text-red-600"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-label="Fail"
    >
      <path d="M6 18L18 6M6 6l12 12" />
    </svg>
  )
}

// ── Skeleton row ───────────────────────────────────────────────────────────────

function SkeletonRow() {
  return (
    <div className="flex items-center gap-4 px-6 py-4 border-b border-gray-50 last:border-0 animate-pulse">
      <div className="w-5 h-5 rounded-full bg-gray-200 shrink-0" />
      <div className="flex-1 space-y-1.5">
        <div className="h-3.5 bg-gray-200 rounded w-1/4" />
        <div className="h-3 bg-gray-100 rounded w-1/2" />
      </div>
      <div className="w-16 h-6 bg-gray-100 rounded" />
    </div>
  )
}

// ── Check row ──────────────────────────────────────────────────────────────────

function CheckRow({ check }: { check: PrereqCheck }) {
  return (
    <div className="flex items-center gap-4 px-6 py-4 border-b border-gray-50 last:border-0">
      <StatusIcon status={check.status} />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-ink">{check.label}</p>
        <p className="text-xs text-ink4 mt-0.5">{check.detail}</p>
      </div>
      {check.action_url && (
        <Link
          href={check.action_url}
          className="shrink-0 px-3 py-1.5 text-xs font-medium text-teal-700 bg-teal-50 hover:bg-teal-100 rounded-lg transition-colors"
        >
          Fix →
        </Link>
      )}
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function CampaignsPage() {
  const [result, setResult] = useState<PrereqResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    setError(null)
    fetch('/api/campaigns/prereq')
      .then(async (res) => {
        if (!res.ok) throw new Error('Failed to load readiness data')
        return res.json() as Promise<PrereqResult>
      })
      .then((data) => {
        setResult(data)
      })
      .catch(() => {
        setError('Unable to load campaign readiness. Please try again.')
      })
      .finally(() => {
        setLoading(false)
      })
  }, [])

  return (
    <div className="px-8 py-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-ink">Campaigns</h1>
          <p className="text-sm text-ink3 mt-0.5">AI-powered outreach campaigns</p>
        </div>
        <button
          type="button"
          disabled={!result?.ready}
          className={`flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
            result?.ready
              ? 'bg-teal-600 text-white hover:bg-teal-700'
              : 'bg-gray-100 text-gray-400 cursor-not-allowed'
          }`}
          aria-disabled={!result?.ready}
        >
          <span className="text-base leading-none">◎</span>
          Launch Campaign
        </button>
      </div>

      {/* Campaign Readiness card */}
      <div className="bg-white rounded-xl border border-border-brand">
        {/* Card header */}
        <div className="px-6 py-4 border-b border-border-brand flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-ink">Campaign Readiness</h2>
            <p className="text-xs text-ink4 mt-0.5">
              Complete the checks below before launching a campaign
            </p>
          </div>
          {!loading && result && (
            <span
              className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold ${
                result.ready ? 'bg-green-50 text-green-700' : 'bg-amber-50 text-amber-700'
              }`}
            >
              {result.ready ? 'Ready' : 'Not Ready'}
            </span>
          )}
        </div>

        {/* Rows */}
        {error ? (
          <div className="px-6 py-10 text-center">
            <p className="text-sm text-red-600">{error}</p>
          </div>
        ) : loading ? (
          <div>
            <SkeletonRow />
            <SkeletonRow />
            <SkeletonRow />
            <SkeletonRow />
            <SkeletonRow />
          </div>
        ) : result ? (
          <div>
            {result.checks.map((check) => (
              <CheckRow key={check.key} check={check} />
            ))}
          </div>
        ) : null}
      </div>
    </div>
  )
}
