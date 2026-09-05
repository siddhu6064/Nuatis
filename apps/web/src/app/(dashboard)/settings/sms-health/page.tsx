'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import Link from 'next/link'
import Button from '@mui/material/Button'
import Tabs from '@mui/material/Tabs'
import Tab from '@mui/material/Tab'
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts'
import type { SmsHealthStats, SmsDeliveryError, EmailHealthStats } from '@nuatis/shared'

interface SuppressedContact {
  id: string
  full_name: string
  email: string
  email_status: string
  email_risk_score: number | null
}

export default function DeliveryHealthPage() {
  const [stats, setStats] = useState<SmsHealthStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [smsLastUpdated, setSmsLastUpdated] = useState<string | null>(null)
  const [emailLastUpdated, setEmailLastUpdated] = useState<string | null>(null)

  const [activeTab, setActiveTab] = useState<'sms' | 'email'>('sms')
  const [emailStats, setEmailStats] = useState<EmailHealthStats | null>(null)
  const [emailLoading, setEmailLoading] = useState(false)
  const [emailError, setEmailError] = useState<string | null>(null)

  const fetchStats = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/sms/health', { credentials: 'include' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = (await res.json()) as SmsHealthStats
      setStats(data)
      setSmsLastUpdated(new Date().toLocaleTimeString())
    } catch {
      setError('Failed to load SMS health data')
    } finally {
      setLoading(false)
    }
  }, [])

  const fetchEmailStats = useCallback(async () => {
    setEmailLoading(true)
    setEmailError(null)
    try {
      const res = await fetch('/api/email/health', { credentials: 'include' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = (await res.json()) as EmailHealthStats
      setEmailStats(data)
      setEmailLastUpdated(new Date().toLocaleTimeString())
    } catch {
      setEmailError('Failed to load email health data')
    } finally {
      setEmailLoading(false)
    }
  }, [])

  const [suppressed, setSuppressed] = useState<SuppressedContact[] | null>(null)
  const [reactivatingId, setReactivatingId] = useState<string | null>(null)

  const fetchSuppressed = useCallback(async () => {
    const res = await fetch('/api/email/suppressed', { credentials: 'include' })
    if (res.ok) {
      const data = (await res.json()) as { data: SuppressedContact[] }
      setSuppressed(data.data)
    }
  }, [])

  async function reactivate(contactId: string) {
    setReactivatingId(contactId)
    try {
      await fetch(`/api/email/suppressed/${contactId}`, { method: 'PATCH' })
      await fetchSuppressed()
    } finally {
      setReactivatingId(null)
    }
  }

  const STATUS_LABEL: Record<string, string> = {
    soft_bounce: 'Soft bounce',
    hard_bounce: 'Hard bounce',
    complained: 'Marked as spam',
    unsubscribed: 'Unsubscribed',
  }

  useEffect(() => {
    void fetchStats()
  }, [fetchStats])

  useEffect(() => {
    if (activeTab === 'email' && !emailStats && !emailLoading && !emailError) {
      void fetchEmailStats()
    }
  }, [activeTab, emailStats, emailLoading, emailError, fetchEmailStats])

  useEffect(() => {
    if (activeTab === 'email' && suppressed === null) {
      void fetchSuppressed()
    }
  }, [activeTab, suppressed, fetchSuppressed])

  const trendIsEmpty = useMemo(
    () =>
      !stats ||
      stats.trend_7d.length === 0 ||
      stats.trend_7d.every((d) => d.sent === 0 && d.delivered === 0 && d.failed === 0),
    [stats]
  )

  const emailTrendIsEmpty = useMemo(
    () =>
      !emailStats ||
      emailStats.trend_7d.length === 0 ||
      emailStats.trend_7d.every((d) => d.sent === 0 && d.delivered === 0 && d.bounced === 0),
    [emailStats]
  )

  const totalFailed = stats?.total_failed ?? 0

  return (
    <div className="px-8 py-8 max-w-4xl">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-ink">Delivery Health</h1>
          <p className="text-sm text-ink3 mt-0.5">Email and SMS delivery monitoring</p>
        </div>
        <div className="flex items-center gap-3">
          {(activeTab === 'sms' ? smsLastUpdated : emailLastUpdated) && (
            <span className="text-xs text-ink4">
              Last updated: {activeTab === 'sms' ? smsLastUpdated : emailLastUpdated}
            </span>
          )}
          <Button
            onClick={() => void (activeTab === 'sms' ? fetchStats() : fetchEmailStats())}
            disabled={activeTab === 'sms' ? loading : emailLoading}
            aria-label={
              activeTab === 'sms'
                ? loading
                  ? 'Loading SMS health data'
                  : 'Refresh SMS health data'
                : emailLoading
                  ? 'Loading email health data'
                  : 'Refresh email health data'
            }
            aria-busy={activeTab === 'sms' ? loading : emailLoading}
            variant="contained"
            size="small"
          >
            {(activeTab === 'sms' ? loading : emailLoading) ? 'Loading…' : 'Refresh'}
          </Button>
        </div>
      </div>

      {/* Tab switcher */}
      <Tabs
        value={activeTab}
        onChange={(_e, val) => setActiveTab(val as 'sms' | 'email')}
        sx={{ mb: 3, minHeight: 0 }}
      >
        <Tab label="SMS" value="sms" sx={{ minHeight: 0 }} />
        <Tab label="Email" value="email" sx={{ minHeight: 0 }} />
      </Tabs>

      {/* ── SMS Tab ── */}
      {activeTab === 'sms' && (
        <>
          {/* Error state */}
          {error && (
            <div
              role="alert"
              className="mb-6 bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-800"
            >
              {error}
            </div>
          )}

          {/* Loading skeleton */}
          {loading && !stats && (
            <div className="animate-pulse space-y-4">
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="bg-gray-100 rounded-xl h-20" />
                ))}
              </div>
              <div className="bg-gray-100 rounded-xl h-56" />
              <div className="bg-gray-100 rounded-xl h-40" />
            </div>
          )}

          {stats && (
            <>
              {/* Row 1 — Alert banner */}
              {(stats.alert.level === 'warning' || stats.alert.level === 'critical') && (
                <div
                  className={`mb-6 flex items-start gap-3 rounded-lg px-4 py-3 border text-sm ${
                    stats.alert.level === 'critical'
                      ? 'bg-red-50 border-red-200 text-red-800'
                      : 'bg-yellow-50 border-yellow-200 text-yellow-800'
                  }`}
                >
                  <span className="text-base leading-none mt-0.5">
                    {stats.alert.level === 'critical' ? '🚨' : '⚠'}
                  </span>
                  <span>{stats.alert.message ?? ''}</span>
                </div>
              )}

              {/* Row 2 — Stat cards */}
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4 mb-6">
                <StatCard label="Total Sent" value={stats.total_sent} />
                <StatCard label="Delivered" value={stats.total_delivered} />
                <StatCard
                  label="Failed"
                  value={stats.total_failed}
                  highlight={stats.failure_rate > 5}
                />
                <StatCard label="Opted Out" value={stats.total_opted_out} />
                <StatCard label="Delivery Rate" value={`${stats.delivery_rate}%`} />
              </div>

              {/* Row 3 — 7-day trend chart */}
              <div className="bg-white rounded-xl border border-border-brand p-5 mb-6">
                <h2 className="text-sm font-semibold text-ink mb-4">
                  Delivery Trend — Last 7 Days
                </h2>
                {trendIsEmpty ? (
                  <div className="flex items-center justify-center h-[220px] text-sm text-ink4">
                    No delivery data in the last 7 days
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height={220}>
                    <LineChart
                      data={stats.trend_7d}
                      margin={{ top: 4, right: 8, left: 0, bottom: 0 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                      <XAxis
                        dataKey="date"
                        tick={{ fontSize: 11 }}
                        tickLine={false}
                        axisLine={false}
                      />
                      <YAxis
                        allowDecimals={false}
                        tick={{ fontSize: 11 }}
                        tickLine={false}
                        axisLine={false}
                      />
                      <Tooltip />
                      <Legend wrapperStyle={{ fontSize: 12 }} />
                      <Line
                        type="monotone"
                        dataKey="sent"
                        name="Sent"
                        stroke="#0d9488"
                        dot={false}
                        strokeWidth={2}
                      />
                      <Line
                        type="monotone"
                        dataKey="delivered"
                        name="Delivered"
                        stroke="#10b981"
                        dot={false}
                        strokeWidth={2}
                      />
                      <Line
                        type="monotone"
                        dataKey="failed"
                        name="Failed"
                        stroke="#ef4444"
                        dot={false}
                        strokeWidth={2}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                )}
              </div>

              {/* Row 4 — Error breakdown table */}
              <div className="bg-white rounded-xl border border-border-brand p-5 mb-6">
                <h2 className="text-sm font-semibold text-ink mb-4">
                  Error Breakdown — Last 30 Days
                </h2>
                {stats.error_breakdown.length === 0 ? (
                  <div className="flex items-center gap-2 py-6 justify-center text-sm text-green-700">
                    <span>✓</span>
                    <span>No delivery errors in the last 30 days</span>
                  </div>
                ) : (
                  <table className="w-full text-sm">
                    <caption className="sr-only">Error breakdown for the last 30 days</caption>
                    <thead>
                      <tr className="border-b border-border-brand">
                        <th className="text-left text-xs font-medium text-ink4 pb-2 pr-4">
                          Error Code
                        </th>
                        <th className="text-left text-xs font-medium text-ink4 pb-2 pr-4">
                          Description
                        </th>
                        <th className="text-right text-xs font-medium text-ink4 pb-2 pr-4">
                          Count
                        </th>
                        <th className="text-right text-xs font-medium text-ink4 pb-2">
                          % of Failed
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {stats.error_breakdown.map((err: SmsDeliveryError) => {
                        const pct =
                          totalFailed > 0 ? `${((err.count / totalFailed) * 100).toFixed(1)}%` : '—'
                        return (
                          <tr
                            key={err.error_code}
                            className="border-b border-gray-50 last:border-0 hover:bg-gray-50/50"
                          >
                            <td className="py-2.5 pr-4 font-mono text-xs text-ink2">
                              {err.error_code}
                            </td>
                            <td className="py-2.5 pr-4 text-xs text-ink3">{err.error_title}</td>
                            <td className="py-2.5 pr-4 text-xs text-ink text-right">{err.count}</td>
                            <td className="py-2.5 text-xs text-ink3 text-right">{pct}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                )}
              </div>

              {/* Row 5 — Opted-out contacts */}
              <div className="text-sm text-ink3">
                <span className="font-medium text-ink">
                  Opted-Out Contacts: {stats.total_opted_out}
                </span>{' '}
                &mdash;{' '}
                <Link
                  href="/contacts?sms_opt_in=false"
                  className="text-teal-600 hover:underline text-sm"
                >
                  View opted-out contacts →
                </Link>
              </div>
            </>
          )}
        </>
      )}

      {/* ── Email Tab ── */}
      {activeTab === 'email' && (
        <>
          {/* Error state */}
          {emailError && (
            <div
              role="alert"
              className="mb-6 bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-800"
            >
              {emailError}
            </div>
          )}

          {/* Loading skeleton */}
          {emailLoading && !emailStats && (
            <div className="animate-pulse space-y-4">
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="bg-gray-100 rounded-xl h-20" />
                ))}
              </div>
              <div className="bg-gray-100 rounded-xl h-56" />
              <div className="bg-gray-100 rounded-xl h-40" />
            </div>
          )}

          {emailStats && (
            <>
              {/* Row 1 — Alert banner */}
              {(emailStats.alert.level === 'warning' || emailStats.alert.level === 'critical') && (
                <div
                  className={`mb-6 flex items-start gap-3 rounded-lg px-4 py-3 border text-sm ${
                    emailStats.alert.level === 'critical'
                      ? 'bg-red-50 border-red-200 text-red-800'
                      : 'bg-yellow-50 border-yellow-200 text-yellow-800'
                  }`}
                >
                  <span className="text-base leading-none mt-0.5">
                    {emailStats.alert.level === 'critical' ? '🚨' : '⚠'}
                  </span>
                  <span>{emailStats.alert.message ?? ''}</span>
                </div>
              )}

              {/* Row 2 — Stat cards */}
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4 mb-6">
                <StatCard label="Sent" value={emailStats.total_sent} />
                <StatCard label="Delivered" value={emailStats.total_delivered} />
                <StatCard
                  label="Hard Bounced"
                  value={emailStats.total_hard_bounced}
                  highlight={emailStats.hard_bounce_rate > 2}
                />
                <StatCard
                  label="Soft Bounced"
                  value={emailStats.total_soft_bounced}
                  highlight={emailStats.total_soft_bounced > 0}
                  highlightColor="yellow"
                />
                <StatCard
                  label="Complained"
                  value={emailStats.total_complained}
                  highlight={emailStats.complaint_rate > 0.1}
                />
                <StatCard label="Suppressed" value={emailStats.suppressed_contacts} />
              </div>

              {/* Row 3 — 7-day trend chart */}
              <div className="bg-white rounded-xl border border-border-brand p-5 mb-6">
                <h2 className="text-sm font-semibold text-ink mb-4">
                  Delivery Trend — Last 7 Days
                </h2>
                {emailTrendIsEmpty ? (
                  <div className="flex items-center justify-center h-[220px] text-sm text-ink4">
                    No delivery data in the last 7 days
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height={220}>
                    <LineChart
                      data={emailStats.trend_7d}
                      margin={{ top: 4, right: 8, left: 0, bottom: 0 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                      <XAxis
                        dataKey="date"
                        tick={{ fontSize: 11 }}
                        tickLine={false}
                        axisLine={false}
                      />
                      <YAxis
                        allowDecimals={false}
                        tick={{ fontSize: 11 }}
                        tickLine={false}
                        axisLine={false}
                      />
                      <Tooltip />
                      <Legend wrapperStyle={{ fontSize: 12 }} />
                      <Line
                        type="monotone"
                        dataKey="sent"
                        name="Sent"
                        stroke="#0d9488"
                        dot={false}
                        strokeWidth={2}
                      />
                      <Line
                        type="monotone"
                        dataKey="delivered"
                        name="Delivered"
                        stroke="#10b981"
                        dot={false}
                        strokeWidth={2}
                      />
                      <Line
                        type="monotone"
                        dataKey="bounced"
                        name="Bounced"
                        stroke="#ef4444"
                        dot={false}
                        strokeWidth={2}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                )}
              </div>

              {/* Row 4 — Risk breakdown tiles */}
              <div className="grid grid-cols-3 gap-4 mb-6">
                <div className="bg-white rounded-xl border border-border-brand p-4 text-center">
                  <div className="text-2xl font-bold text-green-600">
                    {Math.max(
                      0,
                      emailStats.total_delivered -
                        emailStats.suppressed_contacts -
                        emailStats.at_risk_contacts
                    )}
                  </div>
                  <div className="text-xs text-ink3 mt-1">Healthy Contacts</div>
                </div>
                <div className="bg-white rounded-xl border border-yellow-200 p-4 text-center">
                  <div className="text-2xl font-bold text-yellow-600">
                    {emailStats.at_risk_contacts}
                  </div>
                  <div className="text-xs text-ink3 mt-1">At-Risk Contacts</div>
                </div>
                <div className="bg-white rounded-xl border border-red-200 p-4 text-center">
                  <div className="text-2xl font-bold text-red-600">
                    {emailStats.suppressed_contacts}
                  </div>
                  <div className="text-xs text-ink3 mt-1">Suppressed Contacts</div>
                </div>
              </div>

              {/* Row 5 — Suppressed contacts list */}
              <div className="bg-white rounded-xl border border-border-brand overflow-hidden">
                <div className="px-4 py-3 border-b border-border-brand">
                  <h3 className="text-sm font-semibold text-ink">Suppressed contacts</h3>
                  <p className="text-xs text-ink4 mt-0.5">
                    Excluded from email sends. Reactivating clears the suppression and resets risk
                    score — only do this if you're sure the address is good again.
                  </p>
                </div>
                <table className="w-full text-sm">
                  <thead className="bg-bg2 text-ink3 text-xs uppercase tracking-wide">
                    <tr>
                      <th className="text-left px-4 py-2">Contact</th>
                      <th className="text-left px-4 py-2">Email</th>
                      <th className="text-left px-4 py-2">Reason</th>
                      <th className="px-4 py-2" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border-brand">
                    {suppressed === null ? (
                      <tr>
                        <td colSpan={4} className="px-4 py-6 text-center text-ink4">
                          Loading…
                        </td>
                      </tr>
                    ) : suppressed.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="px-4 py-6 text-center text-ink4">
                          No suppressed contacts.
                        </td>
                      </tr>
                    ) : (
                      suppressed.map((c) => (
                        <tr key={c.id}>
                          <td className="px-4 py-2.5 text-ink font-medium">{c.full_name}</td>
                          <td className="px-4 py-2.5 text-ink3">{c.email}</td>
                          <td className="px-4 py-2.5">
                            <span className="inline-flex px-2 py-0.5 rounded text-xs font-medium bg-red-50 text-red-700">
                              {STATUS_LABEL[c.email_status] ?? c.email_status}
                            </span>
                          </td>
                          <td className="px-4 py-2.5 text-right">
                            <button
                              type="button"
                              onClick={() => void reactivate(c.id)}
                              disabled={reactivatingId === c.id}
                              className="text-xs text-teal-700 hover:underline"
                            >
                              {reactivatingId === c.id ? 'Reactivating…' : 'Reactivate'}
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}
    </div>
  )
}

// ── Stat card ──────────────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  highlight = false,
  highlightColor = 'red',
}: {
  label: string
  value: string | number
  highlight?: boolean
  highlightColor?: 'red' | 'yellow'
}) {
  const highlightClasses =
    highlight && highlightColor === 'yellow'
      ? 'bg-yellow-50 border-yellow-200'
      : highlight
        ? 'bg-red-50 border-red-200'
        : 'bg-white border-border-brand'

  const textClasses =
    highlight && highlightColor === 'yellow'
      ? 'text-yellow-700'
      : highlight
        ? 'text-red-700'
        : 'text-ink'

  return (
    <div className={`rounded-xl border p-4 ${highlightClasses}`}>
      <p className="text-xs text-ink4 mb-1">{label}</p>
      <p className={`text-2xl font-bold leading-none ${textClasses}`}>{value}</p>
    </div>
  )
}
