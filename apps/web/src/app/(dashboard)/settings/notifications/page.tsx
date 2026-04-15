'use client'

import { useState, useEffect } from 'react'
import { useSession } from 'next-auth/react'

// ─── Types ────────────────────────────────────────────────────────────────────

interface ChannelPrefs {
  push: boolean
  sms: boolean
  email: boolean
}

type NotificationPrefs = Record<string, ChannelPrefs>

// ─── Event definitions ────────────────────────────────────────────────────────

const EVENTS = [
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
}

// ─── Toggle component ─────────────────────────────────────────────────────────

function Toggle({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean
  onChange: (val: boolean) => void
  disabled?: boolean
}) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={() => !disabled && onChange(!checked)}
      disabled={disabled}
      className={`relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-40 ${
        checked ? 'bg-teal-600' : 'bg-gray-200'
      }`}
    >
      <span
        className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
          checked ? 'translate-x-4' : 'translate-x-0'
        }`}
      />
    </button>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function NotificationSettingsPage() {
  const { data: session } = useSession()
  const [prefs, setPrefs] = useState<NotificationPrefs>(DEFAULT_PREFS)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState<{ type: 'success' | 'error'; msg: string } | null>(null)

  const token = (session as Record<string, unknown>)?.accessToken ?? ''
  const authHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token as string}` } : {}),
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
    setPrefs((prev) => ({
      ...prev,
      [eventKey]: {
        ...prev[eventKey],
        [channel]: !prev[eventKey]?.[channel],
      },
    }))
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

  if (loading) {
    return (
      <div className="px-8 py-8 max-w-3xl">
        <p className="text-sm text-gray-400">Loading preferences...</p>
      </div>
    )
  }

  return (
    <div className="px-8 py-8 max-w-3xl space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-gray-900 mb-1">Notification Preferences</h1>
        <p className="text-sm text-gray-500">Choose how you want to be notified for each event.</p>
      </div>

      {/* Matrix table */}
      <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-gray-100">
              <th className="text-left px-6 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide w-full">
                Event
              </th>
              <th className="px-6 py-3 text-center text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">
                Push
              </th>
              <th className="px-6 py-3 text-center text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">
                <div>SMS</div>
                <div className="text-[10px] font-normal text-amber-600 normal-case tracking-normal mt-0.5">
                  charges may apply
                </div>
              </th>
              <th className="px-6 py-3 text-center text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">
                <div>Email</div>
                <div className="text-[10px] font-normal text-gray-400 normal-case tracking-normal mt-0.5">
                  coming soon
                </div>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {EVENTS.map(({ key, label }) => (
              <tr key={key} className="hover:bg-gray-50/50 transition-colors">
                <td className="px-6 py-3.5 text-sm text-gray-800">{label}</td>
                <td className="px-6 py-3.5 text-center">
                  <div className="flex justify-center">
                    <Toggle
                      checked={prefs[key]?.push ?? false}
                      onChange={() => toggle(key, 'push')}
                    />
                  </div>
                </td>
                <td className="px-6 py-3.5 text-center">
                  <div className="flex justify-center">
                    <Toggle
                      checked={prefs[key]?.sms ?? false}
                      onChange={() => toggle(key, 'sms')}
                    />
                  </div>
                </td>
                <td className="px-6 py-3.5 text-center">
                  <div className="flex justify-center">
                    <Toggle
                      checked={prefs[key]?.email ?? false}
                      onChange={() => toggle(key, 'email')}
                      disabled
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
      <div className="flex items-center gap-3 pb-8">
        <button
          onClick={save}
          disabled={saving}
          className="px-4 py-2 bg-teal-600 text-white text-sm font-medium rounded-lg hover:bg-teal-700 disabled:opacity-50 transition-colors"
        >
          {saving ? 'Saving...' : 'Save Preferences'}
        </button>
        <button
          type="button"
          onClick={resetToDefaults}
          disabled={saving}
          className="px-4 py-2 bg-white text-gray-600 text-sm font-medium rounded-lg border border-gray-200 hover:bg-gray-50 disabled:opacity-50 transition-colors"
        >
          Reset to Defaults
        </button>
      </div>
    </div>
  )
}
