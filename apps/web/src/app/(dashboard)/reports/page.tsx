'use client'

import { useState, useEffect, useCallback } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'

// ─── Types ────────────────────────────────────────────────────────────────────

type ChartType = 'bar' | 'line' | 'pie' | 'table' | 'number'
type MetricFn = 'count' | 'sum' | 'avg' | 'min' | 'max'
type DataObject = 'contacts' | 'appointments' | 'deals' | 'quotes' | 'activity_log' | 'tasks'

interface ReportFilter {
  field: string
  operator: 'equals' | 'not_equals' | 'contains' | 'gt' | 'lt'
  value: string
}

interface Report {
  id: string
  name: string
  description: string | null
  object: DataObject
  metric_fn: MetricFn
  metric_field: string | null
  group_by: string | null
  filters: ReportFilter[]
  date_range: string
  date_from: string | null
  date_to: string | null
  chart_type: ChartType
  pinned: boolean
  last_run: string | null
  created_at: string
}

interface WizardState {
  object: DataObject | null
  metric_fn: MetricFn
  metric_field: string | null
  group_by: string | null
  filters: ReportFilter[]
  date_range: string
  date_from: string
  date_to: string
  chart_type: ChartType
  name: string
  description: string
}

// ─── Static Config ─────────────────────────────────────────────────────────────

const OBJECTS: { key: DataObject; label: string; icon: string; description: string }[] = [
  { key: 'contacts', label: 'Contacts', icon: '👤', description: 'People in your CRM' },
  { key: 'appointments', label: 'Appointments', icon: '📅', description: 'Scheduled meetings' },
  { key: 'deals', label: 'Deals', icon: '🤝', description: 'Pipeline opportunities' },
  { key: 'quotes', label: 'Quotes', icon: '📄', description: 'Proposals sent to clients' },
  { key: 'activity_log', label: 'Activity Log', icon: '📋', description: 'All logged activities' },
  { key: 'tasks', label: 'Tasks', icon: '✅', description: 'To-dos and follow-ups' },
]

const METRIC_FIELDS: Record<DataObject, { key: string; label: string }[]> = {
  contacts: [{ key: 'lead_score', label: 'Lead Score' }],
  appointments: [],
  deals: [
    { key: 'deal_value', label: 'Deal Value' },
    { key: 'probability', label: 'Probability' },
  ],
  quotes: [{ key: 'total', label: 'Quote Total' }],
  activity_log: [],
  tasks: [],
}

const GROUP_BY_FIELDS: Record<DataObject, { key: string; label: string }[]> = {
  contacts: [
    { key: 'lifecycle_stage', label: 'Lifecycle Stage' },
    { key: 'lead_grade', label: 'Lead Grade' },
    { key: 'source', label: 'Source' },
    { key: 'territory', label: 'Territory' },
    { key: 'assigned_to', label: 'Assigned To' },
    { key: 'month_created', label: 'Month Created' },
  ],
  appointments: [
    { key: 'status', label: 'Status' },
    { key: 'month', label: 'Month' },
  ],
  deals: [
    { key: 'pipeline_stage', label: 'Pipeline Stage' },
    { key: 'won_lost', label: 'Won/Lost' },
    { key: 'assigned_to', label: 'Assigned To' },
    { key: 'close_month', label: 'Close Month' },
  ],
  quotes: [
    { key: 'status', label: 'Status' },
    { key: 'month', label: 'Month' },
  ],
  activity_log: [
    { key: 'activity_type', label: 'Activity Type' },
    { key: 'actor', label: 'Actor' },
    { key: 'month', label: 'Month' },
  ],
  tasks: [
    { key: 'priority', label: 'Priority' },
    { key: 'completed_open', label: 'Completed/Open' },
    { key: 'assigned_to', label: 'Assigned To' },
  ],
}

