'use client'

import { useState, useEffect } from 'react'
import Switch from '@mui/material/Switch'
import Button from '@mui/material/Button'
import TextField from '@mui/material/TextField'
import MenuItem from '@mui/material/MenuItem'

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

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ReviewAutomationPage() {
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
    Promise.all([
      fetch(`/api/settings/review-automation`, { credentials: 'include' }).then((r) =>
        r.ok ? r.json() : null
      ),
      fetch(`/api/settings/review-automation/stats`, { credentials: 'include' }).then((r) =>
        r.ok ? r.json() : null
      ),
    ])
      .then(
        ([settingsData, statsData]: [
          ReviewAutomationSettings | null,
          ReviewAutomationStats | null,
        ]) => {
          if (settingsData)
            setSettings({
              ...settingsData,
              googleReviewUrl: settingsData.googleReviewUrl ?? '',
              messageTemplate: settingsData.messageTemplate ?? DEFAULT_TEMPLATE,
            })
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
    try {
      const res = await fetch(`/api/settings/review-automation`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          enabled: settings.enabled,
          delayMinutes: settings.delayMinutes,
          messageTemplate: settings.messageTemplate,
          googleReviewUrl: settings.googleReviewUrl,
        }),
      })
      if (res.ok) {
        const data = (await res.json()) as ReviewAutomationSettings
        setSettings({
          ...data,
          googleReviewUrl: data.googleReviewUrl ?? '',
          messageTemplate: data.messageTemplate ?? DEFAULT_TEMPLATE,
        })
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
        <p className="text-sm text-ink4">Loading settings...</p>
      </div>
    )
  }

  return (
    <div className="px-8 py-8 max-w-2xl space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-ink mb-1">Google Review Automation</h1>
        <p className="text-sm text-ink3">
          Automatically send review request messages to customers after a job is completed.
        </p>
      </div>

      {/* Enable / Disable */}
      <div className="rounded-xl border border-border-brand bg-white p-5">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-ink">Enable Google Review Automation</p>
            <p className="text-xs text-ink4 mt-0.5">
              Automatically send review requests when a job is marked complete.
            </p>
          </div>
          <Switch
            checked={settings.enabled}
            onChange={(e) => setSettings((prev) => ({ ...prev, enabled: e.target.checked }))}
            slotProps={{ input: { 'aria-label': 'Enable Google Review Automation' } }}
          />
        </div>
      </div>

      {/* Delay */}
      <div className="rounded-xl border border-border-brand bg-white p-5 space-y-3">
        <p className="text-sm font-semibold text-ink">Send review request after</p>
        <TextField
          select
          value={settings.delayMinutes}
          onChange={(e) =>
            setSettings((prev) => ({ ...prev, delayMinutes: parseInt(e.target.value) }))
          }
          fullWidth
          size="small"
        >
          {DELAY_OPTIONS.map((opt) => (
            <MenuItem key={opt.value} value={opt.value}>
              {opt.label}
            </MenuItem>
          ))}
        </TextField>
      </div>

      {/* Google Review URL */}
      <div className="rounded-xl border border-border-brand bg-white p-5 space-y-3">
        <p className="text-sm font-semibold text-ink">Google Review URL</p>
        <TextField
          type="url"
          value={settings.googleReviewUrl ?? ''}
          onChange={(e) => setSettings((prev) => ({ ...prev, googleReviewUrl: e.target.value }))}
          placeholder="https://g.page/your-business/review"
          fullWidth
          size="small"
        />
        <p className="text-xs text-ink4">
          Find your Google review link in Google Business Profile → Share → Copy link
        </p>
      </div>

      {/* Message Template */}
      <div className="rounded-xl border border-border-brand bg-white p-5 space-y-3">
        <p className="text-sm font-semibold text-ink">Message Template</p>

        {/* Merge tag buttons */}
        <div className="flex flex-wrap gap-2">
          {MERGE_TAGS.map((tag) => (
            <Button
              key={tag}
              onClick={() => insertMergeTag(tag)}
              size="small"
              color="inherit"
              sx={{ fontFamily: 'monospace', fontSize: 12 }}
            >
              {tag}
            </Button>
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

        <TextField
          multiline
          rows={5}
          value={settings.messageTemplate ?? ''}
          onChange={(e) => setSettings((prev) => ({ ...prev, messageTemplate: e.target.value }))}
          placeholder="Enter your review request message…"
          fullWidth
          size="small"
        />
      </div>

      {/* Preview */}
      <div className="rounded-xl border border-border-brand bg-white p-5 space-y-3">
        <p className="text-sm font-semibold text-ink">Preview</p>
        <div className="px-4 py-3 bg-bg rounded-lg">
          <p className="text-sm text-ink2 whitespace-pre-wrap leading-relaxed">
            {renderPreview(settings.messageTemplate) || (
              <span className="text-ink4 italic">No template entered yet.</span>
            )}
          </p>
        </div>
        <p className="text-xs text-ink4">
          Showing sample data: Jane Smith, Your Business, https://g.page/...
        </p>
      </div>

      {/* Stats */}
      <div className="rounded-xl border border-border-brand bg-white p-5">
        {stats ? (
          <p className="text-sm text-ink3">
            <span className="font-medium text-ink">{(stats.sent ?? 0).toLocaleString()}</span>{' '}
            review requests sent ·{' '}
            <span className="font-medium text-ink">{(stats.clicked ?? 0).toLocaleString()}</span>{' '}
            clicked{' '}
            <span className="text-ink4">({(stats.clickRate ?? 0).toFixed(1)}% click rate)</span> —
            last 30 days
          </p>
        ) : (
          <p className="text-sm text-ink4">No stats available yet.</p>
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
        <Button onClick={() => void save()} disabled={saving} variant="contained">
          {saving ? 'Saving...' : 'Save Settings'}
        </Button>
      </div>
    </div>
  )
}
