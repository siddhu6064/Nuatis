'use client'

import { Fragment, useEffect, useState } from 'react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
import type { AutomationOverview, CustomAutomation } from '@nuatis/shared'

function relativeTime(isoString: string | null): string {
  if (!isoString) return '—'
  const diff = Date.now() - new Date(isoString).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

export default function AutomationOverviewClient() {
  const [data, setData] = useState<AutomationOverview | null>(null)
  const [customAutomations, setCustomAutomations] = useState<CustomAutomation[]>([])
  const [loading, setLoading] = useState(true)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [openScanners, setOpenScanners] = useState<Set<string>>(new Set())
  const [openPauseForm, setOpenPauseForm] = useState<string | null>(null)
  const [pauseForm, setPauseForm] = useState({ paused_from: '', paused_until: '', reason: '' })

  function toggleScanner(key: string) {
    setOpenScanners((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  async function retryFailed(key: string) {
    await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/automation/scanners/${key}/retry-failed`, {
      method: 'POST',
      credentials: 'include',
    })
    void refresh()
  }

  async function clearFailed(key: string) {
    await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/automation/scanners/${key}/clear-failed`, {
      method: 'POST',
      credentials: 'include',
    })
    void refresh()
  }

  async function resumeScanner(key: string) {
    const res = await fetch(
      `${process.env.NEXT_PUBLIC_API_URL}/api/automation/scanners/${key}/pause`,
      {
        method: 'DELETE',
        credentials: 'include',
      }
    )
    if (!res.ok) {
      console.error(`[pause] resume failed: ${res.status}`)
      return
    }
    void refresh()
  }

  async function pauseScanner(key: string) {
    if (!pauseForm.paused_from || !pauseForm.paused_until) return
    const from = new Date(pauseForm.paused_from)
    const until = new Date(pauseForm.paused_until)
    if (until <= from) return
    const res = await fetch(
      `${process.env.NEXT_PUBLIC_API_URL}/api/automation/scanners/${key}/pause`,
      {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          paused_from: from.toISOString(),
          paused_until: until.toISOString(),
          ...(pauseForm.reason ? { reason: pauseForm.reason } : {}),
        }),
      }
    )
    if (!res.ok) {
      console.error(`[pause] pause failed: ${res.status}`)
      return
    }
    setOpenPauseForm(null)
    setPauseForm({ paused_from: '', paused_until: '', reason: '' })
    void refresh()
  }

  async function refresh() {
    setLoading(true)
    try {
      const [overviewRes, customRes] = await Promise.all([
        fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/automation/overview`, { credentials: 'include' }),
        fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/custom-automations`, { credentials: 'include' }),
      ])
      if (!overviewRes.ok) throw new Error(`HTTP ${overviewRes.status}`)
      const json = (await overviewRes.json()) as AutomationOverview
      setData(json)
      setLastUpdated(new Date())
      if (customRes.ok) {
        const customJson = await customRes.json() as { automations: CustomAutomation[] }
        setCustomAutomations(customJson.automations)
      }
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    refresh()
  }, [])

  if (loading) {
    return (
      <div className="space-y-4 animate-pulse">
        {/* Stats row skeleton */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="bg-white rounded-xl border border-border-brand p-5">
              <div className="h-3 bg-gray-200 rounded w-24 mb-4" />
              <div className="h-7 bg-gray-200 rounded w-12" />
            </div>
          ))}
        </div>
        {/* Chart skeleton */}
        <div className="bg-white rounded-xl border border-border-brand p-6">
          <div className="h-4 bg-gray-200 rounded w-56 mb-4" />
          <div className="h-[220px] bg-gray-100 rounded" />
        </div>
        {/* Bottom row skeleton */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="bg-white rounded-xl border border-border-brand p-6 h-48">
            <div className="h-4 bg-gray-200 rounded w-40 mb-4" />
            <div className="space-y-3">
              {[...Array(3)].map((_, i) => (
                <div key={i} className="h-3 bg-gray-200 rounded w-full" />
              ))}
            </div>
          </div>
          <div className="bg-white rounded-xl border border-border-brand h-48">
            <div className="px-6 py-4 border-b border-border-brand">
              <div className="h-4 bg-gray-200 rounded w-32" />
            </div>
            <div className="p-6 space-y-3">
              {[...Array(3)].map((_, i) => (
                <div key={i} className="h-3 bg-gray-200 rounded w-full" />
              ))}
            </div>
          </div>
        </div>
      </div>
    )
  }

  if (!data) {
    return (
      <div className="bg-white rounded-xl border border-border-brand p-12 text-center">
        <p className="text-sm text-ink4">Failed to load automation overview.</p>
        <button
          onClick={refresh}
          className="mt-3 text-xs text-teal-600 hover:text-teal-700 underline"
        >
          Try again
        </button>
      </div>
    )
  }

  const { scanners, enrollments_chart, trigger_analysis, total_active, total_paused } = data
  const errorCount = scanners.filter((s) => s.status === 'error').length
  const { attempted, matched, unmatched } = trigger_analysis
  const matchedPct = attempted > 0 ? (matched / attempted) * 100 : 0
  const unmatchedPct = attempted > 0 ? (unmatched / attempted) * 100 : 0

  return (
    <div>
      {/* Refresh / last updated */}
      <div className="flex items-center justify-end mb-4">
        <button
          onClick={refresh}
          className="text-xs text-ink3 hover:text-ink flex items-center gap-1"
        >
          ↻ Refresh
        </button>
        {lastUpdated && (
          <span className="text-xs text-ink4 ml-2">Updated {lastUpdated.toLocaleTimeString()}</span>
        )}
      </div>

      {/* Top stats row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
        {/* Total Scanners */}
        <div className="bg-white rounded-xl border border-border-brand p-5 relative">
          <p className="text-xs text-ink4 mb-1">Total Scanners</p>
          <p className="text-2xl font-bold text-ink">{scanners.length}</p>
          <span className="absolute top-4 right-4 inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-teal-50 text-teal-600">
            total
          </span>
        </div>

        {/* Active */}
        <div className="bg-white rounded-xl border border-border-brand p-5 relative">
          <p className="text-xs text-ink4 mb-1">Active</p>
          <p className="text-2xl font-bold text-ink">{total_active}</p>
          <span className="absolute top-4 right-4 inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-50 text-green-700">
            running
          </span>
        </div>

        {/* Paused */}
        <div className="bg-white rounded-xl border border-border-brand p-5 relative">
          <p className="text-xs text-ink4 mb-1">Paused</p>
          <p className="text-2xl font-bold text-ink">{total_paused}</p>
          <span className="absolute top-4 right-4 inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-amber-50 text-amber-700">
            paused
          </span>
        </div>

        {/* Errors */}
        <div className="bg-white rounded-xl border border-border-brand p-5 relative">
          <p className="text-xs text-ink4 mb-1">Errors</p>
          <p className="text-2xl font-bold text-ink">{errorCount}</p>
          <span className="absolute top-4 right-4 inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-red-50 text-red-700">
            errors
          </span>
        </div>
      </div>

      {/* Enrollments Chart */}
      <div className="bg-white rounded-xl border border-border-brand p-6 mb-4">
        <h2 className="text-sm font-semibold text-ink mb-4">Automation Activity — Last 7 Weeks</h2>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={[...enrollments_chart].reverse()}>
            <XAxis dataKey="week" tick={{ fontSize: 11 }} stroke="#9ca3af" />
            <YAxis tick={{ fontSize: 11 }} stroke="#9ca3af" allowDecimals={false} />
            <Tooltip />
            <Bar dataKey="count" fill="#0d9488" radius={[2, 2, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Bottom two-column row */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Trigger Analysis */}
        <div className="bg-white rounded-xl border border-border-brand p-6">
          <h2 className="text-sm font-semibold text-ink mb-4">Trigger Analysis — Last 30 Days</h2>

          {/* Attempted */}
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm text-ink3">Attempted</span>
            <span className="text-sm font-semibold text-ink">{attempted}</span>
          </div>
          <div className="w-full bg-gray-100 rounded-full h-1.5 mb-4">
            <div className="h-1.5 rounded-full bg-teal-500" style={{ width: '100%' }} />
          </div>

          {/* Matched */}
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm text-ink3">Matched</span>
            <span className="text-sm font-semibold text-ink">{matched}</span>
          </div>
          <div className="w-full bg-gray-100 rounded-full h-1.5 mb-4">
            <div className="h-1.5 rounded-full bg-green-500" style={{ width: `${matchedPct}%` }} />
          </div>

          {/* Unmatched */}
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm text-ink3">Unmatched</span>
            <span className="text-sm font-semibold text-ink">{unmatched}</span>
          </div>
          <div className="w-full bg-gray-100 rounded-full h-1.5 mb-4">
            <div
              className="h-1.5 rounded-full bg-amber-500"
              style={{ width: `${unmatchedPct}%` }}
            />
          </div>
        </div>

        {/* Scanner Health */}
        <div className="bg-white rounded-xl border border-border-brand">
          <div className="px-6 py-4 border-b border-border-brand">
            <h2 className="text-sm font-semibold text-ink">Scanner Health</h2>
          </div>
          {scanners.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <p className="text-sm text-ink4">No scanners configured</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border-brand">
                    <th className="text-left text-xs font-medium text-ink4 px-6 py-3">Scanner</th>
                    <th className="text-left text-xs font-medium text-ink4 px-6 py-3">Status</th>
                    <th className="text-left text-xs font-medium text-ink4 px-6 py-3">Last Run</th>
                    <th className="text-left text-xs font-medium text-ink4 px-4 py-3">Failures</th>
                    <th className="text-left text-xs font-medium text-ink4 px-4 py-3">
                      Last Error
                    </th>
                    <th className="text-left text-xs font-medium text-ink4 px-4 py-3">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {scanners.map((s) => (
                    <Fragment key={s.key}>
                      <tr
                        className={`border-b border-gray-50 last:border-0 ${
                          s.failure_count > 0 ? 'bg-red-50/40' : ''
                        }`}
                      >
                        <td className="px-6 py-3 font-medium text-ink">{s.name}</td>
                        <td className="px-6 py-3">
                          <span
                            className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                              s.status === 'active'
                                ? 'bg-green-50 text-green-700'
                                : s.status === 'paused'
                                  ? 'bg-amber-50 text-amber-700'
                                  : 'bg-red-50 text-red-700'
                            }`}
                          >
                            {s.status}
                          </span>
                        </td>
                        <td className="px-6 py-3 text-ink3">
                          {s.last_run_at ? new Date(s.last_run_at).toLocaleString() : '—'}
                        </td>
                        <td className="px-4 py-3 text-ink3">{s.failure_count}</td>
                        <td className="px-4 py-3 text-ink4 text-xs truncate max-w-[200px]">
                          {s.last_error ? (
                            s.last_error.slice(0, 60)
                          ) : (
                            <span className="text-green-600">No errors</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          {s.is_paused ? (
                            <div className="flex items-center gap-2 flex-wrap">
                              {s.pause_until && (
                                <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-amber-50 text-amber-700">
                                  Paused until {new Date(s.pause_until ?? '').toLocaleString()}
                                </span>
                              )}
                              <button
                                onClick={() => void resumeScanner(s.key)}
                                className="text-xs px-3 py-1.5 rounded-lg bg-gray-100 text-ink3 hover:bg-gray-200 font-medium transition-colors"
                              >
                                Resume
                              </button>
                            </div>
                          ) : (
                            <button
                              onClick={() =>
                                setOpenPauseForm(openPauseForm === s.key ? null : s.key)
                              }
                              className="text-xs px-3 py-1.5 rounded-lg bg-amber-50 text-amber-600 hover:bg-amber-100 font-medium transition-colors"
                            >
                              Pause
                            </button>
                          )}
                        </td>
                      </tr>
                      {openPauseForm === s.key && (
                        <tr key={`${s.key}-pause-form`}>
                          <td
                            colSpan={6}
                            className="px-6 py-4 bg-amber-50/50 border-b border-amber-100"
                          >
                            <div className="flex items-center gap-3 flex-wrap">
                              <div className="flex flex-col gap-1">
                                <label className="text-xs text-ink4 font-medium">From</label>
                                <input
                                  type="datetime-local"
                                  value={pauseForm.paused_from}
                                  onChange={(e) =>
                                    setPauseForm((f) => ({ ...f, paused_from: e.target.value }))
                                  }
                                  className="text-xs border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-amber-400"
                                />
                              </div>
                              <div className="flex flex-col gap-1">
                                <label className="text-xs text-ink4 font-medium">Until</label>
                                <input
                                  type="datetime-local"
                                  value={pauseForm.paused_until}
                                  onChange={(e) =>
                                    setPauseForm((f) => ({ ...f, paused_until: e.target.value }))
                                  }
                                  className="text-xs border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-amber-400"
                                />
                              </div>
                              <div className="flex flex-col gap-1">
                                <label className="text-xs text-ink4 font-medium">Reason</label>
                                <input
                                  type="text"
                                  placeholder="Optional reason"
                                  value={pauseForm.reason}
                                  onChange={(e) =>
                                    setPauseForm((f) => ({ ...f, reason: e.target.value }))
                                  }
                                  className="text-xs border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-amber-400 w-48"
                                />
                              </div>
                              <div className="flex items-end gap-2 mt-4">
                                <button
                                  onClick={() => void pauseScanner(s.key)}
                                  disabled={
                                    !pauseForm.paused_from ||
                                    !pauseForm.paused_until ||
                                    new Date(pauseForm.paused_until) <=
                                      new Date(pauseForm.paused_from)
                                  }
                                  className="text-xs px-3 py-1.5 rounded-lg bg-amber-600 text-white hover:bg-amber-700 font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                                >
                                  Pause Scanner
                                </button>
                                <button
                                  onClick={() => {
                                    setOpenPauseForm(null)
                                    setPauseForm({ paused_from: '', paused_until: '', reason: '' })
                                  }}
                                  className="text-xs px-3 py-1.5 rounded-lg bg-gray-100 text-ink3 hover:bg-gray-200 font-medium transition-colors"
                                >
                                  Cancel
                                </button>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Error Review */}
      <div className="mt-4">
        <div className="flex items-center gap-2 mb-3">
          <h2 className="text-sm font-semibold text-ink">Error Review</h2>
          {scanners.some((s) => s.failure_count > 0) ? (
            <>
              <span className="w-2 h-2 rounded-full bg-red-500 inline-block" />
              <span className="text-xs text-red-600 font-medium">
                {scanners.reduce((sum, s) => sum + s.failure_count, 0)} failed jobs
              </span>
            </>
          ) : null}
        </div>

        {!scanners.some((s) => s.failure_count > 0) ? (
          <div className="bg-white rounded-xl border border-border-brand px-6 py-4 flex items-center gap-3">
            <span className="text-green-500 text-lg">✓</span>
            <span className="text-sm text-ink3">All scanners healthy — no failed jobs</span>
          </div>
        ) : (
          <div className="space-y-2">
            {scanners
              .filter((s) => s.failure_count > 0)
              .map((s) => {
                const isOpen = openScanners.has(s.key)
                return (
                  <div
                    key={s.key}
                    className="bg-white rounded-xl border border-border-brand overflow-hidden"
                  >
                    {/* Accordion header */}
                    <button
                      onClick={() => toggleScanner(s.key)}
                      className="w-full flex items-center justify-between px-6 py-4 hover:bg-gray-50/50 transition-colors"
                    >
                      <div className="flex items-center gap-3">
                        <span className="text-sm font-medium text-ink">{s.name}</span>
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-red-50 text-red-700">
                          {s.failure_count} failed
                        </span>
                      </div>
                      <span className="text-ink4 text-xs">{isOpen ? '▲' : '▼'}</span>
                    </button>

                    {/* Accordion body */}
                    {isOpen && (
                      <div className="border-t border-border-brand">
                        {s.failed_jobs.length === 0 ? (
                          <p className="px-6 py-4 text-sm text-ink4">No job details available.</p>
                        ) : (
                          <table className="w-full text-xs">
                            <thead>
                              <tr className="border-b border-gray-100 bg-gray-50/50">
                                <th className="text-left font-medium text-ink4 px-6 py-2">
                                  Job ID
                                </th>
                                <th className="text-left font-medium text-ink4 px-4 py-2">
                                  Failed At
                                </th>
                                <th className="text-left font-medium text-ink4 px-4 py-2">
                                  Attempts
                                </th>
                                <th className="text-left font-medium text-ink4 px-4 py-2">Error</th>
                              </tr>
                            </thead>
                            <tbody>
                              {s.failed_jobs.map((job) => (
                                <tr key={job.id} className="border-b border-gray-50 last:border-0">
                                  <td className="px-6 py-3 font-mono text-ink3">
                                    {job.id.slice(0, 12)}
                                  </td>
                                  <td className="px-4 py-3 text-ink3">
                                    {relativeTime(job.failed_at)}
                                  </td>
                                  <td className="px-4 py-3 text-ink3">{job.attempt_count}</td>
                                  <td className="px-4 py-3">
                                    <div className="bg-red-50 rounded px-2 py-1 font-mono text-red-700 break-words whitespace-pre-wrap max-w-xs">
                                      {job.error_message}
                                    </div>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}
                        <div className="px-6 py-3 flex gap-2 border-t border-gray-100">
                          <button
                            onClick={() => void retryFailed(s.key)}
                            className="text-xs px-3 py-1.5 rounded-lg bg-teal-50 text-teal-700 hover:bg-teal-100 font-medium transition-colors"
                          >
                            Retry All
                          </button>
                          <button
                            onClick={() => void clearFailed(s.key)}
                            className="text-xs px-3 py-1.5 rounded-lg bg-gray-100 text-ink3 hover:bg-gray-200 font-medium transition-colors"
                          >
                            Clear Failed
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
          </div>
        )}
      </div>

      {/* Custom Automations */}
      <div className="mt-4">
        <h2 className="text-sm font-semibold text-ink mb-3">Custom Automations</h2>
        {customAutomations.length === 0 ? (
          <div className="bg-white rounded-xl border border-border-brand px-6 py-4 text-sm text-ink4">
            No custom automations yet.{' '}
            <span className="text-teal-600">Create one in the Custom tab.</span>
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-border-brand overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border-brand bg-gray-50/50">
                  <th className="text-left text-xs font-medium text-ink4 px-6 py-3">Name</th>
                  <th className="text-left text-xs font-medium text-ink4 px-4 py-3">Trigger</th>
                  <th className="text-left text-xs font-medium text-ink4 px-4 py-3">Action</th>
                  <th className="text-left text-xs font-medium text-ink4 px-4 py-3">Status</th>
                  <th className="text-left text-xs font-medium text-ink4 px-4 py-3">Runs</th>
                  <th className="text-left text-xs font-medium text-ink4 px-4 py-3">Last Run</th>
                </tr>
              </thead>
              <tbody>
                {customAutomations.map((a) => (
                  <tr key={a.id} className="border-b border-gray-50 last:border-0">
                    <td className="px-6 py-3 font-medium text-ink">{a.name}</td>
                    <td className="px-4 py-3 text-ink3 capitalize">{a.trigger_type.replace(/_/g, ' ')}</td>
                    <td className="px-4 py-3 text-ink3 capitalize">{a.action_type.replace(/_/g, ' ')}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                        a.status === 'active' ? 'bg-green-50 text-green-700' :
                        a.status === 'paused' ? 'bg-amber-50 text-amber-700' :
                        'bg-gray-100 text-ink4'
                      }`}>
                        {a.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-ink3">{a.run_count}</td>
                    <td className="px-4 py-3 text-ink3">{relativeTime(a.last_run_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
