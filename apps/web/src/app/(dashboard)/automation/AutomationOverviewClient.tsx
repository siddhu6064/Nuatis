'use client'

import { useEffect, useState } from 'react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
import type { AutomationOverview } from '@nuatis/shared'

export default function AutomationOverviewClient() {
  const [data, setData] = useState<AutomationOverview | null>(null)
  const [loading, setLoading] = useState(true)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)

  async function refresh() {
    setLoading(true)
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/automation/overview`, {
        credentials: 'include',
      })
      const json = await res.json()
      setData(json)
      setLastUpdated(new Date())
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
          <BarChart data={enrollments_chart}>
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
                  </tr>
                </thead>
                <tbody>
                  {scanners.map((s) => (
                    <tr
                      key={s.key}
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
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
