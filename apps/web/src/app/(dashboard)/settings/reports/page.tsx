'use client'

import { useState, useEffect, useCallback } from 'react'

const REPORT_LABELS: Record<string, string> = {
  velocity: 'Sales Velocity',
  appointments: 'Appointments',
  lead_source: 'Lead Source',
  pipeline_funnel: 'Pipeline Funnel',
}

const DOW_LABELS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

interface ScheduledReport {
  id: string
  report_type: string
  frequency: string
  day_of_week: number | null
  day_of_month: number | null
  recipients: string[]
  enabled: boolean
  last_sent_at: string | null
}

interface FormState {
  report_type: string
  frequency: 'weekly' | 'monthly'
  day_of_week: number
  day_of_month: number
  recipients: string
}

const EMPTY_FORM: FormState = {
  report_type: 'velocity',
  frequency: 'weekly',
  day_of_week: 1,
  day_of_month: 1,
  recipients: '',
}

function fmtDate(iso: string | null): string {
  if (!iso) return 'Never'
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

function scheduleLabel(r: ScheduledReport): string {
  if (r.frequency === 'weekly' && r.day_of_week !== null) {
    return `Weekly · ${DOW_LABELS[r.day_of_week] ?? ''}`
  }
  if (r.frequency === 'monthly' && r.day_of_month !== null) {
    return `Monthly · Day ${r.day_of_month}`
  }
  return r.frequency
}

export default function ScheduledReportsPage() {
  const [reports, setReports] = useState<ScheduledReport[]>([])
  const [loading, setLoading] = useState(true)
  const [modalOpen, setModalOpen] = useState(false)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/scheduled-reports', { credentials: 'include' })
      const d = (await r.json()) as { data: ScheduledReport[] }
      setReports(d.data ?? [])
    } catch {
      /* ignore */
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function toggleEnabled(id: string, enabled: boolean) {
    setReports((prev) => prev.map((r) => (r.id === id ? { ...r, enabled } : r)))
    await fetch(`/api/scheduled-reports/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ enabled }),
    })
  }

  async function deleteReport(id: string) {
    setReports((prev) => prev.filter((r) => r.id !== id))
    await fetch(`/api/scheduled-reports/${id}`, { method: 'DELETE', credentials: 'include' })
  }

  async function saveReport() {
    setSaving(true)
    setFormError(null)
    const emails = form.recipients
      .split(',')
      .map((e) => e.trim())
      .filter(Boolean)
    if (emails.length === 0) {
      setFormError('Enter at least one recipient email.')
      setSaving(false)
      return
    }
    const body: Record<string, unknown> = {
      report_type: form.report_type,
      frequency: form.frequency,
      recipients: emails,
    }
    if (form.frequency === 'weekly') body['day_of_week'] = form.day_of_week
    if (form.frequency === 'monthly') body['day_of_month'] = form.day_of_month

    try {
      const r = await fetch('/api/scheduled-reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body),
      })
      if (!r.ok) {
        const d = (await r.json()) as { error?: string }
        setFormError(d.error ?? 'Failed to save')
        return
      }
      setModalOpen(false)
      setForm(EMPTY_FORM)
      void load()
    } catch {
      setFormError('Failed to save. Try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="px-8 py-8 max-w-3xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-ink">Scheduled Reports</h1>
          <p className="text-sm text-ink3 mt-0.5">
            Receive email digests of your Insights reports on a recurring schedule
          </p>
        </div>
        <button
          onClick={() => {
            setForm(EMPTY_FORM)
            setFormError(null)
            setModalOpen(true)
          }}
          className="flex items-center gap-1.5 px-3 py-2 bg-teal-600 hover:bg-teal-700 text-white text-sm font-medium rounded-lg transition-colors"
        >
          <span className="text-base leading-none">+</span>
          Schedule Report
        </button>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-border-brand overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-sm text-ink4 animate-pulse">Loading…</div>
        ) : reports.length === 0 ? (
          <div className="p-10 text-center">
            <p className="text-sm font-medium text-ink2">No scheduled reports yet</p>
            <p className="text-xs text-ink4 mt-1">
              Click &quot;Schedule Report&quot; to set up your first email digest
            </p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border-brand">
                <th className="text-left px-5 py-3 text-xs font-semibold text-ink4 uppercase tracking-wide">
                  Report
                </th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-ink4 uppercase tracking-wide">
                  Schedule
                </th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-ink4 uppercase tracking-wide">
                  Recipients
                </th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-ink4 uppercase tracking-wide">
                  Last Sent
                </th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {reports.map((r) => (
                <tr
                  key={r.id}
                  className="border-b border-gray-50 last:border-0 hover:bg-gray-50/50"
                >
                  <td className="px-5 py-3.5 font-medium text-ink">
                    {REPORT_LABELS[r.report_type] ?? r.report_type}
                  </td>
                  <td className="px-4 py-3.5 text-ink3">{scheduleLabel(r)}</td>
                  <td className="px-4 py-3.5 text-ink3 max-w-[200px]">
                    <span className="truncate block" title={r.recipients.join(', ')}>
                      {r.recipients.length === 1
                        ? r.recipients[0]
                        : `${r.recipients[0]} +${r.recipients.length - 1}`}
                    </span>
                  </td>
                  <td className="px-4 py-3.5 text-ink4 text-xs">{fmtDate(r.last_sent_at)}</td>
                  <td className="px-4 py-3.5">
                    <div className="flex items-center gap-3 justify-end">
                      {/* Enabled toggle */}
                      <button
                        onClick={() => void toggleEnabled(r.id, !r.enabled)}
                        className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none ${
                          r.enabled ? 'bg-teal-600' : 'bg-bg3'
                        }`}
                        title={r.enabled ? 'Disable' : 'Enable'}
                      >
                        <span
                          className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                            r.enabled ? 'translate-x-4' : 'translate-x-0.5'
                          }`}
                        />
                      </button>
                      {/* Delete */}
                      <button
                        onClick={() => void deleteReport(r.id)}
                        className="text-ink4 hover:text-red-500 transition-colors"
                        title="Delete"
                      >
                        <svg
                          className="w-4 h-4"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                          />
                        </svg>
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-xl border border-border-brand shadow-xl w-full max-w-md">
            <div className="px-6 py-4 border-b border-border-brand flex items-center justify-between">
              <h2 className="text-sm font-semibold text-ink">Schedule a Report</h2>
              <button
                onClick={() => setModalOpen(false)}
                className="text-ink4 hover:text-ink transition-colors"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            </div>

            <div className="px-6 py-5 space-y-4">
              {/* Report type */}
              <div>
                <label className="block text-xs font-medium text-ink2 mb-1.5">Report</label>
                <select
                  value={form.report_type}
                  onChange={(e) => setForm((f) => ({ ...f, report_type: e.target.value }))}
                  className="w-full px-3 py-2 text-sm border border-border-brand rounded-lg bg-white focus:ring-1 focus:ring-teal-500 focus:border-teal-500"
                >
                  {Object.entries(REPORT_LABELS).map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </select>
              </div>

              {/* Frequency */}
              <div>
                <label className="block text-xs font-medium text-ink2 mb-1.5">Frequency</label>
                <div className="flex gap-3">
                  {(['weekly', 'monthly'] as const).map((f) => (
                    <label
                      key={f}
                      className={`flex items-center gap-2 px-3 py-2 rounded-lg border cursor-pointer text-sm flex-1 transition-colors ${
                        form.frequency === f
                          ? 'border-teal-500 bg-teal-50 text-teal-700'
                          : 'border-border-brand text-ink3 hover:bg-bg'
                      }`}
                    >
                      <input
                        type="radio"
                        name="frequency"
                        value={f}
                        checked={form.frequency === f}
                        onChange={() => setForm((s) => ({ ...s, frequency: f }))}
                        className="text-teal-600 focus:ring-teal-500"
                      />
                      <span className="capitalize">{f}</span>
                    </label>
                  ))}
                </div>
              </div>

              {/* Day selector */}
              {form.frequency === 'weekly' ? (
                <div>
                  <label className="block text-xs font-medium text-ink2 mb-1.5">Day of Week</label>
                  <select
                    value={form.day_of_week}
                    onChange={(e) =>
                      setForm((s) => ({ ...s, day_of_week: parseInt(e.target.value, 10) }))
                    }
                    className="w-full px-3 py-2 text-sm border border-border-brand rounded-lg bg-white focus:ring-1 focus:ring-teal-500 focus:border-teal-500"
                  >
                    {DOW_LABELS.map((d, i) => (
                      <option key={i} value={i}>
                        {d}
                      </option>
                    ))}
                  </select>
                </div>
              ) : (
                <div>
                  <label className="block text-xs font-medium text-ink2 mb-1.5">Day of Month</label>
                  <select
                    value={form.day_of_month}
                    onChange={(e) =>
                      setForm((s) => ({ ...s, day_of_month: parseInt(e.target.value, 10) }))
                    }
                    className="w-full px-3 py-2 text-sm border border-border-brand rounded-lg bg-white focus:ring-1 focus:ring-teal-500 focus:border-teal-500"
                  >
                    {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => (
                      <option key={d} value={d}>
                        {d}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* Recipients */}
              <div>
                <label className="block text-xs font-medium text-ink2 mb-1.5">Recipients</label>
                <input
                  type="text"
                  value={form.recipients}
                  onChange={(e) => setForm((s) => ({ ...s, recipients: e.target.value }))}
                  placeholder="alice@example.com, bob@example.com"
                  className="w-full px-3 py-2 text-sm border border-border-brand rounded-lg focus:ring-1 focus:ring-teal-500 focus:border-teal-500 placeholder:text-gray-300"
                />
                <p className="text-[11px] text-ink4 mt-1">Comma-separated email addresses</p>
              </div>

              {formError && (
                <p className="text-xs text-red-600 bg-red-50 px-3 py-2 rounded-lg">{formError}</p>
              )}
            </div>

            <div className="px-6 py-4 border-t border-border-brand flex justify-end gap-2">
              <button
                onClick={() => setModalOpen(false)}
                className="px-4 py-2 text-sm text-ink3 border border-border-brand rounded-lg hover:bg-bg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => void saveReport()}
                disabled={saving}
                className="px-4 py-2 text-sm font-medium bg-teal-600 hover:bg-teal-700 text-white rounded-lg disabled:opacity-50 transition-colors"
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
