'use client'

import { useState, useEffect } from 'react'
import { useSession } from 'next-auth/react'
import Switch from '@mui/material/Switch'
import Button from '@mui/material/Button'

// ─── Types ────────────────────────────────────────────────────────────────────

interface ChannelPrefs {
  push: boolean
  sms: boolean
  email: boolean
}

type NotificationPrefs = Record<string, ChannelPrefs>

// ─── Event definitions ────────────────────────────────────────────────────────

interface EventDef {
  key: string
  label: string
  requireModule?: string
}

const EVENTS: EventDef[] = [
  { key: 'new_contact', label: 'New Contact' },
  { key: 'appointment_booked', label: 'Appointment Booked' },
  { key: 'appointment_completed', label: 'Appointment Completed' },
  { key: 'quote_viewed', label: 'Quote Viewed' },
  { key: 'quote_accepted', label: 'Quote Accepted' },
  { key: 'deposit_paid', label: 'Deposit Paid' },
  { key: 'new_sms', label: 'New SMS' },
  { key: 'task_due', label: 'Task Due' },
  { key: 'review_sent', label: 'Review Request Sent' },
  { key: 'form_submitted', label: 'Form Submitted' },
  { key: 'low_lead_score', label: 'Lead Score Alert' },
  { key: 'contact_assigned', label: 'Contact Assigned' },
  { key: 'inventory_low_stock', label: 'Low Stock Alert', requireModule: 'crm' },
  { key: 'staff_shift_conflict', label: 'Shift Conflict', requireModule: 'crm' },
]

const DEFAULT_PREFS: NotificationPrefs = {
  new_contact: { push: true, sms: false, email: false },
  appointment_booked: { push: true, sms: false, email: true },
  appointment_completed: { push: false, sms: false, email: false },
  quote_viewed: { push: true, sms: false, email: true },
  quote_accepted: { push: true, sms: false, email: true },
  deposit_paid: { push: true, sms: false, email: true },
  new_sms: { push: true, sms: false, email: false },
  task_due: { push: true, sms: false, email: false },
  review_sent: { push: false, sms: false, email: false },
  form_submitted: { push: true, sms: false, email: false },
  low_lead_score: { push: true, sms: false, email: false },
  contact_assigned: { push: true, sms: false, email: false },
  inventory_low_stock: { push: true, sms: false, email: false },
  staff_shift_conflict: { push: true, sms: false, email: false },
}

// ─── Toggle component ─────────────────────────────────────────────────────────

