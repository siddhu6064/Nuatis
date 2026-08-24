'use client'

import { useState, useEffect, useCallback } from 'react'
import TextField from '@mui/material/TextField'
import MenuItem from '@mui/material/MenuItem'
import Button from '@mui/material/Button'
import Switch from '@mui/material/Switch'
import { Modal } from '@/components/ui/Modal'
import {
  FREQUENCY_LABELS,
  type ExpenseCategory,
  type RecurringExpense,
  type RecurringFrequency,
} from '@/components/expenses/types'

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

interface RuleFormState {
  categoryId: string
  amount: string
  vendor: string
  notes: string
  frequency: RecurringFrequency
  dayOfWeek: number
  dayOfMonth: number
  monthOfYear: number
}

const EMPTY_FORM: RuleFormState = {
  categoryId: '',
  amount: '',
  vendor: '',
  notes: '',
  frequency: 'monthly',
  dayOfWeek: 1,
  dayOfMonth: 1,
  monthOfYear: 1,
}

interface Props {
  categories: ExpenseCategory[]
}

export default function RecurringExpensesPanel({ categories }: Props) {
  const [rules, setRules] = useState<RecurringExpense[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState<RuleFormState>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const fetchRules = useCallback(async () => {
    const res = await fetch('/api/recurring-expenses')
    if (res.ok) {
      const data = (await res.json()) as { data: RecurringExpense[] }
      setRules(data.data)
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    void fetchRules()
  }, [fetchRules])

  async function handleCreate() {
    setError('')
    const amountNum = Number(form.amount)
    if (!Number.isFinite(amountNum) || amountNum <= 0) {
      setError('Amount must be a number greater than 0')
      return
    }

    setSaving(true)
    try {
      const body: Record<string, unknown> = {
        category_id: form.categoryId || null,
        amount: amountNum,
        vendor: form.vendor.trim() || null,
        notes: form.notes.trim() || null,
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

      const res = await fetch('/api/recurring-expenses', {
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

  async function handleToggleEnabled(rule: RecurringExpense) {
    const res = await fetch(`/api/recurring-expenses/${rule.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: !rule.enabled }),
    })
    if (res.ok) await fetchRules()
  }

  async function handleDelete(rule: RecurringExpense) {
    if (!confirm('Delete this recurring expense rule?')) return
    const res = await fetch(`/api/recurring-expenses/${rule.id}`, { method: 'DELETE' })
    if (res.ok) await fetchRules()
  }

  function scheduleLabel(rule: RecurringExpense): string {
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

  return (
    <div className="bg-white rounded-xl border border-border-brand">
      <div className="px-5 py-4 border-b border-border-brand flex items-center justify-between">
        <h2 className="text-sm font-semibold text-ink">Recurring Expenses</h2>
        <Button size="small" variant="outlined" onClick={() => setShowForm(true)}>
          + Add Rule
        </Button>
      </div>

      <div className="px-5 py-4">
        {loading ? (
          <p className="text-sm text-ink4">Loading…</p>
        ) : rules.length === 0 ? (
          <p className="text-sm text-ink4">No recurring expenses set up.</p>
        ) : (
          <div className="space-y-2">
            {rules.map((r) => (
              <div
                key={r.id}
                className="flex items-center justify-between py-2 border-b border-gray-50 last:border-0"
              >
                <div>
                  <p className="text-sm text-ink font-medium">
                    {r.vendor || r.expense_categories?.name || 'Recurring expense'} — $
                    {Number(r.amount).toFixed(2)}
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
          title="Add Recurring Expense"
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
              label="Amount"
              type="number"
              value={form.amount}
              onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
              slotProps={{ htmlInput: { min: 0, step: 0.01 } }}
              fullWidth
            />

            <TextField
              select
              label="Category"
              value={form.categoryId}
              onChange={(e) => setForm((f) => ({ ...f, categoryId: e.target.value }))}
              fullWidth
            >
              <MenuItem value="">Uncategorized</MenuItem>
              {categories.map((c) => (
                <MenuItem key={c.id} value={c.id}>
                  {c.name}
                </MenuItem>
              ))}
            </TextField>

            <TextField
              label="Vendor"
              value={form.vendor}
              onChange={(e) => setForm((f) => ({ ...f, vendor: e.target.value }))}
              fullWidth
            />

            <TextField
              select
              label="Frequency"
              value={form.frequency}
              onChange={(e) =>
                setForm((f) => ({ ...f, frequency: e.target.value as RecurringFrequency }))
              }
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

            <TextField
              label="Notes"
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              multiline
              minRows={2}
              fullWidth
            />
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
