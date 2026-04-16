'use client'

import { useState, useEffect, useCallback } from 'react'
import { useSession } from 'next-auth/react'

interface AvailableService {
  id: string
  name: string
  durationMinutes?: number
}

interface BookingSettings {
  enabled: boolean
  slug: string
  serviceIds: string[]
  bufferMinutes: number
  advanceDays: number
  confirmationMessage: string
  googleReviewUrl: string
  accentColor: string
  availableServices: AvailableService[]
}

const DEFAULT_SETTINGS: BookingSettings = {
  enabled: false,
  slug: '',
  serviceIds: [],
  bufferMinutes: 15,
  advanceDays: 30,
  confirmationMessage: '',
  googleReviewUrl: '',
  accentColor: '#2563eb',
  availableServices: [],
}

const SLUG_RE = /^[a-z0-9-]{3,50}$/

function isValidHex(val: string) {
  return /^#[0-9a-fA-F]{6}$/.test(val)
}

export default function BookingSettingsPage() {
  const { data: session } = useSession()
  const [settings, setSettings] = useState<BookingSettings>(DEFAULT_SETTINGS)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState<{ type: 'success' | 'error'; msg: string } | null>(null)
  const [slugError, setSlugError] = useState<string | null>(null)

  const token = (session as unknown as Record<string, unknown>)?.accessToken ?? ''

  const authHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token as string}` } : {}),
  }

  useEffect(() => {
    fetch('/api/settings/booking', { headers: authHeaders })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: BookingSettings | null) => {
        if (data) setSettings({ ...DEFAULT_SETTINGS, ...data })
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const validateSlug = useCallback((val: string) => {
    if (!val) return 'Slug is required'
    if (!SLUG_RE.test(val))
      return 'Use lowercase letters, numbers, and hyphens only (3–50 characters)'
    return null
  }, [])

  function handleSlugChange(val: string) {
    setSettings((s) => ({ ...s, slug: val }))
    setSlugError(validateSlug(val))
  }

  function toggleService(id: string) {
    setSettings((s) => ({
      ...s,
      serviceIds: s.serviceIds.includes(id)
        ? s.serviceIds.filter((sid) => sid !== id)
        : [...s.serviceIds, id],
    }))
  }

  async function save() {
    const slugErr = validateSlug(settings.slug)
    if (slugErr) {
      setSlugError(slugErr)
      return
    }
    if (!isValidHex(settings.accentColor)) {
      setToast({ type: 'error', msg: 'Accent color must be a valid hex code (e.g. #2563eb)' })
      return
    }

    setSaving(true)
    setToast(null)

    const { availableServices: _unused, ...payload } = settings
    void _unused

    try {
      const res = await fetch('/api/settings/booking', {
        method: 'PUT',
        headers: authHeaders,
        body: JSON.stringify(payload),
      })

      if (res.ok) {
        const data = await res.json()
        setSettings((s) => ({ ...s, ...data }))
        setToast({ type: 'success', msg: 'Settings saved' })
      } else if (res.status === 409) {
        setSlugError('This URL slug is already taken')
        setToast({ type: 'error', msg: 'That slug is already in use — please choose another.' })
      } else {
        const d = await res.json().catch(() => ({}))
        setToast({ type: 'error', msg: (d as { error?: string }).error || 'Failed to save' })
      }
    } catch {
      setToast({ type: 'error', msg: 'Failed to save settings' })
    } finally {
      setSaving(false)
      setTimeout(() => setToast(null), 4000)
    }
  }

  if (loading) {
    return (
      <div className="px-8 py-8 max-w-2xl">
        <p className="text-sm text-gray-400">Loading settings...</p>
      </div>
    )
  }

  const bookingUrl = `${typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000'}/book/${settings.slug}`

  const inputCls =
    'w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent'

  const narrowInputCls =
    'w-32 px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent'

  return (
    <div className="px-8 py-8 max-w-2xl space-y-6">
      <div>
        <h1 className="text-xl font-bold text-gray-900 mb-1">Online Booking</h1>
        <p className="text-sm text-gray-500">
          Configure your public booking page so clients can schedule appointments directly.
        </p>
      </div>

      {/* Enable Toggle */}
      <div className="bg-white rounded-xl border border-gray-100 p-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-gray-900">Enable Online Booking</p>
            <p className="text-xs text-gray-400 mt-0.5">
              Make your booking page publicly accessible
            </p>
          </div>
          <button
            role="switch"
            aria-checked={settings.enabled}
            onClick={() => setSettings((s) => ({ ...s, enabled: !s.enabled }))}
            className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:ring-offset-2 ${
              settings.enabled ? 'bg-teal-600' : 'bg-gray-200'
            }`}
          >
            <span
              className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                settings.enabled ? 'translate-x-5' : 'translate-x-0'
              }`}
            />
          </button>
        </div>
      </div>

      {/* Slug + URL Preview */}
      <div className="bg-white rounded-xl border border-gray-100 p-6 space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-900 mb-1">
            Booking Page URL Slug
          </label>
          <p className="text-xs text-gray-400 mb-2">
            Lowercase letters, numbers, and hyphens. Between 3 and 50 characters.
          </p>
          <input
            type="text"
            value={settings.slug}
            onChange={(e) => handleSlugChange(e.target.value)}
            placeholder="bright-smile-dental"
            className={`${inputCls} ${slugError ? 'border-red-300 focus:ring-red-500' : ''}`}
          />
          {slugError && <p className="text-xs text-red-600 mt-1">{slugError}</p>}
          {settings.slug && !slugError && (
            <p className="text-xs text-gray-400 mt-1.5 break-all">
              Preview: <span className="text-teal-600 font-mono">{bookingUrl}</span>
            </p>
          )}
        </div>
      </div>

      {/* Service Picker */}
      {settings.availableServices.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-100 p-6">
          <p className="text-sm font-medium text-gray-900 mb-1">Available Services</p>
          <p className="text-xs text-gray-400 mb-4">
            Choose which services clients can book online.
          </p>
          <div className="space-y-2">
            {settings.availableServices.map((svc) => (
              <label key={svc.id} className="flex items-center gap-3 cursor-pointer group">
                <input
                  type="checkbox"
                  checked={settings.serviceIds.includes(svc.id)}
                  onChange={() => toggleService(svc.id)}
                  className="h-4 w-4 rounded border-gray-300 text-teal-600 focus:ring-teal-500"
                />
                <span className="text-sm text-gray-700 group-hover:text-gray-900">
                  {svc.name}
                  {svc.durationMinutes != null && (
                    <span className="ml-1.5 text-xs text-gray-400">
                      ({svc.durationMinutes} min)
                    </span>
                  )}
                </span>
              </label>
            ))}
          </div>
        </div>
      )}

      {/* Scheduling Rules */}
      <div className="bg-white rounded-xl border border-gray-100 p-6 space-y-5">
        <p className="text-sm font-semibold text-gray-900">Scheduling Rules</p>

        <div>
          <label className="block text-sm font-medium text-gray-900 mb-1">
            Buffer Between Appointments (minutes)
          </label>
          <p className="text-xs text-gray-400 mb-2">Between 5 and 60 minutes.</p>
          <input
            type="number"
            value={settings.bufferMinutes}
            onChange={(e) =>
              setSettings((s) => ({
                ...s,
                bufferMinutes: Math.min(60, Math.max(5, parseInt(e.target.value) || 5)),
              }))
            }
            className={narrowInputCls}
            min="5"
            max="60"
            step="5"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-900 mb-1">
            Advance Booking Window (days)
          </label>
          <p className="text-xs text-gray-400 mb-2">
            How many days ahead clients can schedule. Between 1 and 90.
          </p>
          <input
            type="number"
            value={settings.advanceDays}
            onChange={(e) =>
              setSettings((s) => ({
                ...s,
                advanceDays: Math.min(90, Math.max(1, parseInt(e.target.value) || 1)),
              }))
            }
            className={narrowInputCls}
            min="1"
            max="90"
            step="1"
          />
        </div>
      </div>

      {/* Confirmation Message */}
      <div className="bg-white rounded-xl border border-gray-100 p-6">
        <label className="block text-sm font-medium text-gray-900 mb-1">Confirmation Message</label>
        <p className="text-xs text-gray-400 mb-2">
          Shown to the client after they complete a booking.
        </p>
        <textarea
          value={settings.confirmationMessage}
          onChange={(e) => setSettings((s) => ({ ...s, confirmationMessage: e.target.value }))}
          rows={3}
          placeholder="Thanks for booking! We'll send a reminder 24 hours before your appointment."
          className={inputCls}
        />
      </div>

      {/* Google Review URL */}
      <div className="bg-white rounded-xl border border-gray-100 p-6">
        <label className="block text-sm font-medium text-gray-900 mb-1">Google Review URL</label>
        <p className="text-xs text-gray-400 mb-2">
          Optionally shown on the booking confirmation page to encourage reviews.
        </p>
        <input
          type="url"
          value={settings.googleReviewUrl}
          onChange={(e) => setSettings((s) => ({ ...s, googleReviewUrl: e.target.value }))}
          placeholder="https://g.page/your-business/review"
          className={inputCls}
        />
      </div>

      {/* Accent Color */}
      <div className="bg-white rounded-xl border border-gray-100 p-6">
        <label className="block text-sm font-medium text-gray-900 mb-1">Accent Color</label>
        <p className="text-xs text-gray-400 mb-2">Hex code used on your public booking page.</p>
        <div className="flex items-center gap-3">
          <input
            type="text"
            value={settings.accentColor}
            onChange={(e) => setSettings((s) => ({ ...s, accentColor: e.target.value }))}
            placeholder="#2563eb"
            className={`w-36 px-3 py-2 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent font-mono ${
              settings.accentColor && !isValidHex(settings.accentColor)
                ? 'border-red-300 focus:ring-red-500'
                : 'border-gray-200'
            }`}
          />
          {isValidHex(settings.accentColor) && (
            <span
              className="inline-block h-8 w-8 rounded-md border border-gray-200 shadow-sm"
              style={{ backgroundColor: settings.accentColor }}
              title={settings.accentColor}
            />
          )}
        </div>
        {settings.accentColor && !isValidHex(settings.accentColor) && (
          <p className="text-xs text-red-600 mt-1">Enter a valid 6-digit hex code (e.g. #2563eb)</p>
        )}
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
          disabled={saving || !!slugError}
          className="px-4 py-2 bg-teal-600 text-white text-sm font-medium rounded-lg hover:bg-teal-700 disabled:opacity-50 transition-colors"
        >
          {saving ? 'Saving...' : 'Save Settings'}
        </button>

        {settings.slug && !slugError && (
          <button
            type="button"
            onClick={() => window.open(`/book/${settings.slug}`, '_blank')}
            className="px-4 py-2 bg-white text-teal-600 text-sm font-medium rounded-lg border border-teal-200 hover:bg-teal-50 transition-colors"
          >
            Preview Page
          </button>
        )}
      </div>
    </div>
  )
}
