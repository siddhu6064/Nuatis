'use client'

import { useState, useEffect, useCallback } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter, useParams } from 'next/navigation'
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts'

const apiUrl = process.env['NEXT_PUBLIC_API_URL'] || 'http://localhost:3001'

const COLORS = [
  '#3b82f6',
  '#22c55e',
  '#f59e0b',
  '#ef4444',
  '#8b5cf6',
  '#ec4899',
  '#14b8a6',
  '#f97316',
]

// ─── Types ────────────────────────────────────────────────────────────────────

type ChartType = 'bar' | 'line' | 'pie' | 'table' | 'number'

interface ReportConfig {
  id: string
  name: string
  description: string | null
  object: string
  metric_fn: string
  metric_field: string | null
  group_by: string | null
  filters: { field: string; operator: string; value: string }[]
  date_range: string
  date_from: string | null
  date_to: string | null
  chart_type: ChartType
  pinned: boolean
  last_run: string | null
  created_at: string
}

interface ReportRow {
  label: string
  value: number
  count?: number
}

interface ReportResult {
  rows: ReportRow[]
  total: number
  generated_at: string
}

const DATE_RANGE_OPTIONS = [
  { key: 'last_7_days', label: 'Last 7 days' },
  { key: 'last_30_days', label: 'Last 30 days' },
  { key: 'last_90_days', label: 'Last 90 days' },
  { key: 'this_month', label: 'This month' },
  { key: 'last_month', label: 'Last month' },
  { key: 'this_year', label: 'This year' },
  { key: 'all_time', label: 'All time' },
  { key: 'custom', label: 'Custom' },
]

// ─── Main Component ────────────────────────────────────────────────────────────

