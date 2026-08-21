'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Button from '@mui/material/Button'
import IconButton from '@mui/material/IconButton'
import TextField from '@mui/material/TextField'
import MenuItem from '@mui/material/MenuItem'
import Radio from '@mui/material/Radio'
import RadioGroup from '@mui/material/RadioGroup'
import FormControlLabel from '@mui/material/FormControlLabel'
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup'
import ToggleButton from '@mui/material/ToggleButton'
import { Modal } from '@/components/ui/Modal'

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
  metric: MetricFn
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
  metric: MetricFn
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
  metric: 'count',
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
  const router = useRouter()

  const authHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
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
  }, [])

  useEffect(() => {
    fetchReports()
  }, [fetchReports])

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
          metric: wizard.metric,
          metric_field: wizard.metric !== 'count' ? wizard.metric_field : null,
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
      if (wizard.metric !== 'count') return !!wizard.metric_field
      return true
    }
    if (wizardStep === 3) return wizard.group_by !== null
    if (wizardStep === 6) return wizard.name.trim().length > 0
    return true
  }

  // ─── Wizard Steps ─────────────────────────────────────────────────────────

  function renderStep1() {
    return (
      <div>
        <h3 className="text-base font-semibold text-ink mb-1">Data Source</h3>
        <p className="text-sm text-ink3 mb-4">Choose the object you want to report on.</p>
        <div className="grid grid-cols-2 gap-3">
          {OBJECTS.map((obj) => (
            <button
              key={obj.key}
              onClick={() =>
                setWizard((w) => ({
                  ...w,
                  object: obj.key,
                  metric_field: null,
                  group_by: GROUP_BY_FIELDS[obj.key][0]?.key ?? null,
                }))
              }
              className={`flex items-start gap-3 p-4 rounded-lg border-2 text-left transition-colors ${
                wizard.object === obj.key
                  ? 'border-blue-500 bg-blue-50'
                  : 'border-border-brand hover:border-border-brand'
              }`}
            >
              <span className="text-2xl">{obj.icon}</span>
              <div>
                <div className="font-medium text-ink text-sm">{obj.label}</div>
                <div className="text-xs text-ink3 mt-0.5">{obj.description}</div>
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
        <h3 className="text-base font-semibold text-ink mb-1">Metric</h3>
        <p className="text-sm text-ink3 mb-4">What do you want to measure?</p>

        <RadioGroup
          value={wizard.metric}
          onChange={(_e, v) =>
            setWizard((w) => ({
              ...w,
              metric: v as MetricFn,
              metric_field: v === 'count' ? null : w.metric_field,
            }))
          }
        >
          <FormControlLabel
            value="count"
            control={<Radio size="small" />}
            label={
              <div>
                <div className="font-medium text-sm text-ink">Count</div>
                <div className="text-xs text-ink3">Number of {getObjectMeta(obj)?.label}</div>
              </div>
            }
            className="!items-start !ml-0 !mb-2 !p-3 rounded-lg border-2 border-blue-500 bg-blue-50"
          />

          {hasFields &&
            (['sum', 'avg', 'min', 'max'] as MetricFn[]).map((fn) => (
              <div
                key={fn}
                className={`p-3 mb-2 rounded-lg border-2 transition-colors ${
                  wizard.metric === fn ? 'border-blue-500 bg-blue-50' : 'border-border-brand'
                }`}
              >
                <FormControlLabel
                  value={fn}
                  control={<Radio size="small" />}
                  label={
                    <div className="font-medium text-sm text-ink capitalize">
                      {fn === 'avg' ? 'Average' : fn.charAt(0).toUpperCase() + fn.slice(1)}
                    </div>
                  }
                  className="!items-start !ml-0"
                />
                {wizard.metric === fn && (
                  <TextField
                    select
                    value={wizard.metric_field ?? ''}
                    onChange={(e) => setWizard((w) => ({ ...w, metric_field: e.target.value }))}
                    fullWidth
                    size="small"
                    slotProps={{ select: { displayEmpty: true } }}
                    sx={{ mt: 1 }}
                  >
                    <MenuItem value="">Select field…</MenuItem>
                    {fields.map((f) => (
                      <MenuItem key={f.key} value={f.key}>
                        {f.label}
                      </MenuItem>
                    ))}
                  </TextField>
                )}
              </div>
            ))}
        </RadioGroup>
      </div>
    )
  }

  function renderStep3() {
    const obj = wizard.object!
    const fields = GROUP_BY_FIELDS[obj]

    return (
      <div>
        <h3 className="text-base font-semibold text-ink mb-1">Group By</h3>
        <p className="text-sm text-ink3 mb-4">How do you want to break it down?</p>

        <TextField
          select
          value={wizard.group_by ?? ''}
          onChange={(e) => setWizard((w) => ({ ...w, group_by: e.target.value || null }))}
          fullWidth
          size="small"
        >
          {fields.map((f) => (
            <MenuItem key={f.key} value={f.key}>
              {f.label}
            </MenuItem>
          ))}
        </TextField>

        {wizard.group_by && (
          <p className="mt-3 text-xs text-ink4">
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
        <h3 className="text-base font-semibold text-ink mb-1">Filters</h3>
        <p className="text-sm text-ink3 mb-4">Narrow down which records to include (optional).</p>

        {wizard.filters.length === 0 && (
          <p className="text-sm text-ink4 mb-4">No filters added — all records will be included.</p>
        )}

        <div className="space-y-3 mb-4">
          {wizard.filters.map((filter, i) => (
            <div
              key={i}
              className="flex items-center gap-2 p-3 bg-bg rounded-lg border border-border-brand"
            >
              <TextField
                select
                value={filter.field}
                onChange={(e) => updateFilter(i, { field: e.target.value })}
                size="small"
              >
                {fields.map((f) => (
                  <MenuItem key={f.key} value={f.key}>
                    {f.label}
                  </MenuItem>
                ))}
              </TextField>

              <TextField
                select
                value={filter.operator}
                onChange={(e) =>
                  updateFilter(i, { operator: e.target.value as ReportFilter['operator'] })
                }
                size="small"
              >
                {Object.entries(OPERATOR_LABELS).map(([k, v]) => (
                  <MenuItem key={k} value={k}>
                    {v}
                  </MenuItem>
                ))}
              </TextField>

              <TextField
                value={filter.value}
                onChange={(e) => updateFilter(i, { value: e.target.value })}
                placeholder="Value"
                fullWidth
                size="small"
              />

              <Button
                onClick={() => removeFilter(i)}
                size="small"
                color="error"
                sx={{ fontSize: 13 }}
              >
                Remove
              </Button>
            </div>
          ))}
        </div>

        <Button onClick={addFilter} size="small" sx={{ color: '#2563eb', fontSize: 14 }}>
          + Add Filter
        </Button>
      </div>
    )
  }

  function renderStep5() {
    return (
      <div>
        <h3 className="text-base font-semibold text-ink mb-1">Date Range</h3>
        <p className="text-sm text-ink3 mb-4">Choose the time window for this report.</p>

        <ToggleButtonGroup
          value={wizard.date_range}
          exclusive
          onChange={(_e, v: string | null) => v && setWizard((w) => ({ ...w, date_range: v }))}
          size="small"
          sx={{
            flexWrap: 'wrap',
            gap: 1,
            mb: 2,
            '& .MuiToggleButtonGroup-grouped': {
              borderRadius: '9999px !important',
              border: '1px solid transparent !important',
            },
          }}
        >
          {DATE_RANGE_PRESETS.map((preset) => (
            <ToggleButton
              key={preset.key}
              value={preset.key}
              sx={{ fontSize: 13, px: 1.5, py: 0.5 }}
            >
              {preset.label}
            </ToggleButton>
          ))}
        </ToggleButtonGroup>

        {wizard.date_range === 'custom' && (
          <div className="flex items-center gap-3 mt-3">
            <div>
              <label className="block text-xs text-ink3 mb-1">From</label>
              <TextField
                type="date"
                value={wizard.date_from}
                onChange={(e) => setWizard((w) => ({ ...w, date_from: e.target.value }))}
                size="small"
              />
            </div>
            <div>
              <label className="block text-xs text-ink3 mb-1">To</label>
              <TextField
                type="date"
                value={wizard.date_to}
                onChange={(e) => setWizard((w) => ({ ...w, date_to: e.target.value }))}
                size="small"
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
        <h3 className="text-base font-semibold text-ink mb-1">Chart Type & Name</h3>
        <p className="text-sm text-ink3 mb-4">Finalize your report settings.</p>

        <div className="mb-5">
          <label className="block text-xs font-medium text-ink3 mb-2">Chart Type</label>
          <ToggleButtonGroup
            value={wizard.chart_type}
            exclusive
            onChange={(_e, v: ChartType | null) => v && setWizard((w) => ({ ...w, chart_type: v }))}
            sx={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 1 }}
          >
            {CHART_TYPES.map((ct) => (
              <ToggleButton
                key={ct.key}
                value={ct.key}
                sx={{ flexDirection: 'column', gap: 0.5, py: 1.5 }}
              >
                <span className="text-xl">{ct.icon}</span>
                <span className="text-xs text-ink3 font-medium">{ct.label}</span>
              </ToggleButton>
            ))}
          </ToggleButtonGroup>
        </div>

        <div className="mb-4">
          <label className="block text-xs font-medium text-ink3 mb-1">
            Report Name <span className="text-red-400">*</span>
          </label>
          <TextField
            value={wizard.name}
            onChange={(e) => setWizard((w) => ({ ...w, name: e.target.value }))}
            placeholder="e.g. Contacts by Lifecycle Stage"
            fullWidth
            size="small"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-ink3 mb-1">
            Description <span className="text-ink4 font-normal">(optional)</span>
          </label>
          <TextField
            multiline
            rows={3}
            value={wizard.description}
            onChange={(e) => setWizard((w) => ({ ...w, description: e.target.value }))}
            placeholder="Briefly describe what this report shows…"
            fullWidth
            size="small"
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
          <h1 className="text-2xl font-bold text-ink">Reports</h1>
          <p className="text-sm text-ink3 mt-1">Build custom reports from your CRM data.</p>
        </div>
        <Button
          onClick={openWizard}
          variant="contained"
          sx={{ bgcolor: '#2563eb', '&:hover': { bgcolor: '#1d4ed8' } }}
        >
          + Create Report
        </Button>
      </div>

      {/* Report List */}
      {loading ? (
        <div className="py-16 text-center text-ink4 text-sm">Loading reports…</div>
      ) : reports.length === 0 ? (
        <div className="py-16 text-center">
          <div className="text-4xl mb-3">📊</div>
          <div className="text-ink3 font-medium">No reports yet</div>
          <div className="text-sm text-ink4 mt-1">Create your first report to get started.</div>
          <Button
            onClick={openWizard}
            variant="contained"
            sx={{ mt: 2, bgcolor: '#2563eb', '&:hover': { bgcolor: '#1d4ed8' } }}
          >
            Create Report
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4">
          {reports.map((report) => {
            const objMeta = getObjectMeta(report.object)
            const chartMeta = CHART_TYPES.find((ct) => ct.key === report.chart_type)

            return (
              <div
                key={report.id}
                className="bg-white border border-border-brand rounded-xl p-5 hover:shadow-sm transition-shadow"
              >
                <div className="flex items-start justify-between gap-4">
                  <div
                    className="flex-1 min-w-0 cursor-pointer"
                    onClick={() => router.push(`/reports/${report.id}`)}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-semibold text-ink text-sm">{report.name}</span>
                      {report.pinned && <span className="text-yellow-400 text-xs">★ Pinned</span>}
                    </div>
                    {report.description && (
                      <p className="text-xs text-ink3 mb-2 truncate">{report.description}</p>
                    )}
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-blue-100 text-blue-700 rounded-full text-xs font-medium">
                        {objMeta?.icon} {objMeta?.label}
                      </span>
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-bg2 text-ink3 rounded-full text-xs">
                        {chartMeta?.icon} {chartMeta?.label}
                      </span>
                      {report.last_run && (
                        <span className="text-xs text-ink4">
                          Last run {formatDate(report.last_run)}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    <IconButton
                      onClick={() => handleTogglePin(report.id)}
                      title={report.pinned ? 'Unpin' : 'Pin to dashboard'}
                      size="small"
                      sx={{
                        color: report.pinned ? '#eab308' : 'text.disabled',
                        '&:hover': { color: '#eab308' },
                      }}
                    >
                      ★
                    </IconButton>
                    <Button
                      onClick={() => router.push(`/reports/${report.id}`)}
                      size="small"
                      color="inherit"
                      sx={{ fontSize: 12 }}
                    >
                      View
                    </Button>
                    <Button
                      onClick={() => handleDelete(report.id)}
                      size="small"
                      color="error"
                      sx={{ fontSize: 12 }}
                    >
                      Delete
                    </Button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Wizard Modal */}
      {showWizard && (
        <Modal
          onClose={closeWizard}
          title="New Report"
          footer={
            // Modal's footer slot (DialogActions) defaults to flex-end; this
            // wizard needs Back pinned to the far left, Cancel/Next grouped
            // on the right. Rather than add a layout prop to the shared
            // primitive for this one case, a full-width flex wrapper inside
            // the slot gets the same result without touching Modal.tsx.
            <div className="flex items-center justify-between w-full">
              <Button
                onClick={() => setWizardStep((s) => Math.max(1, s - 1))}
                disabled={wizardStep === 1}
                variant="text"
                color="inherit"
              >
                Back
              </Button>
              <div className="flex items-center gap-2">
                <Button onClick={closeWizard} variant="text" color="inherit">
                  Cancel
                </Button>
                {wizardStep < 6 ? (
                  <Button
                    onClick={() => setWizardStep((s) => s + 1)}
                    disabled={!canAdvance()}
                    variant="contained"
                  >
                    Next
                  </Button>
                ) : (
                  <Button
                    onClick={handleSaveReport}
                    disabled={saving || !wizard.name.trim()}
                    variant="contained"
                  >
                    {saving ? 'Saving…' : 'Save Report'}
                  </Button>
                )}
              </div>
            </div>
          }
        >
          {/* Step indicators — wizard's own progress UI, unrelated to the
              Modal primitive; kept exactly as-is inside children. */}
          <div className="flex items-center gap-1 mb-1">
            {STEP_LABELS.map((_label, i) => {
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
                          : 'bg-bg3 text-ink3'
                    }`}
                  >
                    {done ? '✓' : step}
                  </div>
                  {i < STEP_LABELS.length - 1 && (
                    <div className={`h-0.5 flex-1 ${done ? 'bg-green-400' : 'bg-bg3'}`} />
                  )}
                </div>
              )
            })}
          </div>
          <div className="text-xs text-ink4 text-center mb-4">
            Step {wizardStep} of {STEP_LABELS.length}: {STEP_LABELS[wizardStep - 1]}
          </div>

          {/* Step content — untouched wizard internals, same functions as before. */}
          {wizardStep === 1 && renderStep1()}
          {wizardStep === 2 && wizard.object && renderStep2()}
          {wizardStep === 3 && wizard.object && renderStep3()}
          {wizardStep === 4 && wizard.object && renderStep4()}
          {wizardStep === 5 && renderStep5()}
          {wizardStep === 6 && renderStep6()}
        </Modal>
      )}
    </div>
  )
}
