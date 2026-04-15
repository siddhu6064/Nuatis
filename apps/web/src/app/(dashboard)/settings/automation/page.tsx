'use client'

import { useState, useEffect } from 'react'
import { useSession } from 'next-auth/react'

// ─── Types ────────────────────────────────────────────────────────────────────

interface ReviewAutomationSettings {
  enabled: boolean
  delayMinutes: number
  messageTemplate: string
  googleReviewUrl: string
}

interface ReviewAutomationStats {
  sent: number
  clicked: number
  clickRate: number
}

// ─── Constants ────────────────────────────────────────────────────────────────

const DELAY_OPTIONS = [
  { label: '30 minutes', value: 30 },
  { label: '1 hour', value: 60 },
  { label: '2 hours', value: 120 },
  { label: '4 hours', value: 240 },
  { label: 'Next day', value: 1440 },
]

const DEFAULT_TEMPLATE =
  "Hi {{first_name}}, thank you for choosing {{business_name}}! We'd love to hear about your experience. Could you take a moment to leave us a review? {{review_url}}"

const MERGE_TAGS = ['{{first_name}}', '{{last_name}}', '{{business_name}}', '{{review_url}}']

const SAMPLE_DATA: Record<string, string> = {
  '{{first_name}}': 'Jane',
  '{{last_name}}': 'Smith',
  '{{business_name}}': 'Your Business',
  '{{review_url}}': 'https://g.page/...',
}

// ─── Toggle ───────────────────────────────────────────────────────────────────

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