export default function ReportDetailPage() {
  const { data: session } = useSession()
  const router = useRouter()
  const params = useParams()
  const id = params?.id as string

  const token = (session as unknown as Record<string, unknown>)?.accessToken ?? ''
  const authHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token as string}` } : {}),
  }

  const [report, setReport] = useState<ReportConfig | null>(null)
  const [result, setResult] = useState<ReportResult | null>(null)
  const [loadingReport, setLoadingReport] = useState(true)
  const [loadingData, setLoadingData] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [dateRange, setDateRange] = useState<string>('')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')
  const [toast, setToast] = useState<{ type: 'success' | 'error'; msg: string } | null>(null)

  function showToast(type: 'success' | 'error', msg: string) {
    setToast({ type, msg })
    setTimeout(() => setToast(null), 4000)
  }

  const fetchReport = useCallback(async () => {
    if (!token || !id) return
    setLoadingReport(true)
    try {
      const res = await fetch(`${apiUrl}/api/reports/${id}`, { headers: authHeaders })
      if (res.ok) {
        const data = await res.json()
        const cfg: ReportConfig = data.report ?? data
        setReport(cfg)
        setDateRange(cfg.date_range)
        if (cfg.date_from) setCustomFrom(cfg.date_from)
        if (cfg.date_to) setCustomTo(cfg.date_to)
      } else {
        showToast('error', 'Report not found')
        router.push('/reports')
      }
    } catch {
      showToast('error', 'Failed to load report')
    } finally {
      setLoadingReport(false)
    }
  }, [token, id])

  const fetchData = useCallback(async () => {
    if (!token || !id) return
    setLoadingData(true)
    try {
      const params = new URLSearchParams({ date_range: dateRange })
      if (dateRange === 'custom') {
        if (customFrom) params.set('date_from', customFrom)
        if (customTo) params.set('date_to', customTo)
      }
      const res = await fetch(`${apiUrl}/api/reports/${id}/data?${params.toString()}`, {
        headers: authHeaders,
      })
      if (res.ok) {
        const data = await res.json()
        setResult(data)
      }
    } catch {
      // silently fail
    } finally {
      setLoadingData(false)
    }
  }, [token, id, dateRange, customFrom, customTo])

  useEffect(() => {
    if (token) fetchReport()
  }, [token, fetchReport])

  useEffect(() => {
    if (token && dateRange) fetchData()
  }, [token, dateRange, fetchData])

  async function handleRefresh() {
    setRefreshing(true)
    try {
      await fetch(`${apiUrl}/api/reports/${id}/refresh`, {
        method: 'POST',
        headers: authHeaders,
      })
      await fetchData()
      showToast('success', 'Report refreshed')
    } catch {
      showToast('error', 'Failed to refresh')
    } finally {
      setRefreshing(false)
    }
  }

  async function handleTogglePin() {
    if (!report) return
    try {
      const res = await fetch(`${apiUrl}/api/reports/${id}/pin`, {
        method: 'PUT',
        headers: authHeaders,
      })
      if (res.ok) {
        const data = await res.json()
        setReport((r) => (r ? { ...r, pinned: data.pinned ?? !r.pinned } : r))
        showToast('success', data.pinned ? 'Pinned to dashboard' : 'Unpinned from dashboard')
      }
    } catch {
      showToast('error', 'Failed to update pin')
    }
  }

  function handleExportCSV() {
    if (!result?.rows?.length) return
    const header = 'Label,Value,Count'
    const rows = result.rows.map(
      (r) => `"${r.label.replace(/"/g, '""')}",${r.value},${r.count ?? ''}`
    )
    const csv = [header, ...rows].join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${report?.name ?? 'report'}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  // ─── Chart Rendering ───────────────────────────────────────────────────────

  function renderChart() {
    if (!result?.rows?.length) {
      return (
        <div className="flex items-center justify-center h-48 text-gray-400 text-sm">
          No data available for the selected date range.
        </div>
      )
    }

    const chartData = result.rows.map((r) => ({ label: r.label, value: r.value }))
    const chartType = report?.chart_type ?? 'bar'

    if (chartType === 'number') {
      const total = result.total ?? result.rows.reduce((acc, r) => acc + r.value, 0)
      return (
        <div className="flex flex-col items-center justify-center h-48">
          <div className="text-6xl font-bold text-blue-600">
            {typeof total === 'number' ? total.toLocaleString() : total}
          </div>
          <div className="text-sm text-gray-500 mt-2">{report?.name}</div>
        </div>
      )
    }

    if (chartType === 'table') {
      const sorted = [...result.rows].sort((a, b) => b.value - a.value)
      return (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200">
                <th className="text-left py-2 px-3 text-gray-500 font-medium">Label</th>
                <th className="text-right py-2 px-3 text-gray-500 font-medium">Value</th>
                {sorted[0]?.count !== undefined && (
                  <th className="text-right py-2 px-3 text-gray-500 font-medium">Count</th>
                )}
              </tr>
            </thead>
            <tbody>
              {sorted.map((row, i) => (
                <tr key={i} className="border-b border-gray-100 hover:bg-gray-50">
                  <td className="py-2 px-3 text-gray-700">{row.label}</td>
                  <td className="py-2 px-3 text-right text-gray-900 font-medium tabular-nums">
                    {row.value.toLocaleString()}
                  </td>
                  {row.count !== undefined && (
                    <td className="py-2 px-3 text-right text-gray-500 tabular-nums">{row.count}</td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )
    }

    if (chartType === 'pie') {
      return (
        <ResponsiveContainer width="100%" height={300}>
          <PieChart>
            <Pie
              data={chartData}
              dataKey="value"
              nameKey="label"
              cx="50%"
              cy="50%"
              outerRadius={110}
              label={({ name, percent }) =>
                `${String(name || '')} (${(Number(percent || 0) * 100).toFixed(0)}%)`
              }
            >
              {chartData.map((_, index) => (
                <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
              ))}
            </Pie>
            <Tooltip formatter={(value) => String(Number(value).toLocaleString())} />
          </PieChart>
        </ResponsiveContainer>
      )
    }

    if (chartType === 'line') {
      return (
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="label" tick={{ fontSize: 11 }} />
            <YAxis />
            <Tooltip formatter={(value) => String(Number(value).toLocaleString())} />
            <Line type="monotone" dataKey="value" stroke="#3b82f6" strokeWidth={2} dot={{ r: 4 }} />
          </LineChart>
        </ResponsiveContainer>
      )
    }

    // default: bar
    return (
      <ResponsiveContainer width="100%" height={300}>
        <BarChart data={chartData}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="label" tick={{ fontSize: 11 }} />
          <YAxis />
          <Tooltip formatter={(value) => String(Number(value).toLocaleString())} />
          <Bar dataKey="value" fill="#3b82f6" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    )
  }

  // ─── Render ────────────────────────────────────────────────────────────────

  if (loadingReport) {
    return (
      <div className="px-8 py-8 max-w-5xl">
        <div className="py-16 text-center text-gray-400 text-sm">Loading report…</div>
      </div>
    )
  }

  if (!report) return null

  return (
    <div className="px-8 py-8 max-w-5xl space-y-6">
      {/* Toast */}
      {toast && (
        <div
          className={`fixed top-4 right-4 z-50 px-4 py-3 rounded-lg shadow-lg text-sm font-medium ${
            toast.type === 'success'
              ? 'bg-green-50 text-green-800 border border-green-200'
              : 'bg-red-50 text-red-800 border border-red-200'
          }`}
        >
          {toast.msg}
        </div>
      )}

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <button
              onClick={() => router.push('/reports')}
              className="text-gray-400 hover:text-gray-600 text-sm"
            >
              ← Reports
            </button>
          </div>
          <h1 className="text-2xl font-bold text-gray-900">{report.name}</h1>
          {report.description && <p className="text-sm text-gray-500 mt-1">{report.description}</p>}
          {report.last_run && (
            <p className="text-xs text-gray-400 mt-1">
              Last run{' '}
              {new Date(report.last_run).toLocaleString('en-US', {
                month: 'short',
                day: 'numeric',
                year: 'numeric',
                hour: 'numeric',
                minute: '2-digit',
                hour12: true,
              })}
            </p>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
          <button
            onClick={handleTogglePin}
            className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border text-sm font-medium transition-colors ${
              report.pinned
                ? 'bg-yellow-50 text-yellow-700 border-yellow-200 hover:bg-yellow-100'
                : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
            }`}
          >
            <span>{report.pinned ? '★' : '☆'}</span>
            {report.pinned ? 'Pinned' : 'Pin to Dashboard'}
          </button>

          <button
            onClick={handleRefresh}
            disabled={refreshing || loadingData}
            className="inline-flex items-center gap-1.5 px-3 py-2 bg-white border border-gray-200 text-gray-600 text-sm font-medium rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50"
          >
            {refreshing ? 'Refreshing…' : '↻ Refresh'}
          </button>

          <button
            onClick={handleExportCSV}
            disabled={!result?.rows?.length}
            className="inline-flex items-center gap-1.5 px-3 py-2 bg-white border border-gray-200 text-gray-600 text-sm font-medium rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50"
          >
            ↓ Export CSV
          </button>

          <button
            onClick={() => router.push('/reports')}
            className="inline-flex items-center gap-1.5 px-3 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
          >
            Edit Report
          </button>
        </div>
      </div>

      {/* Date Range Selector */}
      <div className="flex items-center gap-3 flex-wrap">
        <label className="text-sm font-medium text-gray-600">Date Range:</label>
        <select
          value={dateRange}
          onChange={(e) => setDateRange(e.target.value)}
          className="text-sm border border-gray-300 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white"
        >
          {DATE_RANGE_OPTIONS.map((opt) => (
            <option key={opt.key} value={opt.key}>
              {opt.label}
            </option>
          ))}
        </select>

        {dateRange === 'custom' && (
          <>
            <input
              type="date"
              value={customFrom}
              onChange={(e) => setCustomFrom(e.target.value)}
              className="text-sm border border-gray-300 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-400"
            />
            <span className="text-gray-400 text-sm">to</span>
            <input
              type="date"
              value={customTo}
              onChange={(e) => setCustomTo(e.target.value)}
              className="text-sm border border-gray-300 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-400"
            />
          </>
        )}
      </div>

      {/* Chart */}
      <div className="bg-white border border-gray-200 rounded-xl p-6">
        {loadingData ? (
          <div className="flex items-center justify-center h-48 text-gray-400 text-sm">
            Loading chart data…
          </div>
        ) : (
          renderChart()
        )}
      </div>

      {/* Data Table */}
      {result?.rows && result.rows.length > 0 && report.chart_type !== 'table' && (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100">
            <h2 className="text-sm font-semibold text-gray-700">Data</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="text-left py-2.5 px-4 text-gray-500 font-medium">Label</th>
                  <th className="text-right py-2.5 px-4 text-gray-500 font-medium">Value</th>
                  {result.rows[0]?.count !== undefined && (
                    <th className="text-right py-2.5 px-4 text-gray-500 font-medium">Count</th>
                  )}
                </tr>
              </thead>
              <tbody>
                {[...result.rows]
                  .sort((a, b) => b.value - a.value)
                  .map((row, i) => (
                    <tr key={i} className="border-b border-gray-100 hover:bg-gray-50">
                      <td className="py-2.5 px-4 text-gray-700">{row.label}</td>
                      <td className="py-2.5 px-4 text-right text-gray-900 font-medium tabular-nums">
                        {row.value.toLocaleString()}
                      </td>
                      {row.count !== undefined && (
                        <td className="py-2.5 px-4 text-right text-gray-500 tabular-nums">
                          {row.count}
                        </td>
                      )}
                    </tr>
                  ))}
              </tbody>
              {result.total !== undefined && (
                <tfoot>
                  <tr className="bg-gray-50 border-t-2 border-gray-200">
                    <td className="py-2.5 px-4 font-semibold text-gray-700">Total</td>
                    <td className="py-2.5 px-4 text-right font-bold text-gray-900 tabular-nums">
                      {result.total.toLocaleString()}
                    </td>
                    {result.rows[0]?.count !== undefined && <td />}
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
