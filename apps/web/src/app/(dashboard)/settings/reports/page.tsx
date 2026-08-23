'use client'

import { useState, useEffect, useCallback } from 'react'
import TextField from '@mui/material/TextField'
import MenuItem from '@mui/material/MenuItem'
import Radio from '@mui/material/Radio'
import RadioGroup from '@mui/material/RadioGroup'
import FormControlLabel from '@mui/material/FormControlLabel'
import Button from '@mui/material/Button'
import Switch from '@mui/material/Switch'
import IconButton from '@mui/material/IconButton'
import { Modal } from '@/components/ui/Modal'

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
        <Button
          onClick={() => {
            setForm(EMPTY_FORM)
            setFormError(null)
            setModalOpen(true)
          }}
          variant="contained"
        >
          + Schedule Report
        </Button>
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
                      <Switch
                        size="small"
                        checked={r.enabled}
                        onChange={() => void toggleEnabled(r.id, !r.enabled)}
                        slotProps={{
                          input: {
                            'aria-label': r.enabled ? 'Disable report' : 'Enable report',
                          },
                        }}
                      />
                      {/* Delete */}
                      <IconButton
                        onClick={() => void deleteReport(r.id)}
                        title="Delete"
                        size="small"
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
                      </IconButton>
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
        <Modal
          onClose={() => setModalOpen(false)}
          title="Schedule a Report"
          footer={
            <>
              <Button onClick={() => setModalOpen(false)} variant="outlined" color="inherit">
                Cancel
              </Button>
              <Button onClick={() => void saveReport()} disabled={saving} variant="contained">
                {saving ? 'Saving…' : 'Save'}
              </Button>
            </>
          }
        >
          <div className="space-y-4">
            <TextField
              select
              label="Report"
              value={form.report_type}
              onChange={(e) => setForm((f) => ({ ...f, report_type: e.target.value }))}
              fullWidth
              size="small"
            >
              {Object.entries(REPORT_LABELS).map(([v, l]) => (
                <MenuItem key={v} value={v}>
                  {l}
                </MenuItem>
              ))}
            </TextField>

            <div>
              <label className="block text-xs font-medium text-ink2 mb-1.5">Frequency</label>
              <RadioGroup
                row
                value={form.frequency}
                onChange={(e) =>
                  setForm((s) => ({ ...s, frequency: e.target.value as 'weekly' | 'monthly' }))
                }
                sx={{ gap: 1.5, flexWrap: 'nowrap' }}
              >
                {(['weekly', 'monthly'] as const).map((f) => (
                  <FormControlLabel
                    key={f}
                    value={f}
                    control={<Radio size="small" />}
                    label={<span className="capitalize text-sm">{f}</span>}
                    sx={{
                      flex: 1,
                      m: 0,
                      px: 1,
                      borderRadius: '8px',
                      border: '1px solid',
                      borderColor: form.frequency === f ? 'primary.main' : 'divider',
                      // #f0fdfa matches Tailwind's bg-teal-50, the original's exact
                      // selected-state color — theme.palette only defines
                      // main/light/dark, not numbered shades like primary.50.
                      bgcolor: form.frequency === f ? '#f0fdfa' : 'transparent',
                    }}
                  />
                ))}
              </RadioGroup>
            </div>

            {form.frequency === 'weekly' ? (
              <TextField
                select
                label="Day of Week"
                value={form.day_of_week}
                onChange={(e) =>
                  setForm((s) => ({ ...s, day_of_week: parseInt(e.target.value, 10) }))
                }
                fullWidth
                size="small"
              >
                {DOW_LABELS.map((d, i) => (
                  <MenuItem key={i} value={i}>
                    {d}
                  </MenuItem>
                ))}
              </TextField>
            ) : (
              <TextField
                select
                label="Day of Month"
                value={form.day_of_month}
                onChange={(e) =>
                  setForm((s) => ({ ...s, day_of_month: parseInt(e.target.value, 10) }))
                }
                fullWidth
                size="small"
              >
                {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => (
                  <MenuItem key={d} value={d}>
                    {d}
                  </MenuItem>
                ))}
              </TextField>
            )}

            <div>
              <TextField
                label="Recipients"
                value={form.recipients}
                onChange={(e) => setForm((s) => ({ ...s, recipients: e.target.value }))}
                placeholder="alice@example.com, bob@example.com"
                fullWidth
                size="small"
              />
              <p className="text-[11px] text-ink4 mt-1">Comma-separated email addresses</p>
            </div>

            {formError && (
              <p className="text-xs text-red-600 bg-red-50 px-3 py-2 rounded-lg">{formError}</p>
            )}
          </div>
        </Modal>
      )}
    </div>
  )
}
