'use client'

import { useState, useEffect } from 'react'
import { useSession } from 'next-auth/react'

const apiUrl = process.env['NEXT_PUBLIC_API_URL'] || 'http://localhost:3001'
const webUrl = process.env['NEXT_PUBLIC_WEB_URL'] || 'http://localhost:3000'

interface ChatWidgetSettings {
  enabled: boolean
  color: string
  greeting: string
  position: 'bottom-right' | 'bottom-left'
}

const DEFAULT_SETTINGS: ChatWidgetSettings = {
  enabled: false,
  color: '#0d9488',
  greeting: 'Hi there! How can we help you today?',
  position: 'bottom-right',
}

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
      className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-40 ${
        checked ? 'bg-teal-600' : 'bg-gray-200'
      }`}
    >
      <span
        className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
          checked ? 'translate-x-5' : 'translate-x-0'
        }`}
      />
    </button>
  )
}

export default function ChatWidgetSettingsPage() {
  const { data: session } = useSession()
  const [form, setForm] = useState<ChatWidgetSettings>(DEFAULT_SETTINGS)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [copied, setCopied] = useState(false)
  const [toast, setToast] = useState<{ type: 'success' | 'error'; msg: string } | null>(null)

  const token = (session as unknown as Record<string, unknown>)?.accessToken ?? ''
  const tenantId =
    ((session as unknown as Record<string, unknown>)?.user as Record<string, unknown> | undefined)
      ?.tenantId ?? ''

  const authHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token as string}` } : {}),
  }

  function showToast(type: 'success' | 'error', msg: string) {
    setToast({ type, msg })
    setTimeout(() => setToast(null), 4000)
  }

  useEffect(() => {
    if (!token) return
    fetch(`${apiUrl}/api/settings/chat-widget`, { headers: authHeaders })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: ChatWidgetSettings | null) => {
        if (data) setForm(data)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [token])

  async function save() {
    setSaving(true)
    try {
      const res = await fetch(`${apiUrl}/api/settings/chat-widget`, {
        method: 'PUT',
        headers: authHeaders,
        body: JSON.stringify(form),
      })
      if (res.ok) {
        showToast('success', 'Chat widget settings saved')
      } else {
        const d = await res.json().catch(() => ({}))
        showToast('error', (d as { error?: string }).error || 'Failed to save')
      }
    } catch {
      showToast('error', 'Failed to save settings')
    } finally {
      setSaving(false)
    }
  }

  const embedCode = `<script src="${webUrl}/widget/chat.js" data-tenant-id="${tenantId || 'YOUR_TENANT_ID'}" data-api-url="${apiUrl}"></script>`

  async function copyEmbed() {
    try {
      await navigator.clipboard.writeText(embedCode)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      showToast('error', 'Could not copy to clipboard')
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
        <h1 className="text-xl font-bold text-gray-900 mb-1">Chat Widget</h1>
        <p className="text-sm text-gray-500">
          Embed a live chat widget on your website to capture leads and answer questions.
        </p>
      </div>

      {/* Enable / Disable */}
      <div className="bg-white rounded-xl border border-gray-100 p-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-gray-900">
              Widget {form.enabled ? 'Enabled' : 'Disabled'}
            </h2>
            <p className="text-xs text-gray-400 mt-0.5">
              {form.enabled
                ? 'The chat widget is visible on your website'
                : 'The chat widget is hidden from visitors'}
            </p>
          </div>
          <Toggle checked={form.enabled} onChange={(val) => setForm({ ...form, enabled: val })} />
        </div>
      </div>

      {/* Appearance */}
      <div className="bg-white rounded-xl border border-gray-100 p-6 space-y-5">
        <div>
          <h2 className="text-sm font-semibold text-gray-900 mb-0.5">Appearance</h2>
          <p className="text-xs text-gray-400">Customize the look of the chat button</p>
        </div>

        {/* Color */}
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1.5">Widget Color</label>
          <div className="flex items-center gap-3">
            <div
              className="w-9 h-9 rounded-lg border border-gray-200 shrink-0 cursor-pointer overflow-hidden"
              style={{ backgroundColor: form.color }}
            >
              <input
                type="color"
                value={form.color}
                onChange={(e) => setForm({ ...form, color: e.target.value })}
                className="opacity-0 w-full h-full cursor-pointer"
                title="Pick a color"
              />
            </div>
            <input
              type="text"
              value={form.color}
              onChange={(e) => setForm({ ...form, color: e.target.value })}
              placeholder="#0d9488"
              maxLength={7}
              className="w-32 px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent font-mono"
            />
            <span className="text-xs text-gray-400">Hex color value</span>
          </div>
        </div>

        {/* Greeting */}
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1.5">Greeting Message</label>
          <textarea
            value={form.greeting}
            onChange={(e) => setForm({ ...form, greeting: e.target.value })}
            rows={3}
            placeholder="Hi there! How can we help you today?"
            className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent placeholder:text-gray-300 resize-none"
          />
          <p className="text-[11px] text-gray-400 mt-1">
            This message appears when a visitor first opens the chat widget.
          </p>
        </div>

        {/* Position */}
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-2">Widget Position</label>
          <div className="flex gap-3">
            {(
              [
                { value: 'bottom-right', label: 'Bottom Right' },
                { value: 'bottom-left', label: 'Bottom Left' },
              ] as const
            ).map((opt) => (
              <label
                key={opt.value}
                className={`flex items-center gap-2.5 px-4 py-2.5 rounded-lg border cursor-pointer transition-colors text-sm ${
                  form.position === opt.value
                    ? 'border-teal-500 bg-teal-50 text-teal-800 font-medium'
                    : 'border-gray-200 hover:bg-gray-50 text-gray-700'
                }`}
              >
                <input
                  type="radio"
                  name="position"
                  value={opt.value}
                  checked={form.position === opt.value}
                  onChange={() => setForm({ ...form, position: opt.value })}
                  className="text-teal-600 focus:ring-teal-500"
                />
                {opt.label}
              </label>
            ))}
          </div>
        </div>
      </div>

      {/* Embed Code */}
      <div className="bg-white rounded-xl border border-gray-100 p-6 space-y-3">
        <div>
          <h2 className="text-sm font-semibold text-gray-900 mb-0.5">Embed Code</h2>
          <p className="text-xs text-gray-400">
            Paste this snippet before the closing{' '}
            <code className="font-mono text-gray-600">&lt;/body&gt;</code> tag of your website.
          </p>
        </div>

        <div className="flex items-start gap-3">
          <code className="flex-1 min-w-0 px-4 py-3 bg-gray-50 border border-gray-200 rounded-lg text-xs font-mono text-gray-800 break-all leading-relaxed">
            {embedCode}
          </code>
          <button
            onClick={copyEmbed}
            className="shrink-0 px-3 py-2.5 rounded-lg border border-gray-200 bg-white text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
          >
            {copied ? 'Copied!' : 'Copy'}
          </button>
        </div>

        {!tenantId && (
          <p className="text-[11px] text-amber-600 bg-amber-50 px-3 py-2 rounded-lg">
            Your tenant ID will be filled in automatically once your session loads.
          </p>
        )}
      </div>

      {/* Save */}
      <div className="flex items-center gap-3 pb-4">
        <button
          onClick={save}
          disabled={saving}
          className="px-4 py-2 bg-teal-600 text-white text-sm font-medium rounded-lg hover:bg-teal-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {saving ? 'Saving...' : 'Save Settings'}
        </button>
      </div>

      {/* Toast */}
      {toast && (
        <div
          className={`fixed bottom-6 right-6 z-50 px-4 py-3 rounded-xl shadow-lg text-sm font-medium transition-all ${
            toast.type === 'success'
              ? 'bg-teal-600 text-white'
              : 'bg-red-50 text-red-700 border border-red-200'
          }`}
        >
          {toast.msg}
        </div>
      )}
    </div>
  )
}