export default function ReviewAutomationPage() {
  const { data: session } = useSession()
  const token = (session as Record<string, unknown>)?.accessToken ?? ''
  const authHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token as string}` } : {}),
  }

  const [settings, setSettings] = useState<ReviewAutomationSettings>({
    enabled: false,
    delayMinutes: 120,
    messageTemplate: DEFAULT_TEMPLATE,
    googleReviewUrl: '',
  })
  const [stats, setStats] = useState<ReviewAutomationStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState<{ type: 'success' | 'error'; msg: string } | null>(null)

  useEffect(() => {
    const apiUrl = process.env['NEXT_PUBLIC_API_URL'] || 'http://localhost:3001'

    Promise.all([
      fetch(`${apiUrl}/api/settings/review-automation`, { headers: authHeaders }).then((r) =>
        r.ok ? r.json() : null
      ),
      fetch(`${apiUrl}/api/settings/review-automation/stats`, { headers: authHeaders }).then((r) =>
        r.ok ? r.json() : null
      ),
    ])
      .then(
        ([settingsData, statsData]: [
          ReviewAutomationSettings | null,
          ReviewAutomationStats | null,
        ]) => {
          if (settingsData) setSettings(settingsData)
          if (statsData) setStats(statsData)
        }
      )
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  function insertMergeTag(tag: string) {
    setSettings((prev) => ({ ...prev, messageTemplate: prev.messageTemplate + tag }))
  }

  function renderPreview(template: string): string {
    return MERGE_TAGS.reduce((text, tag) => text.replaceAll(tag, SAMPLE_DATA[tag] ?? tag), template)
  }

  const missingReviewUrl = !settings.messageTemplate.includes('{{review_url}}')

  async function save() {
    setSaving(true)
    setToast(null)
    const apiUrl = process.env['NEXT_PUBLIC_API_URL'] || 'http://localhost:3001'
    try {
      const res = await fetch(`${apiUrl}/api/settings/review-automation`, {
        method: 'PUT',
        headers: authHeaders,
        body: JSON.stringify({
          enabled: settings.enabled,
          delayMinutes: settings.delayMinutes,
          messageTemplate: settings.messageTemplate,
          googleReviewUrl: settings.googleReviewUrl,
        }),
      })
      if (res.ok) {
        const data = (await res.json()) as ReviewAutomationSettings
        setSettings(data)
        setToast({ type: 'success', msg: 'Settings saved' })
      } else {
        const d = (await res.json().catch(() => ({}))) as { error?: string }
        setToast({ type: 'error', msg: d.error ?? 'Failed to save' })
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

  return (
    <div className="px-8 py-8 max-w-2xl space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-gray-900 mb-1">Google Review Automation</h1>
        <p className="text-sm text-gray-500">
          Automatically send review request messages to customers after a job is completed.
        </p>
      </div>

      {/* Enable / Disable */}
      <div className="rounded-xl border border-gray-100 bg-white p-5">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-gray-900">Enable Google Review Automation</p>
            <p className="text-xs text-gray-400 mt-0.5">
              Automatically send review requests when a job is marked complete.
            </p>
          </div>
          <Toggle
            checked={settings.enabled}
            onChange={(val) => setSettings((prev) => ({ ...prev, enabled: val }))}
          />
        </div>
      </div>

      {/* Delay */}
      <div className="rounded-xl border border-gray-100 bg-white p-5 space-y-3">
        <p className="text-sm font-semibold text-gray-900">Send review request after</p>
        <select
          value={settings.delayMinutes}
          onChange={(e) =>
            setSettings((prev) => ({ ...prev, delayMinutes: parseInt(e.target.value) }))
          }
          className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500"
        >
          {DELAY_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      {/* Google Review URL */}
      <div className="rounded-xl border border-gray-100 bg-white p-5 space-y-3">
        <p className="text-sm font-semibold text-gray-900">Google Review URL</p>
        <input
          type="url"
          value={settings.googleReviewUrl}
          onChange={(e) => setSettings((prev) => ({ ...prev, googleReviewUrl: e.target.value }))}
          placeholder="https://g.page/your-business/review"
          className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500"
        />
        <p className="text-xs text-gray-400">
          Find your Google review link in Google Business Profile → Share → Copy link
        </p>
      </div>

      {/* Message Template */}
      <div className="rounded-xl border border-gray-100 bg-white p-5 space-y-3">
        <p className="text-sm font-semibold text-gray-900">Message Template</p>

        {/* Merge tag buttons */}
        <div className="flex flex-wrap gap-2">
          {MERGE_TAGS.map((tag) => (
            <button
              key={tag}
              type="button"
              onClick={() => insertMergeTag(tag)}
              className="px-2.5 py-1 text-xs font-mono bg-gray-100 text-gray-600 rounded-md hover:bg-gray-200 transition-colors"
            >
              {tag}
            </button>
          ))}
        </div>

        {/* Warning if {{review_url}} missing */}
        {missingReviewUrl && (
          <div className="flex items-start gap-2 px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg">
            <span className="text-sm">⚠️</span>
            <p className="text-xs text-amber-700">
              Your template doesn't include <span className="font-mono">{'{{review_url}}'}</span>.
              Without it, customers won't have a link to leave a review.
            </p>
          </div>
        )}

        <textarea
          value={settings.messageTemplate}
          onChange={(e) => setSettings((prev) => ({ ...prev, messageTemplate: e.target.value }))}
          rows={5}
          className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500 resize-y font-normal"
          placeholder="Enter your review request message…"
        />
      </div>

      {/* Preview */}
      <div className="rounded-xl border border-gray-100 bg-white p-5 space-y-3">
        <p className="text-sm font-semibold text-gray-900">Preview</p>
        <div className="px-4 py-3 bg-gray-50 rounded-lg">
          <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">
            {renderPreview(settings.messageTemplate) || (
              <span className="text-gray-400 italic">No template entered yet.</span>
            )}
          </p>
        </div>
        <p className="text-xs text-gray-400">
          Showing sample data: Jane Smith, Your Business, https://g.page/...
        </p>
      </div>

      {/* Stats */}
      <div className="rounded-xl border border-gray-100 bg-white p-5">
        {stats ? (
          <p className="text-sm text-gray-600">
            <span className="font-medium text-gray-900">{stats.sent.toLocaleString()}</span> review
            requests sent ·{' '}
            <span className="font-medium text-gray-900">{stats.clicked.toLocaleString()}</span>{' '}
            clicked{' '}
            <span className="text-gray-400">({stats.clickRate.toFixed(1)}% click rate)</span> — last
            30 days
          </p>
        ) : (
          <p className="text-sm text-gray-400">No stats available yet.</p>
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

      {/* Save */}
      <div className="pb-8">
        <button
          onClick={() => void save()}
          disabled={saving}
          className="px-4 py-2 bg-teal-600 text-white text-sm font-medium rounded-lg hover:bg-teal-700 disabled:opacity-50 transition-colors"
        >
          {saving ? 'Saving...' : 'Save Settings'}
        </button>
      </div>
    </div>
  )
}
