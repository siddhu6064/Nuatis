'use client'

import { useState, useEffect } from 'react'
import { useSession } from 'next-auth/react'

interface WebchatConfig {
  webchat_enabled: boolean
  webchat_greeting: string
  webchat_color: string
  webchat_position: 'bottom-right' | 'bottom-left'
}

const COLOR_PRESETS = [
  { value: '#0d9488', label: 'Teal' },
  { value: '#2563eb', label: 'Blue' },
  { value: '#7c3aed', label: 'Purple' },
  { value: '#dc2626', label: 'Red' },
  { value: '#ea580c', label: 'Orange' },
  { value: '#16a34a', label: 'Green' },
]

export default function WebchatSettingsPage() {
  const { data: session } = useSession()
  const tenantId = session?.user?.tenantId ?? ''
  const [config, setConfig] = useState<WebchatConfig>({
    webchat_enabled: false,
    webchat_greeting: 'Hi! How can we help you today?',
    webchat_color: '#0d9488',
    webchat_position: 'bottom-right',
  })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    fetch('/api/settings/webchat')
      .then((r) => r.json())
      .then((d: WebchatConfig) => {
        setConfig(d)
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [])

  async function handleSave() {
    setSaving(true)
    setError(null)
    const r = await fetch('/api/settings/webchat', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config),
    })
    if (r.ok) {
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    } else {
      const d = (await r.json().catch(() => ({}))) as { error?: string }
      setError(d.error ?? 'Failed to save')
    }
    setSaving(false)
  }

  // The embed snippet they copy-paste onto their website
  const embedSnippet = `<script
  src="https://api.nuatis.com/webchat-widget.js"
  data-tenant-id="${tenantId || 'YOUR_TENANT_ID'}"
  data-color="${config.webchat_color}"
  data-greeting="${config.webchat_greeting}"
  data-position="${config.webchat_position}"
></script>`

  async function handleCopy() {
    await navigator.clipboard.writeText(embedSnippet)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  if (loading) {
    return (
      <div className="px-8 py-8">
        <div className="h-6 bg-gray-200 rounded w-48 animate-pulse mb-8" />
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-20 bg-gray-100 rounded-xl animate-pulse" />
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="px-8 py-8 max-w-2xl">
      <div className="mb-8">
        <h1 className="text-xl font-bold text-ink">Webchat Widget</h1>
        <p className="text-sm text-ink3 mt-1">Add an AI-powered chat widget to your website.</p>
      </div>

      {error && (
        <div className="mb-4 px-4 py-3 bg-red-50 text-red-600 text-sm rounded-lg">{error}</div>
      )}

      {/* Enable/disable */}
      <div className="bg-white rounded-xl border border-border-brand px-6 py-5 mb-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-ink">Enable Webchat</h2>
            <p className="text-xs text-ink4 mt-0.5">Show the chat widget on your website</p>
          </div>
          <button
            type="button"
            onClick={() => setConfig((c) => ({ ...c, webchat_enabled: !c.webchat_enabled }))}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
              config.webchat_enabled ? 'bg-teal-600' : 'bg-gray-200'
            }`}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                config.webchat_enabled ? 'translate-x-6' : 'translate-x-1'
              }`}
            />
          </button>
        </div>
      </div>

      {/* Greeting */}
      <div className="bg-white rounded-xl border border-border-brand px-6 py-5 mb-4">
        <h2 className="text-sm font-semibold text-ink mb-3">Greeting Message</h2>
        <input
          type="text"
          value={config.webchat_greeting}
          onChange={(e) => setConfig((c) => ({ ...c, webchat_greeting: e.target.value }))}
          maxLength={200}
          className="w-full px-3 py-2 text-sm text-ink border border-border-brand rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500"
          placeholder="Hi! How can we help you today?"
        />
        <p className="text-xs text-ink4 mt-1">{config.webchat_greeting.length}/200</p>
      </div>

      {/* Color */}
      <div className="bg-white rounded-xl border border-border-brand px-6 py-5 mb-4">
        <h2 className="text-sm font-semibold text-ink mb-3">Widget Color</h2>
        <div className="flex items-center gap-2 flex-wrap">
          {COLOR_PRESETS.map((preset) => (
            <button
              key={preset.value}
              type="button"
              onClick={() => setConfig((c) => ({ ...c, webchat_color: preset.value }))}
              title={preset.label}
              className={`w-8 h-8 rounded-full transition-transform ${
                config.webchat_color === preset.value
                  ? 'scale-125 ring-2 ring-offset-2 ring-teal-600'
                  : ''
              }`}
              style={{ backgroundColor: preset.value }}
            />
          ))}
          <input
            type="color"
            value={config.webchat_color}
            onChange={(e) => setConfig((c) => ({ ...c, webchat_color: e.target.value }))}
            className="w-8 h-8 rounded cursor-pointer border border-border-brand"
            title="Custom color"
          />
        </div>
      </div>

      {/* Position */}
      <div className="bg-white rounded-xl border border-border-brand px-6 py-5 mb-4">
        <h2 className="text-sm font-semibold text-ink mb-3">Widget Position</h2>
        <div className="flex gap-2">
          {(['bottom-right', 'bottom-left'] as const).map((pos) => (
            <button
              key={pos}
              type="button"
              onClick={() => setConfig((c) => ({ ...c, webchat_position: pos }))}
              className={`flex-1 py-2 text-sm font-medium rounded-lg border transition-colors ${
                config.webchat_position === pos
                  ? 'bg-teal-600 text-white border-teal-600'
                  : 'bg-white text-ink3 border-border-brand hover:text-ink'
              }`}
            >
              {pos === 'bottom-right' ? '↘ Bottom Right' : '↙ Bottom Left'}
            </button>
          ))}
        </div>
      </div>

      {/* Save button */}
      <div className="flex items-center gap-3 mb-8">
        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={saving}
          className="px-4 py-2 bg-teal-600 text-white text-sm font-medium rounded-lg hover:bg-teal-700 disabled:opacity-50 transition-colors"
        >
          {saving ? 'Saving…' : saved ? 'Saved ✓' : 'Save Changes'}
        </button>
      </div>

      {/* Embed snippet */}
      <div className="bg-white rounded-xl border border-border-brand px-6 py-5">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h2 className="text-sm font-semibold text-ink">Embed Code</h2>
            <p className="text-xs text-ink4 mt-0.5">
              Paste this before the closing &lt;/body&gt; tag on your website
            </p>
          </div>
          <button
            type="button"
            onClick={() => void handleCopy()}
            className="px-3 py-1.5 text-xs font-medium text-teal-700 bg-teal-50 hover:bg-teal-100 rounded-lg transition-colors"
          >
            {copied ? 'Copied!' : 'Copy'}
          </button>
        </div>
        <pre className="text-xs bg-gray-50 rounded-lg p-4 overflow-x-auto text-ink3 font-mono border border-border-brand">
          {embedSnippet}
        </pre>
      </div>
    </div>
  )
}
