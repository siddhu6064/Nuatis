'use client'

import { useState, useEffect } from 'react'
import TextField from '@mui/material/TextField'
import Button from '@mui/material/Button'
import Switch from '@mui/material/Switch'

interface NpsSurveySettings {
  enabled: boolean
  delayMinutes: number
}

export default function NpsSurveySettingsPage() {
  const [settings, setSettings] = useState<NpsSurveySettings | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState<{ type: 'success' | 'error'; msg: string } | null>(null)

  useEffect(() => {
    fetch('/api/settings/nps-surveys')
      .then((r) => (r.ok ? r.json() : null))
      .then((data: NpsSurveySettings | null) => {
        if (data) setSettings(data)
      })
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    if (!toast) return undefined
    const t = setTimeout(() => setToast(null), 3000)
    return () => clearTimeout(t)
  }, [toast])

  async function handleSave(next: NpsSurveySettings) {
    setSaving(true)
    try {
      const res = await fetch('/api/settings/nps-surveys', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: next.enabled, delayMinutes: next.delayMinutes }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        throw new Error((d as { error?: string }).error ?? 'Failed to save')
      }
      const data = (await res.json()) as NpsSurveySettings
      setSettings(data)
      setToast({ type: 'success', msg: 'Saved' })
    } catch (err) {
      setToast({ type: 'error', msg: err instanceof Error ? err.message : 'Failed to save' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="px-8 py-8 max-w-2xl">
      <h1 className="text-xl font-bold text-ink mb-1">Customer NPS Surveys</h1>
      <p className="text-sm text-ink4 mb-6">
        Automatically text customers a "how likely are you to recommend us" survey after a completed
        appointment.
      </p>

      <div className="bg-white rounded-xl border border-border-brand mb-8">
        <div className="px-5 py-4 border-b border-border-brand flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-ink">Automation</h2>
            <p className="text-xs text-ink4 mt-0.5">
              Send a survey text after every completed appointment.
            </p>
          </div>
          {loading ? null : (
            <Switch
              checked={settings?.enabled ?? false}
              onChange={(e) =>
                void handleSave({
                  enabled: e.target.checked,
                  delayMinutes: settings?.delayMinutes ?? 120,
                })
              }
              disabled={saving}
              slotProps={{ input: { 'aria-label': 'Toggle NPS survey automation' } }}
            />
          )}
        </div>
        <div className="px-5 py-4">
          {loading ? (
            <p className="text-sm text-ink4">Loading…</p>
          ) : (
            <>
              <p className="text-sm text-ink3 mb-3">
                How long to wait after the appointment completes before texting the survey.
              </p>
              <div className="flex items-center gap-2">
                <TextField
                  size="small"
                  type="number"
                  value={settings?.delayMinutes ?? 120}
                  onChange={(e) =>
                    setSettings({
                      enabled: settings?.enabled ?? false,
                      delayMinutes: Number(e.target.value),
                    })
                  }
                  slotProps={{ htmlInput: { min: 15, max: 1440, step: 15 } }}
                  sx={{ maxWidth: 160 }}
                />
                <span className="text-sm text-ink4">minutes</span>
                <Button
                  variant="outlined"
                  size="small"
                  disabled={saving}
                  onClick={() =>
                    void handleSave({
                      enabled: settings?.enabled ?? false,
                      delayMinutes: settings?.delayMinutes ?? 120,
                    })
                  }
                >
                  Save
                </Button>
              </div>
            </>
          )}
        </div>
      </div>

      {toast && (
        <div
          className={`fixed top-4 right-4 z-[60] px-4 py-2 text-sm rounded-lg shadow-lg ${
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
