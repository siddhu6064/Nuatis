'use client'
import { useState, useEffect } from 'react'

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? ''

const LABS_FEATURES = [
  { key: 'ai_automation_builder', label: 'AI Automation Builder', description: 'Natural language → automation config. Powers custom automations.', available: true },
  { key: 'webchat_widget', label: 'Webchat AI Widget', description: 'Embeddable chat widget for your website.', available: true },
  { key: 'outbound_calling', label: 'Outbound AI Calling', description: 'Maya proactively calls leads.', available: true },
  { key: 'video_testimonials', label: 'Video Testimonials', description: 'Collect short video reviews from clients.', available: true },
  { key: 'client_portal', label: 'Client Portal', description: 'White-labeled self-service portal for your clients.', available: true },
  { key: 'ai_campaigns', label: 'AI Campaigns', description: 'AI-generated email campaigns sent to contact segments.', available: false },
]

export default function LabsClient() {
  const [config, setConfig] = useState<Record<string, boolean>>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState<string | null>(null)

  useEffect(() => {
    fetch(`${API_URL}/api/settings/labs`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) setConfig(d.labs_config ?? {}) })
      .finally(() => setLoading(false))
  }, [])

  async function toggle(key: string, enabled: boolean) {
    if (saving) return
    setSaving(key)
    const res = await fetch(`${API_URL}/api/settings/labs`, {
      method: 'PUT',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, enabled }),
    })
    if (res.ok) setConfig(prev => ({ ...prev, [key]: enabled }))
    setSaving(null)
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-ink">Labs</h1>
        <p className="text-sm text-ink3 mt-1">Early access features — may change or be removed.</p>
      </div>
      {/* Warning banner */}
      <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 mb-6 text-sm text-amber-800">
        ⚠️ These features are experimental. Use at your own risk.
      </div>
      {loading ? (
        <p className="text-sm text-ink3">Loading…</p>
      ) : (
        <div className="bg-white border border-border-brand rounded-xl divide-y divide-border-brand">
          {LABS_FEATURES.map(f => {
            const enabled = config[f.key] ?? false
            const isSaving = saving === f.key
            return (
              <div key={f.key} className="flex items-center justify-between px-5 py-4">
                <div className="flex-1 min-w-0 pr-4">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-ink">{f.label}</span>
                    {f.available ? (
                      <span className="text-[10px] bg-teal-50 text-teal-700 px-1.5 py-0.5 rounded font-medium">Available</span>
                    ) : (
                      <span className="text-[10px] bg-gray-100 text-ink4 px-1.5 py-0.5 rounded font-medium">Coming Soon</span>
                    )}
                  </div>
                  <p className="text-xs text-ink3 mt-0.5">{f.description}</p>
                </div>
                {/* Toggle switch */}
                <button
                  type="button"
                  role="switch"
                  aria-checked={enabled}
                  disabled={!f.available || isSaving}
                  onClick={() => toggle(f.key, !enabled)}
                  className={`relative flex-shrink-0 w-10 h-6 rounded-full transition-colors ${
                    !f.available ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'
                  } ${enabled ? 'bg-teal-600' : 'bg-gray-200'}`}
                >
                  <span
                    className={`absolute top-1 left-1 w-4 h-4 rounded-full bg-white shadow transition-transform ${
                      enabled ? 'translate-x-4' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
