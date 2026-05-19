'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

interface BusinessHours {
  mon_fri: string
  sat: string
  sun: string
}

type DaySchedule = { open: string; close: string; enabled: boolean }
type WeekSchedule = Record<string, DaySchedule>

interface Settings {
  maya_enabled: boolean
  escalation_phone: string
  maya_greeting: string
  maya_personality: string
  preferred_languages: string[]
  appointment_duration_default: number
  telnyx_number: string | null
  business_hours: BusinessHours
  after_hours_enabled: boolean
  after_hours_schedule: WeekSchedule
  after_hours_message: string
  timezone: string
}

const PERSONALITIES = [
  { value: 'professional', label: 'Professional', desc: 'Formal and businesslike' },
  { value: 'friendly', label: 'Friendly', desc: 'Warm and approachable' },
  { value: 'casual', label: 'Casual', desc: 'Relaxed and conversational' },
]

const LANGUAGES = [
  { code: 'en', label: 'English' },
  { code: 'es', label: 'Spanish' },
  { code: 'hi', label: 'Hindi' },
  { code: 'te', label: 'Telugu' },
]

const DURATIONS = [15, 30, 45, 60, 90]

const TIMEZONES = [
  { value: 'America/New_York', label: 'Eastern (ET)' },
  { value: 'America/Chicago', label: 'Central (CT)' },
  { value: 'America/Denver', label: 'Mountain (MT)' },
  { value: 'America/Phoenix', label: 'Arizona (MT, no DST)' },
  { value: 'America/Los_Angeles', label: 'Pacific (PT)' },
]

const DAYS: { key: string; label: string }[] = [
  { key: 'mon', label: 'Monday' },
  { key: 'tue', label: 'Tuesday' },
  { key: 'wed', label: 'Wednesday' },
  { key: 'thu', label: 'Thursday' },
  { key: 'fri', label: 'Friday' },
  { key: 'sat', label: 'Saturday' },
  { key: 'sun', label: 'Sunday' },
]

const TIME_SLOTS: string[] = []
for (let h = 6; h <= 22; h++) {
  TIME_SLOTS.push(`${String(h).padStart(2, '0')}:00`)
  if (h < 22) TIME_SLOTS.push(`${String(h).padStart(2, '0')}:30`)
}

function formatPhone(phone: string | null): string {
  if (!phone) return 'Not configured'
  const digits = phone.replace(/\D/g, '')
  if (digits.length === 11 && digits.startsWith('1')) {
    return `+1 (${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`
  }
  return phone
}