const FILTER_FIELDS: Record<DataObject, { key: string; label: string }[]> = {
  contacts: [
    { key: 'lifecycle_stage', label: 'Lifecycle Stage' },
    { key: 'source', label: 'Source' },
    { key: 'lead_grade', label: 'Lead Grade' },
    { key: 'assigned_to', label: 'Assigned To' },
  ],
  appointments: [
    { key: 'status', label: 'Status' },
    { key: 'assigned_to', label: 'Assigned To' },
  ],
  deals: [
    { key: 'pipeline_stage', label: 'Pipeline Stage' },
    { key: 'status', label: 'Status' },
    { key: 'assigned_to', label: 'Assigned To' },
  ],
  quotes: [
    { key: 'status', label: 'Status' },
    { key: 'created_by', label: 'Created By' },
  ],
  activity_log: [
    { key: 'activity_type', label: 'Activity Type' },
    { key: 'actor', label: 'Actor' },
  ],
  tasks: [
    { key: 'priority', label: 'Priority' },
    { key: 'status', label: 'Status' },
    { key: 'assigned_to', label: 'Assigned To' },
  ],
}

const DATE_RANGE_PRESETS = [
  { key: 'last_7_days', label: 'Last 7 days' },
  { key: 'last_30_days', label: 'Last 30 days' },
  { key: 'last_90_days', label: 'Last 90 days' },
  { key: 'this_month', label: 'This month' },
  { key: 'last_month', label: 'Last month' },
  { key: 'this_year', label: 'This year' },
  { key: 'all_time', label: 'All time' },
  { key: 'custom', label: 'Custom range' },
]

const CHART_TYPES: { key: ChartType; label: string; icon: string }[] = [
  { key: 'bar', label: 'Bar Chart', icon: '📊' },
  { key: 'line', label: 'Line Chart', icon: '📈' },
  { key: 'pie', label: 'Pie Chart', icon: '🥧' },
  { key: 'table', label: 'Table', icon: '📋' },
  { key: 'number', label: 'Single Number', icon: '🔢' },
]

