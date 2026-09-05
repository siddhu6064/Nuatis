'use client'

import { useState, useEffect, useCallback } from 'react'
import TextField from '@mui/material/TextField'
import MenuItem from '@mui/material/MenuItem'
import Button from '@mui/material/Button'
import Switch from '@mui/material/Switch'
import { formatCurrency } from '@nuatis/shared'
import { Modal } from '@/components/ui/Modal'

const WEEKDAY_LABELS = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
]
const MONTH_LABELS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]

type Frequency = 'weekly' | 'monthly' | 'quarterly' | 'annually'

const FREQUENCY_LABELS: Record<Frequency, string> = {
  weekly: 'Weekly',
  monthly: 'Monthly',
  quarterly: 'Quarterly',
  annually: 'Annually',
}

interface Contact {
  id: string
  full_name: string
}

interface RecurringInvoice {
  id: string
  contact_id: string
  description: string
  amount: number
  tax_rate: number
  due_days: number
  frequency: Frequency
  day_of_week: number | null
  day_of_month: number | null
  month_of_year: number | null
  enabled: boolean
  contacts?: { full_name: string } | null
}

interface RuleFormState {
  contactId: string
  description: string
  amount: string
  taxRate: string
  dueDays: string
  frequency: Frequency
  dayOfWeek: number
  dayOfMonth: number
  monthOfYear: number
}

const EMPTY_FORM: RuleFormState = {
  contactId: '',
  description: '',
  amount: '',
  taxRate: '0',
  dueDays: '14',
  frequency: 'monthly',
  dayOfWeek: 1,
  dayOfMonth: 1,
  monthOfYear: 1,
}

interface Props {
  contacts: Contact[]
}