export default function VoiceSettingsForm({ settings }: { settings: Settings }) {
  const router = useRouter()
  const [form, setForm] = useState(settings)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [toggling, setToggling] = useState(false)

  // After-hours state
  const [ahEnabled, setAhEnabled] = useState(settings.after_hours_enabled)
  const [ahSchedule, setAhSchedule] = useState<WeekSchedule>(settings.after_hours_schedule)
  const [ahMessage, setAhMessage] = useState(settings.after_hours_message)
  const [ahTimezone, setAhTimezone] = useState(settings.timezone)
  const [savingAh, setSavingAh] = useState(false)

  const hasChanges =
    form.escalation_phone !== settings.escalation_phone ||
    form.maya_greeting !== settings.maya_greeting ||
    form.maya_personality !== settings.maya_personality ||
    form.appointment_duration_default !== settings.appointment_duration_default ||
    JSON.stringify(form.preferred_languages.sort()) !==
      JSON.stringify(settings.preferred_languages.sort())

  const hasAfterHoursChanges =
    ahEnabled !== settings.after_hours_enabled ||
    ahTimezone !== settings.timezone ||
    ahMessage !== settings.after_hours_message ||
    JSON.stringify(ahSchedule) !== JSON.stringify(settings.after_hours_schedule)

  function isCurrentlyOpen(): boolean {
    try {
      const now = new Date()
      const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: ahTimezone,
        weekday: 'short',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }).formatToParts(now)

      const weekdayMap: Record<string, string> = {
        Mon: 'mon',
        Tue: 'tue',
        Wed: 'wed',
        Thu: 'thu',
        Fri: 'fri',
        Sat: 'sat',
        Sun: 'sun',
      }

      const weekday = parts.find((p) => p.type === 'weekday')?.value ?? ''
      const hour = parts.find((p) => p.type === 'hour')?.value ?? '00'
      const minute = parts.find((p) => p.type === 'minute')?.value ?? '00'

      const dayKey = weekdayMap[weekday] ?? weekday.toLowerCase().slice(0, 3)
      const day = ahSchedule[dayKey]
      if (!day || !day.enabled) return false

      const currentTime = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
      return currentTime >= day.open && currentTime < day.close
    } catch {
      return true
    }
  }

  function updateDaySchedule(dayKey: string, field: keyof DaySchedule, value: string | boolean) {
    setAhSchedule((prev) => ({
      ...prev,
      [dayKey]: { ...prev[dayKey]!, [field]: value },
    }))
  }

  async function saveSettings() {
    setSaving(true)
    setMessage(null)
    try {
      const body: Record<string, unknown> = {}
      if (form.maya_personality !== settings.maya_personality)
        body.maya_personality = form.maya_personality
      if (form.maya_greeting !== settings.maya_greeting)
        body.maya_greeting = form.maya_greeting || null
      if (form.escalation_phone !== settings.escalation_phone)
        body.escalation_phone = form.escalation_phone || null
      if (form.appointment_duration_default !== settings.appointment_duration_default)
        body.appointment_duration_default = form.appointment_duration_default
      if (
        JSON.stringify(form.preferred_languages.sort()) !==
        JSON.stringify(settings.preferred_languages.sort())
      )
        body.preferred_languages = form.preferred_languages

      const res = await fetch('/api/maya-settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      if (!res.ok) {
        const data = await res.json()
        setMessage({ type: 'error', text: data.error || 'Failed to save' })
        return
      }

      setMessage({ type: 'success', text: 'Settings saved' })
      router.refresh()
    } catch {
      setMessage({ type: 'error', text: 'Failed to save settings' })
    } finally {
      setSaving(false)
    }
  }

  async function saveAfterHours() {
    setSavingAh(true)
    setMessage(null)
    try {
      const res = await fetch('/api/maya-settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          after_hours_enabled: ahEnabled,
          business_hours: ahSchedule,
          after_hours_message: ahMessage,
          timezone: ahTimezone,
        }),
      })

      if (!res.ok) {
        const data = await res.json()
        setMessage({ type: 'error', text: data.error || 'Failed to save after-hours settings' })
        return
      }

      setMessage({ type: 'success', text: 'After-hours settings saved' })
      router.refresh()
    } catch {
      setMessage({ type: 'error', text: 'Failed to save after-hours settings' })
    } finally {
      setSavingAh(false)
    }
  }

  async function toggleMaya() {
    setToggling(true)
    setMessage(null)
    try {
      const res = await fetch('/api/maya-settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ maya_enabled: !form.maya_enabled }),
      })

      if (res.ok) {
        setForm((prev) => ({ ...prev, maya_enabled: !prev.maya_enabled }))
        router.refresh()
      } else {
        const data = await res.json()
        setMessage({ type: 'error', text: data.error || 'Failed to toggle' })
      }
    } catch {
      setMessage({ type: 'error', text: 'Failed to toggle Maya' })
    } finally {
      setToggling(false)
    }
  }

  function toggleLanguage(code: string) {
    setForm((prev) => {
      const has = prev.preferred_languages.includes(code)
      if (has && prev.preferred_languages.length <= 1) return prev
      return {
        ...prev,
        preferred_languages: has
          ? prev.preferred_languages.filter((l) => l !== code)
          : [...prev.preferred_languages, code],
      }
    })
  }

  return (
    <div className="max-w-xl space-y-6">
      {/* Status message */}
      {message && (
        <div
          className={`px-4 py-2 rounded-lg text-sm ${
            message.type === 'success' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-600'
          }`}
        >
          {message.text}
        </div>
      )}

      {/* 1. Maya Status */}
      <div className="bg-white rounded-xl border border-border-brand p-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div
              className={`w-3 h-3 rounded-full ${form.maya_enabled ? 'bg-green-500' : 'bg-gray-300'}`}
            />
            <div>
              <h2 className="text-sm font-semibold text-ink">
                Maya is {form.maya_enabled ? 'active' : 'paused'}
              </h2>
              <p className="text-xs text-ink4 mt-0.5">
                {form.maya_enabled
                  ? 'Maya is answering incoming calls'
                  : 'Maya will not answer calls while paused'}
              </p>
            </div>
          </div>
          <button
            onClick={toggleMaya}
            disabled={toggling}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-teal-500 focus:ring-offset-2 disabled:opacity-50 ${
              form.maya_enabled ? 'bg-teal-600' : 'bg-bg3'
            }`}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                form.maya_enabled ? 'translate-x-6' : 'translate-x-1'
              }`}
            />
          </button>
        </div>
        {!form.maya_enabled && (
          <div className="mt-3 px-3 py-2 bg-amber-50 rounded-lg">
            <p className="text-xs text-amber-700">
              Maya will not answer incoming calls while paused. Calls will go to voicemail.
            </p>
          </div>
        )}
      </div>

      {/* 2. Greeting & Personality */}
      <div className="bg-white rounded-xl border border-border-brand p-6">
        <h2 className="text-sm font-semibold text-ink mb-1">Greeting &amp; Personality</h2>
        <p className="text-xs text-ink4 mb-4">
          Customize how Maya introduces herself and her tone of voice
        </p>

        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-ink2 mb-1.5">Custom Greeting</label>
            <input
              type="text"
              value={form.maya_greeting}
              onChange={(e) => setForm({ ...form, maya_greeting: e.target.value })}
              placeholder="e.g. Welcome to Riverside Dental! How can I help you today?"
              className="w-full px-3 py-2 text-sm border border-border-brand rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent placeholder:text-gray-300"
            />
            <p className="text-[11px] text-ink4 mt-1">
              Leave blank to use the default greeting for your business type
            </p>
          </div>

          <div>
            <label className="block text-xs font-medium text-ink2 mb-2">Personality</label>
            <div className="space-y-2">
              {PERSONALITIES.map((p) => (
                <label
                  key={p.value}
                  className={`flex items-center gap-3 px-3 py-2.5 rounded-lg border cursor-pointer transition-colors ${
                    form.maya_personality === p.value
                      ? 'border-teal-500 bg-teal-50'
                      : 'border-border-brand hover:bg-bg'
                  }`}
                >
                  <input
                    type="radio"
                    name="personality"
                    value={p.value}
                    checked={form.maya_personality === p.value}
                    onChange={() => setForm({ ...form, maya_personality: p.value })}
                    className="text-teal-600 focus:ring-teal-500"
                  />
                  <div>
                    <p className="text-sm font-medium text-ink">{p.label}</p>
                    <p className="text-xs text-ink4">{p.desc}</p>
                  </div>
                </label>
              ))}
            </div>
            <p className="text-[11px] text-ink4 mt-2">
              Professional is recommended for medical and legal businesses
            </p>
          </div>
        </div>
      </div>

      {/* 3. Business Hours */}
      <div className="bg-white rounded-xl border border-border-brand p-6">
        <h2 className="text-sm font-semibold text-ink mb-1">Business Hours</h2>
        <p className="text-xs text-ink4 mb-4">
          Maya uses these hours to schedule appointments and inform callers
        </p>

        <div className="space-y-2">
          <div className="flex items-start justify-between py-2 border-b border-gray-50">
            <p className="text-sm text-ink3">Mon&ndash;Fri</p>
            <p className="text-sm text-ink">{settings.business_hours.mon_fri}</p>
          </div>
          <div className="flex items-start justify-between py-2 border-b border-gray-50">
            <p className="text-sm text-ink3">Saturday</p>
            <p className="text-sm text-ink capitalize">{settings.business_hours.sat}</p>
          </div>
          <div className="flex items-start justify-between py-2">
            <p className="text-sm text-ink3">Sunday</p>
            <p className="text-sm text-ink capitalize">{settings.business_hours.sun}</p>
          </div>
        </div>

        <p className="text-[11px] text-ink4 mt-3">
          Business hours are set per your vertical configuration. Contact support to update.
        </p>
      </div>

      {/* 4. Call Handling */}
      <div className="bg-white rounded-xl border border-border-brand p-6">
        <h2 className="text-sm font-semibold text-ink mb-1">Call Handling</h2>
        <p className="text-xs text-ink4 mb-4">Configure appointment booking and escalation</p>

        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-ink2 mb-1.5">
              Default Appointment Duration
            </label>
            <select
              value={form.appointment_duration_default}
              onChange={(e) =>
                setForm({ ...form, appointment_duration_default: parseInt(e.target.value, 10) })
              }
              className="w-full px-3 py-2 text-sm border border-border-brand rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent"
            >
              {DURATIONS.map((d) => (
                <option key={d} value={d}>
                  {d} minutes
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-ink2 mb-1.5">Transfer calls to</label>
            <input
              type="tel"
              value={form.escalation_phone}
              onChange={(e) => setForm({ ...form, escalation_phone: e.target.value })}
              placeholder="+1 (555) 000-0000"
              className="w-full px-3 py-2 text-sm border border-border-brand rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent placeholder:text-gray-300"
            />
            <p className="text-[11px] text-ink4 mt-1">
              When a caller asks to speak with someone, Maya transfers the call here. Must be in
              E.164 format (e.g. +15551234567). Leave blank to disable transfers.
            </p>
          </div>
        </div>
      </div>

      {/* 5. Languages */}
      <div className="bg-white rounded-xl border border-border-brand p-6">
        <h2 className="text-sm font-semibold text-ink mb-1">Languages</h2>
        <p className="text-xs text-ink4 mb-4">
          Maya will respond in whichever language the caller speaks, if it&apos;s in this list
        </p>

        <div className="space-y-2">
          {LANGUAGES.map((lang) => (
            <label
              key={lang.code}
              className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-bg cursor-pointer"
            >
              <input
                type="checkbox"
                checked={form.preferred_languages.includes(lang.code)}
                onChange={() => toggleLanguage(lang.code)}
                className="rounded text-teal-600 focus:ring-teal-500"
              />
              <span className="text-sm text-ink">{lang.label}</span>
            </label>
          ))}
        </div>
        <p className="text-[11px] text-ink4 mt-2">At least one language must be selected</p>
      </div>

      {/* 6. After-Hours Mode */}
      <div className="bg-white rounded-xl border border-border-brand p-6">
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-sm font-semibold text-ink">After-Hours Mode</h2>
          <button
            onClick={() => setAhEnabled((v) => !v)}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-teal-500 focus:ring-offset-2 ${
              ahEnabled ? 'bg-teal-600' : 'bg-bg3'
            }`}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                ahEnabled ? 'translate-x-6' : 'translate-x-1'
              }`}
            />
          </button>
        </div>
        <p className="text-xs text-ink4 mb-4">
          When enabled, Maya delivers a custom message to callers outside your business hours
        </p>

        {ahEnabled && (
          <div className="space-y-4">
            {/* Timezone */}
            <div>
              <label className="block text-xs font-medium text-ink2 mb-1.5">Timezone</label>
              <select
                value={ahTimezone}
                onChange={(e) => setAhTimezone(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-border-brand rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent"
              >
                {TIMEZONES.map((tz) => (
                  <option key={tz.value} value={tz.value}>
                    {tz.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Hours grid */}
            <div>
              <label className="block text-xs font-medium text-ink2 mb-2">Business Hours</label>
              <div className="space-y-2">
                {DAYS.map(({ key, label }) => {
                  const day = ahSchedule[key] ?? { open: '09:00', close: '17:00', enabled: false }
                  return (
                    <div key={key} className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => updateDaySchedule(key, 'enabled', !day.enabled)}
                        className={`relative inline-flex h-5 w-9 flex-shrink-0 items-center rounded-full transition-colors ${
                          day.enabled ? 'bg-teal-600' : 'bg-bg3'
                        }`}
                      >
                        <span
                          className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                            day.enabled ? 'translate-x-[18px]' : 'translate-x-0.5'
                          }`}
                        />
                      </button>
                      <span className="w-20 text-sm text-ink">{label}</span>
                      {day.enabled ? (
                        <>
                          <select
                            value={day.open}
                            onChange={(e) => updateDaySchedule(key, 'open', e.target.value)}
                            className="text-xs border border-border-brand rounded-md px-2 py-1 bg-white focus:outline-none focus:ring-1 focus:ring-teal-500"
                          >
                            {TIME_SLOTS.map((t) => (
                              <option key={t} value={t}>
                                {t}
                              </option>
                            ))}
                          </select>
                          <span className="text-xs text-ink4">to</span>
                          <select
                            value={day.close}
                            onChange={(e) => updateDaySchedule(key, 'close', e.target.value)}
                            className="text-xs border border-border-brand rounded-md px-2 py-1 bg-white focus:outline-none focus:ring-1 focus:ring-teal-500"
                          >
                            {TIME_SLOTS.map((t) => (
                              <option key={t} value={t}>
                                {t}
                              </option>
                            ))}
                          </select>
                        </>
                      ) : (
                        <span className="text-xs text-ink4">Closed</span>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>

            {/* After-hours message */}
            <div>
              <label className="block text-xs font-medium text-ink2 mb-1.5">
                After-Hours Message
              </label>
              <textarea
                value={ahMessage}
                onChange={(e) => setAhMessage(e.target.value.slice(0, 300))}
                rows={3}
                placeholder="We are currently closed. Please leave your name and number..."
                className="w-full px-3 py-2 text-sm border border-border-brand rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent placeholder:text-gray-300 resize-none"
              />
              <p className="text-[11px] text-ink4 mt-1 text-right">{ahMessage.length}/300</p>
            </div>

            {/* Status preview */}
            <div className="flex items-center gap-2">
              <span className="text-xs text-ink4">Right now:</span>
              {isCurrentlyOpen() ? (
                <span className="px-2 py-0.5 bg-green-100 text-green-700 text-xs font-medium rounded-full">
                  OPEN
                </span>
              ) : (
                <span className="px-2 py-0.5 bg-amber-100 text-amber-700 text-xs font-medium rounded-full">
                  CLOSED — after-hours active
                </span>
              )}
            </div>

            {/* Save after-hours */}
            <div className="flex items-center gap-3 pt-1">
              <button
                onClick={saveAfterHours}
                disabled={savingAh || !hasAfterHoursChanges}
                className="px-4 py-2 bg-teal-600 text-white text-sm font-medium rounded-lg hover:bg-teal-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {savingAh ? 'Saving…' : 'Save After-Hours Settings'}
              </button>
              {hasAfterHoursChanges && <p className="text-xs text-ink4">Unsaved changes</p>}
            </div>
          </div>
        )}

        {!ahEnabled && (
          <div className="flex items-center gap-3 pt-1">
            <button
              onClick={saveAfterHours}
              disabled={savingAh || !hasAfterHoursChanges}
              className="px-4 py-2 bg-teal-600 text-white text-sm font-medium rounded-lg hover:bg-teal-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {savingAh ? 'Saving…' : 'Save'}
            </button>
            {hasAfterHoursChanges && <p className="text-xs text-ink4">Unsaved changes</p>}
          </div>
        )}
      </div>

      {/* 7. Phone Number (read-only) */}
      <div className="bg-white rounded-xl border border-border-brand p-6">
        <h2 className="text-sm font-semibold text-ink mb-1">Phone Number</h2>
        <p className="text-xs text-ink4 mb-4">This is the number callers dial to reach Maya</p>
        <p className="text-lg font-semibold text-ink">{formatPhone(settings.telnyx_number)}</p>
      </div>

      {/* 8. Save button */}
      <div className="flex items-center gap-3">
        <button
          onClick={saveSettings}
          disabled={saving || !hasChanges}
          className="px-4 py-2 bg-teal-600 text-white text-sm font-medium rounded-lg hover:bg-teal-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {saving ? 'Saving…' : 'Save Settings'}
        </button>
        {hasChanges && <p className="text-xs text-ink4">You have unsaved changes</p>}
      </div>
    </div>
  )
}