function Toggle({
  checked,
  onChange,
  disabled,
  ariaLabel,
}: {
  checked: boolean
  onChange: (val: boolean) => void
  disabled?: boolean
  ariaLabel: string
}) {
  return (
    <Switch
      size="small"
      checked={checked}
      onChange={(e) => onChange(e.target.checked)}
      disabled={disabled}
      slotProps={{ input: { 'aria-label': ariaLabel } }}
    />
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function NotificationSettingsPage() {
  const { data: session } = useSession()
  const [prefs, setPrefs] = useState<NotificationPrefs>(DEFAULT_PREFS)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState<{ type: 'success' | 'error'; msg: string } | null>(null)

  // ─── Weekly Digest state ───────────────────────────────────────────────────
  const [digestEnabled, setDigestEnabled] = useState(true)
  const [digestSaving, setDigestSaving] = useState(false)
  const [digestToast, setDigestToast] = useState<{ type: 'success' | 'error'; msg: string } | null>(
    null
  )
  const [testSending, setTestSending] = useState(false)
  const [testToast, setTestToast] = useState<string | null>(null)

  const modules = ((session?.user as Record<string, unknown> | undefined)?.['modules'] ??
    {}) as Record<string, boolean>
  const visibleEvents = EVENTS.filter((e) => !e.requireModule || modules[e.requireModule] !== false)

  const authHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
  }

  useEffect(() => {
    fetch('/api/settings/notifications', { headers: authHeaders })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: NotificationPrefs | null) => {
        if (data) setPrefs(data)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  function toggle(eventKey: string, channel: keyof ChannelPrefs) {
    setPrefs((prev) => {
      const current: ChannelPrefs = prev[eventKey] ?? { push: false, sms: false, email: false }
      const updated: ChannelPrefs = { ...current, [channel]: !current[channel] }
      return { ...prev, [eventKey]: updated }
    })
  }

  async function save() {
    setSaving(true)
    setToast(null)
    try {
      const res = await fetch('/api/settings/notifications', {
        method: 'PUT',
        headers: authHeaders,
        body: JSON.stringify(prefs),
      })
      if (res.ok) {
        const data = await res.json()
        setPrefs(data as NotificationPrefs)
        setToast({ type: 'success', msg: 'Preferences saved' })
      } else {
        const d = await res.json().catch(() => ({}))
        setToast({ type: 'error', msg: (d as { error?: string }).error || 'Failed to save' })
      }
    } catch {
      setToast({ type: 'error', msg: 'Failed to save preferences' })
    } finally {
      setSaving(false)
      setTimeout(() => setToast(null), 4000)
    }
  }

  function resetToDefaults() {
    setPrefs(DEFAULT_PREFS)
  }

  async function toggleDigest(newValue: boolean) {
    setDigestSaving(true)
    setDigestToast(null)
    try {
      const res = await fetch('/api/digest/preferences', {
        method: 'PUT',
        headers: authHeaders,
        body: JSON.stringify({ digest_enabled: newValue }),
      })
      if (res.ok) {
        setDigestEnabled(newValue)
        setDigestToast({
          type: 'success',
          msg: newValue ? 'Weekly digest enabled' : 'Weekly digest disabled',
        })
      } else {
        const d = await res.json().catch(() => ({}))
        setDigestToast({
          type: 'error',
          msg: (d as { error?: string }).error || 'Failed to update',
        })
      }
    } catch {
      setDigestToast({ type: 'error', msg: 'Failed to update digest preference' })
    } finally {
      setDigestSaving(false)
      setTimeout(() => setDigestToast(null), 2000)
    }
  }

  async function sendTestDigest() {
    setTestSending(true)
    setTestToast(null)
    try {
      const res = await fetch('/api/digest/send-test', {
        method: 'POST',
        headers: authHeaders,
      })
      if (res.ok) {
        const d = await res.json()
        setTestToast(`Test sent to ${(d as { sent_to: string }).sent_to}`)
      } else {
        setTestToast('Failed to send test')
      }
    } catch {
      setTestToast('Failed to send test')
    } finally {
      setTestSending(false)
      setTimeout(() => setTestToast(null), 3000)
    }
  }

  if (loading) {
    return (
      <div className="px-8 py-8 max-w-3xl">
        <p className="text-sm text-ink4">Loading preferences...</p>
      </div>
    )
  }

  return (
    <div className="px-8 py-8 max-w-3xl space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-ink mb-1">Notification Preferences</h1>
        <p className="text-sm text-ink3">Choose how you want to be notified for each event.</p>
      </div>

      {/* Matrix table */}
      <div className="bg-white rounded-xl border border-border-brand overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-border-brand">
              <th className="text-left px-6 py-3 text-xs font-semibold text-ink3 uppercase tracking-wide w-full">
                Event
              </th>
              <th className="px-6 py-3 text-center text-xs font-semibold text-ink3 uppercase tracking-wide whitespace-nowrap">
                Push
              </th>
              <th className="px-6 py-3 text-center text-xs font-semibold text-ink3 uppercase tracking-wide whitespace-nowrap">
                <div>SMS</div>
                <div className="text-[10px] font-normal text-amber-600 normal-case tracking-normal mt-0.5">
                  charges may apply
                </div>
              </th>
              <th className="px-6 py-3 text-center text-xs font-semibold text-ink3 uppercase tracking-wide whitespace-nowrap">
                <div>Email</div>
                <div className="text-[10px] font-normal text-ink4 normal-case tracking-normal mt-0.5">
                  coming soon
                </div>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {visibleEvents.map(({ key, label }) => (
              <tr key={key} className="hover:bg-gray-50/50 transition-colors">
                <td className="px-6 py-3.5 text-sm text-ink">{label}</td>
                <td className="px-6 py-3.5 text-center">
                  <div className="flex justify-center">
                    <Toggle
                      checked={prefs[key]?.push ?? false}
                      onChange={() => toggle(key, 'push')}
                      ariaLabel={`Push notifications for ${label}`}
                    />
                  </div>
                </td>
                <td className="px-6 py-3.5 text-center">
                  <div className="flex justify-center">
                    <Toggle
                      checked={prefs[key]?.sms ?? false}
                      onChange={() => toggle(key, 'sms')}
                      ariaLabel={`SMS notifications for ${label}`}
                    />
                  </div>
                </td>
                <td className="px-6 py-3.5 text-center">
                  <div className="flex justify-center">
                    <Toggle
                      checked={prefs[key]?.email ?? false}
                      onChange={() => toggle(key, 'email')}
                      disabled
                      ariaLabel={`Email notifications for ${label}`}
                    />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Toast */}
      {toast && (
        <p
          className={`text-sm px-3 py-2 rounded-lg ${
            toast.type === 'success' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-600'
          }`}
        >
          {toast.msg}
        </p>
      )}

      {/* Actions */}
      <div className="flex items-center gap-3">
        <Button onClick={save} disabled={saving} variant="contained">
          {saving ? 'Saving...' : 'Save Preferences'}
        </Button>
        <Button onClick={resetToDefaults} disabled={saving} color="inherit" variant="outlined">
          Reset to Defaults
        </Button>
      </div>

      {/* Weekly Digest card */}
      <div className="bg-white rounded-xl border border-border-brand overflow-hidden">
        {/* Card header */}
        <div className="px-6 py-4 border-b border-border-brand flex items-center justify-between gap-4">
          <div>
            <h2 className="text-sm font-semibold text-ink">Weekly Digest</h2>
            <p className="text-xs text-ink3 mt-0.5">
              Every Monday morning — contacts, appointments, pipeline, and Maya call summary
            </p>
          </div>
          <Toggle
            checked={digestEnabled}
            onChange={toggleDigest}
            disabled={digestSaving}
            ariaLabel="Weekly digest"
          />
        </div>

        {/* Card body */}
        <div className="px-6 py-4 flex items-center gap-4">
          <Button
            onClick={sendTestDigest}
            disabled={testSending}
            color="inherit"
            variant="outlined"
            sx={{ whiteSpace: 'nowrap' }}
          >
            {testSending ? 'Sending...' : 'Send test digest'}
          </Button>

          {/* Inline feedback */}
          {testToast && <p className="text-sm text-ink3">{testToast}</p>}
          {digestToast && !testToast && (
            <p
              className={`text-sm ${
                digestToast.type === 'success' ? 'text-green-700' : 'text-red-600'
              }`}
            >
              {digestToast.msg}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