export default function RecurringInvoicesClient({ contacts }: Props) {
  const [rules, setRules] = useState<RecurringInvoice[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState<RuleFormState>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const fetchRules = useCallback(async () => {
    const res = await fetch('/api/recurring-invoices')
    if (res.ok) {
      const data = (await res.json()) as { data: RecurringInvoice[] }
      setRules(data.data)
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    void fetchRules()
  }, [fetchRules])

  async function handleCreate() {
    setError('')
    if (!form.contactId) {
      setError('A customer is required')
      return
    }
    if (!form.description.trim()) {
      setError('Description is required')
      return
    }
    const amountNum = Number(form.amount)
    if (!Number.isFinite(amountNum) || amountNum <= 0) {
      setError('Amount must be a number greater than 0')
      return
    }

    setSaving(true)
    try {
      const body: Record<string, unknown> = {
        contact_id: form.contactId,
        description: form.description.trim(),
        amount: amountNum,
        tax_rate: Number(form.taxRate) || 0,
        due_days: Number(form.dueDays) || 0,
        frequency: form.frequency,
      }
      if (form.frequency === 'weekly') body['day_of_week'] = form.dayOfWeek
      if (form.frequency === 'monthly' || form.frequency === 'quarterly') {
        body['day_of_month'] = form.dayOfMonth
      }
      if (form.frequency === 'annually') {
        body['day_of_month'] = form.dayOfMonth
        body['month_of_year'] = form.monthOfYear
      }

      const res = await fetch('/api/recurring-invoices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        throw new Error((d as { error?: string }).error ?? 'Failed to create rule')
      }
      setShowForm(false)
      setForm(EMPTY_FORM)
      await fetchRules()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create rule')
    } finally {
      setSaving(false)
    }
  }

  async function handleToggleEnabled(rule: RecurringInvoice) {
    const res = await fetch(`/api/recurring-invoices/${rule.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: !rule.enabled }),
    })
    if (res.ok) await fetchRules()
  }

  async function handleDelete(rule: RecurringInvoice) {
    if (!confirm('Delete this recurring invoice rule?')) return
    const res = await fetch(`/api/recurring-invoices/${rule.id}`, { method: 'DELETE' })
    if (res.ok) await fetchRules()
  }

  function scheduleLabel(rule: RecurringInvoice): string {
    if (rule.frequency === 'weekly' && rule.day_of_week !== null) {
      return `Every ${WEEKDAY_LABELS[rule.day_of_week]}`
    }
    if ((rule.frequency === 'monthly' || rule.frequency === 'quarterly') && rule.day_of_month) {
      return `${FREQUENCY_LABELS[rule.frequency]} on the ${rule.day_of_month}${ordinalSuffix(rule.day_of_month)}`
    }
    if (rule.frequency === 'annually' && rule.day_of_month && rule.month_of_year) {
      return `Every ${MONTH_LABELS[rule.month_of_year - 1]} ${rule.day_of_month}`
    }
    return FREQUENCY_LABELS[rule.frequency]
  }

  function contactName(rule: RecurringInvoice): string {
    return (
      rule.contacts?.full_name ?? contacts.find((c) => c.id === rule.contact_id)?.full_name ?? '—'
    )
  }

  return (
    <div className="bg-white rounded-xl border border-border-brand">
      <div className="px-5 py-4 border-b border-border-brand flex items-center justify-between">
        <h2 className="text-sm font-semibold text-ink">Recurring Invoices</h2>
        <Button size="small" variant="outlined" onClick={() => setShowForm(true)}>
          + Add Rule
        </Button>
      </div>

      <div className="px-5 py-4">
        {loading ? (
          <p className="text-sm text-ink4">Loading…</p>
        ) : rules.length === 0 ? (
          <p className="text-sm text-ink4">No recurring invoices set up.</p>
        ) : (
          <div className="space-y-2">
            {rules.map((r) => (
              <div
                key={r.id}
                className="flex items-center justify-between py-2 border-b border-gray-50 last:border-0"
              >
                <div>
                  <p className="text-sm text-ink font-medium">
                    {contactName(r)} — {r.description} — {formatCurrency(Number(r.amount))}
                  </p>
                  <p className="text-xs text-ink4 mt-0.5">{scheduleLabel(r)}</p>
                </div>
                <div className="flex items-center gap-2">
                  <Switch
                    checked={r.enabled}
                    onChange={() => void handleToggleEnabled(r)}
                    size="small"
                    slotProps={{ input: { 'aria-label': 'Toggle rule enabled' } }}
                  />
                  <Button size="small" color="error" onClick={() => void handleDelete(r)}>
                    Delete
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {showForm && (
        <Modal
          onClose={() => setShowForm(false)}
          title="Add Recurring Invoice"
          footer={
            <>
              <Button onClick={() => setShowForm(false)} disabled={saving}>
                Cancel
              </Button>
              <Button variant="contained" onClick={() => void handleCreate()} disabled={saving}>
                {saving ? 'Saving...' : 'Create'}
              </Button>
            </>
          }
        >
          <div className="space-y-4 pt-1">
            {error && <p className="text-sm text-red-700">{error}</p>}

            <TextField
              select
              label="Customer"
              value={form.contactId}
              onChange={(e) => setForm((f) => ({ ...f, contactId: e.target.value }))}
              fullWidth
            >
              {contacts.map((c) => (
                <MenuItem key={c.id} value={c.id}>
                  {c.full_name}
                </MenuItem>
              ))}
            </TextField>

            <TextField
              label="Description"
              placeholder="e.g. Monthly retainer"
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              fullWidth
            />

            <TextField
              label="Amount"
              type="number"
              value={form.amount}
              onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
              slotProps={{ htmlInput: { min: 0, step: 0.01 } }}
              fullWidth
            />

            <div className="grid grid-cols-2 gap-3">
              <TextField
                label="Tax rate (%)"
                type="number"
                value={form.taxRate}
                onChange={(e) => setForm((f) => ({ ...f, taxRate: e.target.value }))}
                slotProps={{ htmlInput: { min: 0, step: 0.1 } }}
                fullWidth
              />
              <TextField
                label="Due (days after issue)"
                type="number"
                value={form.dueDays}
                onChange={(e) => setForm((f) => ({ ...f, dueDays: e.target.value }))}
                slotProps={{ htmlInput: { min: 0 } }}
                fullWidth
              />
            </div>

            <TextField
              select
              label="Frequency"
              value={form.frequency}
              onChange={(e) => setForm((f) => ({ ...f, frequency: e.target.value as Frequency }))}
              fullWidth
            >
              {Object.entries(FREQUENCY_LABELS).map(([value, label]) => (
                <MenuItem key={value} value={value}>
                  {label}
                </MenuItem>
              ))}
            </TextField>

            {form.frequency === 'weekly' && (
              <TextField
                select
                label="Day of week"
                value={form.dayOfWeek}
                onChange={(e) => setForm((f) => ({ ...f, dayOfWeek: Number(e.target.value) }))}
                fullWidth
              >
                {WEEKDAY_LABELS.map((label, i) => (
                  <MenuItem key={i} value={i}>
                    {label}
                  </MenuItem>
                ))}
              </TextField>
            )}

            {(form.frequency === 'monthly' ||
              form.frequency === 'quarterly' ||
              form.frequency === 'annually') && (
              <TextField
                label="Day of month"
                type="number"
                value={form.dayOfMonth}
                onChange={(e) => setForm((f) => ({ ...f, dayOfMonth: Number(e.target.value) }))}
                slotProps={{ htmlInput: { min: 1, max: 31 } }}
                fullWidth
              />
            )}

            {form.frequency === 'annually' && (
              <TextField
                select
                label="Month"
                value={form.monthOfYear}
                onChange={(e) => setForm((f) => ({ ...f, monthOfYear: Number(e.target.value) }))}
                fullWidth
              >
                {MONTH_LABELS.map((label, i) => (
                  <MenuItem key={i} value={i + 1}>
                    {label}
                  </MenuItem>
                ))}
              </TextField>
            )}
          </div>
        </Modal>
      )}
    </div>
  )
}

function ordinalSuffix(n: number): string {
  if (n % 10 === 1 && n % 100 !== 11) return 'st'
  if (n % 10 === 2 && n % 100 !== 12) return 'nd'
  if (n % 10 === 3 && n % 100 !== 13) return 'rd'
  return 'th'
}
