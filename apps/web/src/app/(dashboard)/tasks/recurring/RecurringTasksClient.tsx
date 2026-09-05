'use client'

import { useState, useEffect, useCallback } from 'react'
import TextField from '@mui/material/TextField'
import MenuItem from '@mui/material/MenuItem'
import Button from '@mui/material/Button'
import Switch from '@mui/material/Switch'

interface Contact {
  id: string
  full_name: string
}

interface Rule {
  id: string
  title: string
  contact_id: string | null
  priority: string
  frequency: 'weekly' | 'biweekly' | 'monthly'
  day_of_week: number | null
  day_of_month: number | null
  enabled: boolean
}

const DAY_LABEL = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

interface Props {
  contacts: Contact[]
}

export default function RecurringTasksClient({ contacts }: Props) {
  const [rules, setRules] = useState<Rule[] | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const [contactId, setContactId] = useState('')
  const [title, setTitle] = useState('')
  const [priority, setPriority] = useState('medium')
  const [frequency, setFrequency] = useState<'weekly' | 'biweekly' | 'monthly'>('weekly')
  const [dayOfWeek, setDayOfWeek] = useState(1)
  const [dayOfMonth, setDayOfMonth] = useState(1)

  const load = useCallback(() => {
    fetch('/api/recurring-tasks')
      .then((r) => r.json())
      .then((res: { data: Rule[] }) => setRules(res.data))
  }, [])

  useEffect(load, [load])

  function contactName(id: string | null): string {
    if (!id) return '—'
    return contacts.find((c) => c.id === id)?.full_name ?? '—'
  }

  async function createRule() {
    setError(null)
    if (!title.trim()) {
      setError('Title is required')
      return
    }
    setSaving(true)
    try {
      const res = await fetch('/api/recurring-tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contact_id: contactId || undefined,
          title: title.trim(),
          priority,
          frequency,
          day_of_week: frequency === 'monthly' ? undefined : dayOfWeek,
          day_of_month: frequency === 'monthly' ? dayOfMonth : undefined,
        }),
      })
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string }
        setError(err.error ?? 'Failed to create rule')
        return
      }
      setTitle('')
      setContactId('')
      setShowForm(false)
      load()
    } finally {
      setSaving(false)
    }
  }

  async function toggleEnabled(rule: Rule) {
    await fetch(`/api/recurring-tasks/${rule.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: !rule.enabled }),
    })
    load()
  }

  async function remove(id: string) {
    await fetch(`/api/recurring-tasks/${id}`, { method: 'DELETE' })
    load()
  }

  function scheduleLabel(r: Rule): string {
    if (r.frequency === 'monthly') return `Monthly on day ${r.day_of_month}`
    const day = r.day_of_week != null ? DAY_LABEL[r.day_of_week] : '?'
    return `${r.frequency === 'weekly' ? 'Weekly' : 'Every 2 weeks'} on ${day}`
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button
          onClick={() => setShowForm((v) => !v)}
          variant={showForm ? 'outlined' : 'contained'}
        >
          {showForm ? 'Cancel' : '+ New recurring task'}
        </Button>
      </div>

      {showForm && (
        <div className="bg-white rounded-xl border border-border-brand p-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <TextField
              select
              label="Contact (optional)"
              value={contactId}
              onChange={(e) => setContactId(e.target.value)}
              size="small"
            >
              <MenuItem value="">None</MenuItem>
              {contacts.map((c) => (
                <MenuItem key={c.id} value={c.id}>
                  {c.full_name}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              label="Title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              size="small"
            />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <TextField
              select
              label="Priority"
              value={priority}
              onChange={(e) => setPriority(e.target.value)}
              size="small"
            >
              <MenuItem value="low">Low</MenuItem>
              <MenuItem value="medium">Medium</MenuItem>
              <MenuItem value="high">High</MenuItem>
            </TextField>
            <TextField
              select
              label="Frequency"
              value={frequency}
              onChange={(e) => setFrequency(e.target.value as typeof frequency)}
              size="small"
            >
              <MenuItem value="weekly">Weekly</MenuItem>
              <MenuItem value="biweekly">Every 2 weeks</MenuItem>
              <MenuItem value="monthly">Monthly</MenuItem>
            </TextField>
            {frequency === 'monthly' ? (
              <TextField
                label="Day of month"
                type="number"
                value={dayOfMonth}
                onChange={(e) => setDayOfMonth(Number(e.target.value))}
                size="small"
                slotProps={{ htmlInput: { min: 1, max: 31 } }}
              />
            ) : (
              <TextField
                select
                label="Day"
                value={dayOfWeek}
                onChange={(e) => setDayOfWeek(Number(e.target.value))}
                size="small"
              >
                {DAY_LABEL.map((d, i) => (
                  <MenuItem key={d} value={i}>
                    {d}
                  </MenuItem>
                ))}
              </TextField>
            )}
          </div>
          {error && <p className="text-xs text-red-600">{error}</p>}
          <Button
            onClick={() => void createRule()}
            disabled={saving}
            variant="contained"
            size="small"
          >
            {saving ? 'Saving…' : 'Create rule'}
          </Button>
        </div>
      )}

      <div className="bg-white rounded-xl border border-border-brand overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-bg2 text-ink3 text-xs uppercase tracking-wide">
            <tr>
              <th className="text-left px-4 py-2">Contact</th>
              <th className="text-left px-4 py-2">Title</th>
              <th className="text-left px-4 py-2">Schedule</th>
              <th className="text-left px-4 py-2">Priority</th>
              <th className="text-left px-4 py-2">Active</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border-brand">
            {rules === null ? (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-ink4">
                  Loading…
                </td>
              </tr>
            ) : rules.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-ink4">
                  No recurring tasks yet.
                </td>
              </tr>
            ) : (
              rules.map((r) => (
                <tr key={r.id}>
                  <td className="px-4 py-2.5 text-ink">{contactName(r.contact_id)}</td>
                  <td className="px-4 py-2.5 text-ink">{r.title}</td>
                  <td className="px-4 py-2.5 text-ink3">{scheduleLabel(r)}</td>
                  <td className="px-4 py-2.5 text-ink3">{r.priority}</td>
                  <td className="px-4 py-2.5">
                    <Switch
                      size="small"
                      checked={r.enabled}
                      onChange={() => void toggleEnabled(r)}
                    />
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <button
                      type="button"
                      onClick={() => void remove(r.id)}
                      className="text-xs text-red-600 hover:underline"
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
