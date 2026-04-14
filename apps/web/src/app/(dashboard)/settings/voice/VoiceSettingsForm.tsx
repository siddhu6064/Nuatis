'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

interface BusinessHours {
  mon_fri: string
  sat: string
  sun: string
}

interface Settings {
  maya_enabled: boolean
  escalation_phone: string
  maya_greeting: string
  maya_personality: string
  preferred_languages: string[]
  appointment_duration_default: number
  telnyx_number: string | null
  business_hours: BusinessHours
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

  const hasChanges =
    form.escalation_phone !== settings.escalation_phone ||
    form.maya_greeting !== settings.maya_greeting ||
    form.maya_personality !== settings.maya_personality ||
    form.appointment_duration_default !== settings.appointment_duration_default ||
    JSON.stringify(form.preferred_languages.sort()) !==
      JSON.stringify(settings.preferred_languages.sort())

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
      <div className="bg-white rounded-xl border border-gray-100 p-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div
              className={`w-3 h-3 rounded-full ${form.maya_enabled ? 'bg-green-500' : 'bg-gray-300'}`}
            />
            <div>
              <h2 className="text-sm font-semibold text-gray-900">
                Maya is {form.maya_enabled ? 'active' : 'paused'}
              </h2>
              <p className="text-xs text-gray-400 mt-0.5">
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
              form.maya_enabled ? 'bg-teal-600' : 'bg-gray-200'
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
      <div className="bg-white rounded-xl border border-gray-100 p-6">
        <h2 className="text-sm font-semibold text-gray-900 mb-1">Greeting &amp; Personality</h2>
        <p className="text-xs text-gray-400 mb-4">
          Customize how Maya introduces herself and her tone of voice
        </p>

        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1.5">
              Custom Greeting
            </label>
            <input
              type="text"
              value={form.maya_greeting}
              onChange={(e) => setForm({ ...form, maya_greeting: e.target.value })}
              placeholder="e.g. Welcome to Riverside Dental! How can I help you today?"
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent placeholder:text-gray-300"
            />
            <p className="text-[11px] text-gray-400 mt-1">
              Leave blank to use the default greeting for your business type
            </p>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700 mb-2">Personality</label>
            <div className="space-y-2">
              {PERSONALITIES.map((p) => (
                <label
                  key={p.value}
                  className={`flex items-center gap-3 px-3 py-2.5 rounded-lg border cursor-pointer transition-colors ${
                    form.maya_personality === p.value
                      ? 'border-teal-500 bg-teal-50'
                      : 'border-gray-100 hover:bg-gray-50'
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
                    <p className="text-sm font-medium text-gray-900">{p.label}</p>
                    <p className="text-xs text-gray-400">{p.desc}</p>
                  </div>
                </label>
              ))}
            </div>
            <p className="text-[11px] text-gray-400 mt-2">
              Professional is recommended for medical and legal businesses
            </p>
          </div>
        </div>
      </div>

      {/* 3. Business Hours */}
      <div className="bg-white rounded-xl border border-gray-100 p-6">
        <h2 className="text-sm font-semibold text-gray-900 mb-1">Business Hours</h2>
        <p className="text-xs text-gray-400 mb-4">
          Maya uses these hours to schedule appointments and inform callers
        </p>

        <div className="space-y-2">
          <div className="flex items-start justify-between py-2 border-b border-gray-50">
            <p className="text-sm text-gray-500">Mon&ndash;Fri</p>
            <p className="text-sm text-gray-900">{settings.business_hours.mon_fri}</p>
          </div>
          <div className="flex items-start justify-between py-2 border-b border-gray-50">
            <p className="text-sm text-gray-500">Saturday</p>
            <p className="text-sm text-gray-900 capitalize">{settings.business_hours.sat}</p>
          </div>
          <div className="flex items-start justify-between py-2">
            <p className="text-sm text-gray-500">Sunday</p>
            <p className="text-sm text-gray-900 capitalize">{settings.business_hours.sun}</p>
          </div>
        </div>

        <p className="text-[11px] text-gray-400 mt-3">
          Business hours are set per your vertical configuration. Contact support to update.
        </p>
      </div>

      {/* 4. Call Handling */}
      <div className="bg-white rounded-xl border border-gray-100 p-6">
        <h2 className="text-sm font-semibold text-gray-900 mb-1">Call Handling</h2>
        <p className="text-xs text-gray-400 mb-4">Configure appointment booking and escalation</p>

        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1.5">
              Default Appointment Duration
            </label>
            <select
              value={form.appointment_duration_default}
              onChange={(e) =>
                setForm({ ...form, appointment_duration_default: parseInt(e.target.value, 10) })
              }
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent"
            >
              {DURATIONS.map((d) => (
                <option key={d} value={d}>
                  {d} minutes
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1.5">
              Escalation Phone Number
            </label>
            <input
              type="tel"
              value={form.escalation_phone}
              onChange={(e) => setForm({ ...form, escalation_phone: e.target.value })}
              placeholder="+15125551234"
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent placeholder:text-gray-300"
            />
            <p className="text-[11px] text-gray-400 mt-1">
              E.164 format (e.g. +15125551234). This number is called when Maya transfers to a
              human.
            </p>
          </div>
        </div>
      </div>

      {/* 5. Languages */}
      <div className="bg-white rounded-xl border border-gray-100 p-6">
        <h2 className="text-sm font-semibold text-gray-900 mb-1">Languages</h2>
        <p className="text-xs text-gray-400 mb-4">
          Maya will respond in whichever language the caller speaks, if it&apos;s in this list
        </p>

        <div className="space-y-2">
          {LANGUAGES.map((lang) => (
            <label
              key={lang.code}
              className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-gray-50 cursor-pointer"
            >
              <input
                type="checkbox"
                checked={form.preferred_languages.includes(lang.code)}
                onChange={() => toggleLanguage(lang.code)}
                className="rounded text-teal-600 focus:ring-teal-500"
              />
              <span className="text-sm text-gray-900">{lang.label}</span>
            </label>
          ))}
        </div>
        <p className="text-[11px] text-gray-400 mt-2">At least one language must be selected</p>
      </div>

      {/* 6. Phone Number (read-only) */}
      <div className="bg-white rounded-xl border border-gray-100 p-6">
        <h2 className="text-sm font-semibold text-gray-900 mb-1">Phone Number</h2>
        <p className="text-xs text-gray-400 mb-4">This is the number callers dial to reach Maya</p>
        <p className="text-lg font-semibold text-gray-900">{formatPhone(settings.telnyx_number)}</p>
      </div>

      {/* 7. Save button */}
      <div className="flex items-center gap-3">
        <button
          onClick={saveSettings}
          disabled={saving || !hasChanges}
          className="px-4 py-2 bg-teal-600 text-white text-sm font-medium rounded-lg hover:bg-teal-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {saving ? 'Saving\u2026' : 'Save Settings'}
        </button>
        {hasChanges && <p className="text-xs text-gray-400">You have unsaved changes</p>}
      </div>
    </div>
  )
}