const OPERATOR_LABELS: Record<string, string> = {
  equals: 'equals',
  not_equals: 'not equals',
  contains: 'contains',
  gt: 'greater than',
  lt: 'less than',
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

function getObjectMeta(key: DataObject) {
  return OBJECTS.find((o) => o.key === key)
}

const DEFAULT_WIZARD: WizardState = {
  object: null,
  metric_fn: 'count',
  metric_field: null,
  group_by: null,
  filters: [],
  date_range: 'last_30_days',
  date_from: '',
  date_to: '',
  chart_type: 'bar',
  name: '',
  description: '',
}

// ─── Main Component ────────────────────────────────────────────────────────────

export default function ReportsPage() {
  const { data: session } = useSession()
  const router = useRouter()

  const token = (session as unknown as Record<string, unknown>)?.accessToken ?? ''
  const authHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token as string}` } : {}),
  }

  const [reports, setReports] = useState<Report[]>([])
  const [loading, setLoading] = useState(true)
  const [showWizard, setShowWizard] = useState(false)
  const [wizardStep, setWizardStep] = useState(1)
  const [wizard, setWizard] = useState<WizardState>(DEFAULT_WIZARD)
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState<{ type: 'success' | 'error'; msg: string } | null>(null)

  function showToast(type: 'success' | 'error', msg: string) {
    setToast({ type, msg })
    setTimeout(() => setToast(null), 4000)
  }

  const fetchReports = useCallback(async () => {
    if (!token) return
    setLoading(true)
    try {
      const res = await fetch(`/api/reports`, { headers: authHeaders })
      if (res.ok) {
        const data = await res.json()
        setReports(data.reports ?? data ?? [])
      }
    } catch {
      // silently fail on network errors
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => {
    if (token) fetchReports()
  }, [token, fetchReports])

  async function handleDelete(id: string) {
    if (!confirm('Delete this report?')) return
    try {
      await fetch(`/api/reports/${id}`, { method: 'DELETE', headers: authHeaders })
      setReports((prev) => prev.filter((r) => r.id !== id))
      showToast('success', 'Report deleted')
    } catch {
      showToast('error', 'Failed to delete report')
    }
  }

  async function handleTogglePin(id: string) {
    try {
      const res = await fetch(`/api/reports/${id}/pin`, {
        method: 'PUT',
        headers: authHeaders,
      })
      if (res.ok) {
        const data = await res.json()
        setReports((prev) =>
          prev.map((r) => (r.id === id ? { ...r, pinned: data.pinned ?? !r.pinned } : r))
        )
      }
    } catch {
      showToast('error', 'Failed to update pin')
    }
  }

  async function handleSaveReport() {
    if (!wizard.name.trim()) {
      showToast('error', 'Report name is required')
      return
    }
    setSaving(true)
    try {
      const res = await fetch(`/api/reports`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          name: wizard.name.trim(),
          description: wizard.description.trim() || null,
          object: wizard.object,
          metric_fn: wizard.metric_fn,
          metric_field: wizard.metric_fn !== 'count' ? wizard.metric_field : null,
          group_by: wizard.group_by,
          filters: wizard.filters,
          date_range: wizard.date_range,
          date_from: wizard.date_range === 'custom' ? wizard.date_from : null,
          date_to: wizard.date_range === 'custom' ? wizard.date_to : null,
          chart_type: wizard.chart_type,
        }),
      })
      if (res.ok) {
        const data = await res.json()
        setReports((prev) => [data.report ?? data, ...prev])
        showToast('success', 'Report created!')
        setShowWizard(false)
        setWizard(DEFAULT_WIZARD)
        setWizardStep(1)
      } else {
        showToast('error', 'Failed to create report')
      }
    } catch {
      showToast('error', 'Failed to create report')
    } finally {
      setSaving(false)
    }
  }

  function openWizard() {
    setWizard(DEFAULT_WIZARD)
    setWizardStep(1)
    setShowWizard(true)
  }

  function closeWizard() {
    setShowWizard(false)
    setWizard(DEFAULT_WIZARD)
    setWizardStep(1)
  }

  function canAdvance(): boolean {
    if (wizardStep === 1) return wizard.object !== null
    if (wizardStep === 2) {
      if (wizard.metric_fn !== 'count') return !!wizard.metric_field
      return true
    }
    if (wizardStep === 6) return wizard.name.trim().length > 0
    return true
  }

  // ─── Wizard Steps ─────────────────────────────────────────────────────────

  function renderStep1() {
    return (
      <div>
        <h3 className="text-base font-semibold text-gray-800 mb-1">Data Source</h3>
        <p className="text-sm text-gray-500 mb-4">Choose the object you want to report on.</p>
        <div className="grid grid-cols-2 gap-3">
          {OBJECTS.map((obj) => (
            <button
              key={obj.key}
              onClick={() =>
                setWizard((w) => ({ ...w, object: obj.key, metric_field: null, group_by: null }))
              }
              className={`flex items-start gap-3 p-4 rounded-lg border-2 text-left transition-colors ${
                wizard.object === obj.key
                  ? 'border-blue-500 bg-blue-50'
                  : 'border-gray-200 hover:border-gray-300'
              }`}
            >
              <span className="text-2xl">{obj.icon}</span>
              <div>
                <div className="font-medium text-gray-800 text-sm">{obj.label}</div>
                <div className="text-xs text-gray-500 mt-0.5">{obj.description}</div>
              </div>
            </button>
          ))}
        </div>
      </div>
    )
  }

  function renderStep2() {
    const obj = wizard.object!
    const fields = METRIC_FIELDS[obj]
    const hasFields = fields.length > 0

    return (
      <div>
        <h3 className="text-base font-semibold text-gray-800 mb-1">Metric</h3>
        <p className="text-sm text-gray-500 mb-4">What do you want to measure?</p>

        <div className="space-y-3">
          <label className="flex items-center gap-3 p-3 rounded-lg border-2 cursor-pointer transition-colors border-blue-500 bg-blue-50">
            <input
              type="radio"
              name="metric_fn"
              value="count"
              checked={wizard.metric_fn === 'count'}
              onChange={() => setWizard((w) => ({ ...w, metric_fn: 'count', metric_field: null }))}
              className="text-blue-500"
            />
            <div>
              <div className="font-medium text-sm text-gray-800">Count</div>
              <div className="text-xs text-gray-500">Number of {getObjectMeta(obj)?.label}</div>
            </div>
          </label>

          {hasFields && (
            <>
              {(['sum', 'avg', 'min', 'max'] as MetricFn[]).map((fn) => (
                <label
                  key={fn}
                  className={`flex items-start gap-3 p-3 rounded-lg border-2 cursor-pointer transition-colors ${
                    wizard.metric_fn === fn
                      ? 'border-blue-500 bg-blue-50'
                      : 'border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <input
                    type="radio"
                    name="metric_fn"
                    value={fn}
                    checked={wizard.metric_fn === fn}
                    onChange={() => setWizard((w) => ({ ...w, metric_fn: fn }))}
                    className="mt-0.5 text-blue-500"
                  />
                  <div className="flex-1">
                    <div className="font-medium text-sm text-gray-800 capitalize">
                      {fn === 'avg' ? 'Average' : fn.charAt(0).toUpperCase() + fn.slice(1)}
                    </div>
                    {wizard.metric_fn === fn && (
                      <select
                        value={wizard.metric_field ?? ''}
                        onChange={(e) => setWizard((w) => ({ ...w, metric_field: e.target.value }))}
                        className="mt-2 block w-full text-sm border border-gray-300 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-400"
                      >
                        <option value="">Select field…</option>
                        {fields.map((f) => (
                          <option key={f.key} value={f.key}>
                            {f.label}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                </label>
              ))}
            </>
          )}
        </div>
      </div>
    )
  }

  function renderStep3() {
    const obj = wizard.object!
    const fields = GROUP_BY_FIELDS[obj]

    return (
      <div>
        <h3 className="text-base font-semibold text-gray-800 mb-1">Group By</h3>
        <p className="text-sm text-gray-500 mb-4">How do you want to break it down?</p>

        <select
          value={wizard.group_by ?? ''}
          onChange={(e) => setWizard((w) => ({ ...w, group_by: e.target.value || null }))}
          className="block w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-400"
        >
          <option value="">No grouping (total only)</option>
          {fields.map((f) => (
            <option key={f.key} value={f.key}>
              {f.label}
            </option>
          ))}
        </select>

        {wizard.group_by && (
          <p className="mt-3 text-xs text-gray-400">
            Results will be grouped by{' '}
            <span className="font-medium">
              {fields.find((f) => f.key === wizard.group_by)?.label}
            </span>
            .
          </p>
        )}
      </div>
    )
  }

  function renderStep4() {
    const obj = wizard.object!
    const fields = FILTER_FIELDS[obj]

    function addFilter() {
      setWizard((w) => ({
        ...w,
        filters: [...w.filters, { field: fields[0]?.key ?? '', operator: 'equals', value: '' }],
      }))
    }

    function removeFilter(i: number) {
      setWizard((w) => ({ ...w, filters: w.filters.filter((_, idx) => idx !== i) }))
    }

    function updateFilter(i: number, patch: Partial<ReportFilter>) {
      setWizard((w) => ({
        ...w,
        filters: w.filters.map((f, idx) => (idx === i ? { ...f, ...patch } : f)),
      }))
    }

    return (
      <div>
        <h3 className="text-base font-semibold text-gray-800 mb-1">Filters</h3>
        <p className="text-sm text-gray-500 mb-4">
          Narrow down which records to include (optional).
        </p>

        {wizard.filters.length === 0 && (
          <p className="text-sm text-gray-400 mb-4">
            No filters added — all records will be included.
          </p>
        )}

        <div className="space-y-3 mb-4">
          {wizard.filters.map((filter, i) => (
            <div
              key={i}
              className="flex items-center gap-2 p-3 bg-gray-50 rounded-lg border border-gray-200"
            >
              <select
                value={filter.field}
                onChange={(e) => updateFilter(i, { field: e.target.value })}
                className="text-sm border border-gray-300 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-400"
              >
                {fields.map((f) => (
                  <option key={f.key} value={f.key}>
                    {f.label}
                  </option>
                ))}
              </select>

              <select
                value={filter.operator}
                onChange={(e) =>
                  updateFilter(i, { operator: e.target.value as ReportFilter['operator'] })
                }
                className="text-sm border border-gray-300 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-400"
              >
                {Object.entries(OPERATOR_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>

              <input
                type="text"
                value={filter.value}
                onChange={(e) => updateFilter(i, { value: e.target.value })}
                placeholder="Value"
                className="flex-1 text-sm border border-gray-300 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-400"
              />

              <button
                onClick={() => removeFilter(i)}
                className="text-red-400 hover:text-red-600 text-sm px-2"
              >
                Remove
              </button>
            </div>
          ))}
        </div>

        <button
          onClick={addFilter}
          className="flex items-center gap-2 text-sm text-blue-600 hover:text-blue-700 font-medium"
        >
          <span>+</span> Add Filter
        </button>
      </div>
    )
  }

  function renderStep5() {
    return (
      <div>
        <h3 className="text-base font-semibold text-gray-800 mb-1">Date Range</h3>
        <p className="text-sm text-gray-500 mb-4">Choose the time window for this report.</p>

        <div className="flex flex-wrap gap-2 mb-4">
          {DATE_RANGE_PRESETS.map((preset) => (
            <button
              key={preset.key}
              onClick={() => setWizard((w) => ({ ...w, date_range: preset.key }))}
              className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
                wizard.date_range === preset.key
                  ? 'bg-blue-500 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {preset.label}
            </button>
          ))}
        </div>

        {wizard.date_range === 'custom' && (
          <div className="flex items-center gap-3 mt-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">From</label>
              <input
                type="date"
                value={wizard.date_from}
                onChange={(e) => setWizard((w) => ({ ...w, date_from: e.target.value }))}
                className="text-sm border border-gray-300 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-400"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">To</label>
              <input
                type="date"
                value={wizard.date_to}
                onChange={(e) => setWizard((w) => ({ ...w, date_to: e.target.value }))}
                className="text-sm border border-gray-300 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-400"
              />
            </div>
          </div>
        )}
      </div>
    )
  }

  function renderStep6() {
    return (
      <div>
        <h3 className="text-base font-semibold text-gray-800 mb-1">Chart Type & Name</h3>
        <p className="text-sm text-gray-500 mb-4">Finalize your report settings.</p>

        <div className="mb-5">
          <label className="block text-xs font-medium text-gray-600 mb-2">Chart Type</label>
          <div className="grid grid-cols-3 gap-2">
            {CHART_TYPES.map((ct) => (
              <button
                key={ct.key}
                onClick={() => setWizard((w) => ({ ...w, chart_type: ct.key }))}
                className={`flex flex-col items-center gap-1 p-3 rounded-lg border-2 transition-colors ${
                  wizard.chart_type === ct.key
                    ? 'border-blue-500 bg-blue-50'
                    : 'border-gray-200 hover:border-gray-300'
                }`}
              >
                <span className="text-xl">{ct.icon}</span>
                <span className="text-xs text-gray-600 font-medium">{ct.label}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="mb-4">
          <label className="block text-xs font-medium text-gray-600 mb-1">
            Report Name <span className="text-red-400">*</span>
          </label>
          <input
            type="text"
            value={wizard.name}
            onChange={(e) => setWizard((w) => ({ ...w, name: e.target.value }))}
            placeholder="e.g. Contacts by Lifecycle Stage"
            className="block w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-400"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">
            Description <span className="text-gray-400 font-normal">(optional)</span>
          </label>
          <textarea
            value={wizard.description}
            onChange={(e) => setWizard((w) => ({ ...w, description: e.target.value }))}
            placeholder="Briefly describe what this report shows…"
            rows={3}
            className="block w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-400 resize-none"
          />
        </div>
      </div>
    )
  }

  const STEP_LABELS = ['Data Source', 'Metric', 'Group By', 'Filters', 'Date Range', 'Chart & Save']

  // ─── Render ───────────────────────────────────────────────────────────────

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
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Reports</h1>
          <p className="text-sm text-gray-500 mt-1">Build custom reports from your CRM data.</p>
        </div>
        <button
          onClick={openWizard}
          className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
        >
          <span>+</span> Create Report
        </button>
      </div>

      {/* Report List */}
      {loading ? (
        <div className="py-16 text-center text-gray-400 text-sm">Loading reports…</div>
      ) : reports.length === 0 ? (
        <div className="py-16 text-center">
          <div className="text-4xl mb-3">📊</div>
          <div className="text-gray-600 font-medium">No reports yet</div>
          <div className="text-sm text-gray-400 mt-1">Create your first report to get started.</div>
          <button
            onClick={openWizard}
            className="mt-4 px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 transition-colors"
          >
            Create Report
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4">
          {reports.map((report) => {
            const objMeta = getObjectMeta(report.object)
            const chartMeta = CHART_TYPES.find((ct) => ct.key === report.chart_type)

            return (
              <div
                key={report.id}
                className="bg-white border border-gray-200 rounded-xl p-5 hover:shadow-sm transition-shadow"
              >
                <div className="flex items-start justify-between gap-4">
                  <div
                    className="flex-1 min-w-0 cursor-pointer"
                    onClick={() => router.push(`/reports/${report.id}`)}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-semibold text-gray-900 text-sm">{report.name}</span>
                      {report.pinned && <span className="text-yellow-400 text-xs">★ Pinned</span>}
                    </div>
                    {report.description && (
                      <p className="text-xs text-gray-500 mb-2 truncate">{report.description}</p>
                    )}
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-blue-100 text-blue-700 rounded-full text-xs font-medium">
                        {objMeta?.icon} {objMeta?.label}
                      </span>
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-gray-100 text-gray-600 rounded-full text-xs">
                        {chartMeta?.icon} {chartMeta?.label}
                      </span>
                      {report.last_run && (
                        <span className="text-xs text-gray-400">
                          Last run {formatDate(report.last_run)}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => handleTogglePin(report.id)}
                      title={report.pinned ? 'Unpin' : 'Pin to dashboard'}
                      className={`p-1.5 rounded-lg transition-colors text-sm ${
                        report.pinned
                          ? 'text-yellow-500 hover:bg-yellow-50'
                          : 'text-gray-400 hover:bg-gray-100 hover:text-yellow-500'
                      }`}
                    >
                      ★
                    </button>
                    <button
                      onClick={() => router.push(`/reports/${report.id}`)}
                      className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100 hover:text-blue-600 transition-colors text-xs font-medium"
                    >
                      View
                    </button>
                    <button
                      onClick={() => handleDelete(report.id)}
                      className="p-1.5 rounded-lg text-gray-400 hover:bg-red-50 hover:text-red-500 transition-colors text-xs"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Wizard Modal */}
      {showWizard && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-xl mx-4 flex flex-col max-h-[90vh]">
            {/* Modal Header */}
            <div className="px-6 pt-6 pb-4 border-b border-gray-100">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-bold text-gray-900">New Report</h2>
                <button
                  onClick={closeWizard}
                  className="text-gray-400 hover:text-gray-600 text-xl leading-none"
                >
                  ×
                </button>
              </div>

              {/* Step indicators */}
              <div className="flex items-center gap-1">
                {STEP_LABELS.map((label, i) => {
                  const step = i + 1
                  const active = wizardStep === step
                  const done = wizardStep > step
                  return (
                    <div key={step} className="flex items-center gap-1 flex-1">
                      <div
                        className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${
                          active
                            ? 'bg-blue-500 text-white'
                            : done
                              ? 'bg-green-500 text-white'
                              : 'bg-gray-200 text-gray-500'
                        }`}
                      >
                        {done ? '✓' : step}
                      </div>
                      {i < STEP_LABELS.length - 1 && (
                        <div className={`h-0.5 flex-1 ${done ? 'bg-green-400' : 'bg-gray-200'}`} />
                      )}
                    </div>
                  )
                })}
              </div>
              <div className="mt-1 text-xs text-gray-400 text-center">
                Step {wizardStep} of {STEP_LABELS.length}: {STEP_LABELS[wizardStep - 1]}
              </div>
            </div>

            {/* Step Content */}
            <div className="px-6 py-5 flex-1 overflow-y-auto">
              {wizardStep === 1 && renderStep1()}
              {wizardStep === 2 && wizard.object && renderStep2()}
              {wizardStep === 3 && wizard.object && renderStep3()}
              {wizardStep === 4 && wizard.object && renderStep4()}
              {wizardStep === 5 && renderStep5()}
              {wizardStep === 6 && renderStep6()}
            </div>

            {/* Modal Footer */}
            <div className="px-6 py-4 border-t border-gray-100 flex items-center justify-between">
              <button
                onClick={() => setWizardStep((s) => Math.max(1, s - 1))}
                disabled={wizardStep === 1}
                className="px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100 rounded-lg transition-colors disabled:opacity-40"
              >
                Back
              </button>

              <div className="flex items-center gap-2">
                <button
                  onClick={closeWizard}
                  className="px-4 py-2 text-sm font-medium text-gray-500 hover:bg-gray-100 rounded-lg transition-colors"
                >
                  Cancel
                </button>

                {wizardStep < 6 ? (
                  <button
                    onClick={() => setWizardStep((s) => s + 1)}
                    disabled={!canAdvance()}
                    className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-40"
                  >
                    Next
                  </button>
                ) : (
                  <button
                    onClick={handleSaveReport}
                    disabled={saving || !wizard.name.trim()}
                    className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-40"
                  >
                    {saving ? 'Saving…' : 'Save Report'}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
