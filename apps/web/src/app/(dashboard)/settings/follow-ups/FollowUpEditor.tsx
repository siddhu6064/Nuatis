'use client'

import { useEffect, useState } from 'react'

interface MergedStep {
  step_index: number
  days_after: number
  channel: 'sms' | 'email'
  body: string
  subject?: string
  is_enabled: boolean
  is_customized: boolean
}

interface EditableStep extends MergedStep {
  _body: string
  _subject: string
  _is_enabled: boolean
  _dirty: boolean
}

interface Props {
  verticalLabel: string
  businessName: string
  telnyxNumber: string
}

const VARIABLES = [
  { key: 'name', label: '{name}', desc: 'Contact name' },
  { key: 'business', label: '{business}', desc: 'Business name' },
  { key: 'phone', label: '{phone}', desc: 'Business phone' },
]

function interpolate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, key) => vars[key] ?? `{${key}}`)
}

export default function FollowUpEditor({ verticalLabel, businessName, telnyxNumber }: Props) {
  const [steps, setSteps] = useState<EditableStep[]>([])
  const [selectedStep, setSelectedStep] = useState(0)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saveSuccess, setSaveSuccess] = useState(false)

  const sampleVars: Record<string, string> = {
    name: 'John Smith',
    business: businessName,
    phone: telnyxNumber,
  }

  async function fetchSteps() {
    setLoading(true)
    try {
      const res = await fetch('/api/follow-up-templates')
      if (!res.ok) throw new Error('Failed to load templates')
      const data = (await res.json()) as { steps: MergedStep[] }
      setSteps(
        data.steps.map((s) => ({
          ...s,
          _body: s.body,
          _subject: s.subject ?? '',
          _is_enabled: s.is_enabled,
          _dirty: false,
        }))
      )
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void fetchSteps()
  }, [])

  function updateStep(
    index: number,
    patch: Partial<Pick<EditableStep, '_body' | '_subject' | '_is_enabled'>>
  ) {
    setSteps((prev) => prev.map((s, i) => (i === index ? { ...s, ...patch, _dirty: true } : s)))
    setSaveSuccess(false)
    setSaveError(null)
  }

  async function resetStep(index: number) {
    const step = steps[index]
    if (!step) return
    // PUT with is_customized cleared by re-saving all steps with this step's body reset to default
    // We fetch fresh to get default, then save only this step's override removed via re-fetch
    // Simplest: delete the override by saving the default body back — backend upserts, no delete endpoint needed
    // Actually just re-fetch after reverting locally so server sees the change on next PUT
    setSteps((prev) =>
      prev.map((s, i) =>
        i === index ? { ...s, _body: s.body, _subject: s.subject ?? '', _dirty: true } : s
      )
    )
  }

  async function handleSave() {
    setSaving(true)
    setSaveError(null)
    setSaveSuccess(false)
    try {
      const payload = {
        steps: steps.map((s) => ({
          step_index: s.step_index,
          channel: s.channel,
          body: s._body,
          subject: s.channel === 'email' ? s._subject : undefined,
          is_enabled: s._is_enabled,
        })),
      }
      const res = await fetch('/api/follow-up-templates', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const err = (await res.json()) as { error?: string }
        throw new Error(err.error ?? 'Save failed')
      }
      const data = (await res.json()) as { steps: MergedStep[] }
      setSteps(
        data.steps.map((s) => ({
          ...s,
          _body: s.body,
          _subject: s.subject ?? '',
          _is_enabled: s.is_enabled,
          _dirty: false,
        }))
      )
      setSaveSuccess(true)
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  const current = steps[selectedStep]
  const anyDirty = steps.some((s) => s._dirty)

  if (loading) {
    return <div className="text-sm text-gray-400 py-8 text-center">Loading templates…</div>
  }

  return (
    <div className="max-w-2xl space-y-6">
      {/* Variables reference */}
      <div className="bg-white rounded-xl border border-gray-100 p-4">
        <p className="text-xs font-medium text-gray-500 mb-2">Available variables</p>
        <div className="flex flex-wrap gap-2">
          {VARIABLES.map((v) => (
            <span
              key={v.key}
              className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-mono bg-teal-50 text-teal-700 border border-teal-100"
              title={v.desc}
            >
              {v.label}
            </span>
          ))}
        </div>
      </div>

      {/* Cadence timeline */}
      <div className="bg-white rounded-xl border border-gray-100 p-6">
        <h2 className="text-sm font-semibold text-gray-900 mb-4">
          Follow-up Cadence &mdash; {verticalLabel}
        </h2>

        {steps.length === 0 ? (
          <p className="text-sm text-gray-400">
            No follow-up cadence configured for this vertical.
          </p>
        ) : (
          <div className="space-y-0">
            {steps.map((step, i) => (
              <button key={i} onClick={() => setSelectedStep(i)} className="w-full text-left">
                <div className="flex items-start gap-3 relative">
                  {i < steps.length - 1 && (
                    <div className="absolute left-[7px] top-4 w-px h-full bg-gray-100" />
                  )}
                  <div
                    className={`w-[15px] h-[15px] rounded-full border-2 shrink-0 mt-0.5 relative z-10 ${
                      selectedStep === i ? 'border-teal-500 bg-teal-50' : 'border-gray-300 bg-white'
                    }`}
                  />
                  <div
                    className={`flex-1 pb-5 px-3 py-2 rounded-lg transition-colors ${
                      selectedStep === i ? 'bg-gray-50' : 'hover:bg-gray-50/50'
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <p className="text-sm font-medium text-gray-900">Day {step.days_after}</p>
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium ${
                          step.channel === 'sms'
                            ? 'bg-blue-50 text-blue-700'
                            : 'bg-teal-50 text-teal-700'
                        }`}
                      >
                        {step.channel.toUpperCase()}
                      </span>
                      {step.is_customized && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium bg-violet-50 text-violet-700">
                          Customized
                        </span>
                      )}
                      {!step._is_enabled && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium bg-gray-100 text-gray-500">
                          Disabled
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-gray-500 line-clamp-2">{step._body}</p>
                    {step.channel === 'sms' && step._body.length > 160 && (
                      <p className="text-[10px] text-amber-600 mt-1">
                        {step._body.length}/160 chars (may split into multiple SMS)
                      </p>
                    )}
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Selected step editor */}
      {current && (
        <div className="bg-white rounded-xl border border-gray-100 p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold text-gray-900">Step {selectedStep + 1} Edit</h2>
              <span
                className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium ${
                  current.channel === 'sms'
                    ? 'bg-blue-50 text-blue-700'
                    : 'bg-teal-50 text-teal-700'
                }`}
              >
                {current.channel.toUpperCase()}
              </span>
              {current.is_customized && (
                <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium bg-violet-50 text-violet-700">
                  Customized
                </span>
              )}
            </div>
            <div className="flex items-center gap-3">
              {/* Enabled toggle */}
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={current._is_enabled}
                  onChange={(e) => updateStep(selectedStep, { _is_enabled: e.target.checked })}
                  className="rounded border-gray-300 text-teal-600 focus:ring-teal-500"
                />
                <span className="text-xs text-gray-600">Enabled</span>
              </label>
              {current.is_customized && (
                <button
                  onClick={() => void resetStep(selectedStep)}
                  className="text-xs text-gray-500 hover:text-red-600 underline underline-offset-2 transition-colors"
                >
                  Reset to default
                </button>
              )}
            </div>
          </div>

          {/* Subject (email only) */}
          {current.channel === 'email' && (
            <div className="mb-3">
              <label className="block text-xs font-medium text-gray-500 mb-1">Subject</label>
              <input
                type="text"
                value={current._subject}
                onChange={(e) => updateStep(selectedStep, { _subject: e.target.value })}
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500"
              />
            </div>
          )}

          {/* Body textarea */}
          <div className="mb-4">
            <label className="block text-xs font-medium text-gray-500 mb-1">Body</label>
            <textarea
              rows={5}
              value={current._body}
              onChange={(e) => updateStep(selectedStep, { _body: e.target.value })}
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500 resize-none"
            />
            {current.channel === 'sms' && (
              <p className="text-[10px] text-gray-400 mt-1">{current._body.length} characters</p>
            )}
            {current.channel === 'sms' && !current._body.toUpperCase().includes('STOP') && (
              <p className="text-[10px] text-red-500 mt-1">
                SMS must include STOP opt-out language (e.g. &ldquo;Reply STOP to opt out.&rdquo;)
              </p>
            )}
          </div>

          {/* Preview */}
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">
              Preview (with sample data)
            </label>
            <div
              className={`px-4 py-3 rounded-lg text-sm ${
                current.channel === 'sms'
                  ? 'bg-blue-50 text-blue-900 border border-blue-100'
                  : 'bg-teal-50 text-teal-900 border border-teal-100'
              }`}
            >
              {current.channel === 'email' && current._subject && (
                <p className="font-medium mb-1">{interpolate(current._subject, sampleVars)}</p>
              )}
              <p>{interpolate(current._body, sampleVars)}</p>
            </div>
          </div>
        </div>
      )}

      {/* Save */}
      <div className="flex items-center justify-between">
        <div>
          {saveError && <p className="text-sm text-red-600">{saveError}</p>}
          {saveSuccess && <p className="text-sm text-teal-600">Changes saved.</p>}
        </div>
        <button
          onClick={() => void handleSave()}
          disabled={saving || !anyDirty}
          className="px-5 py-2 bg-teal-600 text-white text-sm font-semibold rounded-lg hover:bg-teal-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {saving ? 'Saving…' : 'Save changes'}
        </button>
      </div>
    </div>
  )
}
