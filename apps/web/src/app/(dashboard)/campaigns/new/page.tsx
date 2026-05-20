'use client'

import { useState, useEffect, useCallback } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'

// ── Types ──────────────────────────────────────────────────────────────────────

interface SmartList {
  id: string
  name: string
  filters: Record<string, unknown> | null
  created_at: string
}

interface Campaign {
  id: string
  name: string
  type: string
  status: string
  subject: string | null
  body_html: string | null
  body_text: string | null
  smart_list_id: string | null
  scheduled_at: string | null
  sent_at: string | null
  recipient_count: number
  sent_count: number
}

// ── Step indicator ─────────────────────────────────────────────────────────────

const STEPS = [
  { num: 1, label: 'Setup' },
  { num: 2, label: 'Content' },
  { num: 3, label: 'Schedule' },
  { num: 4, label: 'Send' },
]

function StepIndicator({ current }: { current: number }) {
  return (
    <div className="flex items-center gap-0 mb-8">
      {STEPS.map((s, i) => (
        <div key={s.num} className="flex items-center">
          {/* Circle */}
          <div className="flex flex-col items-center">
            <div
              className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold transition-colors ${
                s.num < current
                  ? 'bg-green-500 text-white'
                  : s.num === current
                    ? 'bg-teal-600 text-white'
                    : 'bg-gray-100 text-gray-400'
              }`}
            >
              {s.num < current ? (
                <svg
                  className="w-4 h-4"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2.5}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              ) : (
                s.num
              )}
            </div>
            <span
              className={`text-xs mt-1 font-medium whitespace-nowrap ${
                s.num === current
                  ? 'text-teal-700'
                  : s.num < current
                    ? 'text-green-600'
                    : 'text-ink3'
              }`}
            >
              {s.label}
            </span>
          </div>
          {/* Connector line */}
          {i < STEPS.length - 1 && (
            <div
              className={`h-px w-16 mx-2 mb-5 ${s.num < current ? 'bg-green-400' : 'bg-gray-200'}`}
            />
          )}
        </div>
      ))}
    </div>
  )
}

// ── Shared CSS ─────────────────────────────────────────────────────────────────

const inputCls =
  'w-full px-3 py-2 text-sm text-ink border border-border-brand rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent'
const primaryBtnCls =
  'px-4 py-2 bg-teal-600 text-white text-sm font-medium rounded-lg hover:bg-teal-700 disabled:opacity-50 transition-colors'
const backBtnCls =
  'px-4 py-2 text-sm text-ink2 border border-border-brand rounded-lg hover:bg-bg transition-colors'

// ── Main wizard component ──────────────────────────────────────────────────────

export default function NewCampaignPage() {
  const searchParams = useSearchParams()
  const editId = searchParams.get('id')

  const [step, setStep] = useState(1)
  const [campaignId, setCampaignId] = useState<string | null>(editId)
  const [form, setForm] = useState({
    name: '',
    smart_list_id: '',
    subject: '',
    body_html: '',
    body_text: '',
    schedule_type: 'send_now' as 'send_now' | 'schedule',
    scheduled_at: '',
  })
  const [smartLists, setSmartLists] = useState<SmartList[]>([])
  const [generating, setGenerating] = useState(false)
  const [aiPrompt, setAiPrompt] = useState('')
  const [showAiPrompt, setShowAiPrompt] = useState(false)
  const [saving, setSaving] = useState(false)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [bodyTab, setBodyTab] = useState<'edit' | 'preview'>('edit')
  const [done, setDone] = useState(false)
  const [sentCampaignId, setSentCampaignId] = useState<string | null>(null)

  // Load smart lists
  useEffect(() => {
    fetch('/api/smart-lists')
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { lists?: SmartList[] } | null) => {
        if (d?.lists) setSmartLists(d.lists)
      })
      .catch(() => {})
  }, [])

  // Load existing campaign if ?id= param present
  const loadCampaign = useCallback((id: string) => {
    fetch(`/api/campaigns/${id}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data: Campaign | null) => {
        if (!data) return
        setForm({
          name: data.name ?? '',
          smart_list_id: data.smart_list_id ?? '',
          subject: data.subject ?? '',
          body_html: data.body_html ?? '',
          body_text: data.body_text ?? '',
          schedule_type: data.scheduled_at ? 'schedule' : 'send_now',
          scheduled_at: data.scheduled_at
            ? new Date(data.scheduled_at).toISOString().slice(0, 16)
            : '',
        })
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (editId) {
      loadCampaign(editId)
    }
  }, [editId, loadCampaign])

  // ── Autosave helper ──────────────────────────────────────────────────────────
  async function autosave(fields: Partial<typeof form>) {
    if (!campaignId) return
    await fetch(`/api/campaigns/${campaignId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(fields),
    }).catch(() => {})
  }

  // ── Step 1: Setup ─────────────────────────────────────────────────────────────
  async function handleStep1Next() {
    setError(null)
    if (!form.name.trim()) {
      setError('Campaign name is required.')
      return
    }
    setSaving(true)
    try {
      if (campaignId) {
        // Update existing draft
        await autosave({ name: form.name, smart_list_id: form.smart_list_id || undefined })
        setStep(2)
      } else {
        // Create new campaign
        const res = await fetch('/api/campaigns', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: form.name.trim(),
            type: 'email',
            smart_list_id: form.smart_list_id || undefined,
          }),
        })
        const data = await res.json()
        if (!res.ok) {
          setError((data as { error?: string }).error ?? 'Failed to create campaign')
          return
        }
        const created = (data as { campaign: Campaign }).campaign
        setCampaignId(created.id)
        setStep(2)
      }
    } catch {
      setError('Failed to save campaign')
    } finally {
      setSaving(false)
    }
  }

  // ── Step 2: Content ───────────────────────────────────────────────────────────
  async function handleGenerate() {
    if (!campaignId) return
    setGenerating(true)
    setError(null)
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: aiPrompt }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError((data as { error?: string }).error ?? 'AI generation failed')
        return
      }
      const gen = data as { subject: string; body_html: string; body_text: string }
      setForm((prev) => ({
        ...prev,
        subject: gen.subject,
        body_html: gen.body_html,
        body_text: gen.body_text,
      }))
      setShowAiPrompt(false)
    } catch {
      setError('AI generation failed')
    } finally {
      setGenerating(false)
    }
  }

  // ── Step 3: Schedule ──────────────────────────────────────────────────────────
  function minScheduledAt() {
    const d = new Date(Date.now() + 5 * 60 * 1000)
    return d.toISOString().slice(0, 16)
  }

  // ── Step 4: Send ──────────────────────────────────────────────────────────────
  async function handleSend() {
    if (!campaignId) return
    setSending(true)
    setError(null)
    try {
      let res: Response
      if (form.schedule_type === 'schedule') {
        if (!form.scheduled_at) {
          setError('Please select a date and time to schedule.')
          setSending(false)
          return
        }
        res = await fetch(`/api/campaigns/${campaignId}/schedule`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ scheduled_at: new Date(form.scheduled_at).toISOString() }),
        })
      } else {
        res = await fetch(`/api/campaigns/${campaignId}/send-now`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        })
      }
      const data = await res.json()
      if (!res.ok) {
        setError((data as { error?: string }).error ?? 'Failed to send campaign')
        return
      }
      setSentCampaignId(campaignId)
      setDone(true)
    } catch {
      setError('Failed to send campaign')
    } finally {
      setSending(false)
    }
  }

  const selectedList = smartLists.find((l) => l.id === form.smart_list_id)

  // ── Done state ────────────────────────────────────────────────────────────────
  if (done && sentCampaignId) {
    return (
      <div className="px-8 py-8 max-w-2xl">
        <div className="bg-white rounded-xl border border-border-brand px-8 py-16 text-center">
          <div className="text-4xl mb-4">🎉</div>
          <h2 className="text-xl font-bold text-ink mb-2">Campaign sent!</h2>
          <p className="text-sm text-ink3 mb-6">
            Your campaign is{' '}
            {form.schedule_type === 'schedule' ? 'scheduled and will send soon' : 'being sent now'}.
          </p>
          <div className="flex items-center justify-center gap-3">
            <Link
              href={`/campaigns/${sentCampaignId}`}
              className="px-4 py-2 bg-teal-600 text-white text-sm font-medium rounded-lg hover:bg-teal-700 transition-colors"
            >
              View Stats →
            </Link>
            <Link
              href="/campaigns"
              className="px-4 py-2 text-sm text-ink2 border border-border-brand rounded-lg hover:bg-bg transition-colors"
            >
              Back to Campaigns
            </Link>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="px-8 py-8 max-w-2xl">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-xl font-bold text-ink">{editId ? 'Edit Campaign' : 'New Campaign'}</h1>
        <p className="text-sm text-ink3 mt-0.5">
          {editId ? 'Continue editing your draft campaign' : 'Create and send an email campaign'}
        </p>
      </div>

      {/* Step indicator */}
      <StepIndicator current={step} />

      {/* Error */}
      {error && (
        <div className="mb-4 px-4 py-3 bg-red-50 text-red-600 text-sm rounded-lg border border-red-100">
          {error}
        </div>
      )}

      {/* ── Step 1: Setup ── */}
      {step === 1 && (
        <div className="bg-white rounded-xl border border-border-brand p-6 space-y-5">
          <h2 className="text-sm font-semibold text-ink">Campaign Setup</h2>

          {/* Campaign name */}
          <div>
            <label className="block text-xs font-medium text-ink2 mb-1.5">
              Campaign Name <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={form.name}
              onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
              placeholder="e.g. Summer Re-engagement"
              className={inputCls}
            />
          </div>

          {/* Type (disabled) */}
          <div>
            <label className="block text-xs font-medium text-ink2 mb-1.5">Type</label>
            <select disabled className={`${inputCls} bg-gray-50 cursor-not-allowed`}>
              <option>Email</option>
            </select>
            <p className="text-xs text-ink3 mt-1">SMS coming soon</p>
          </div>

          {/* Target segment */}
          <div>
            <label className="block text-xs font-medium text-ink2 mb-1.5">Target Segment</label>
            <select
              value={form.smart_list_id}
              onChange={(e) => setForm((p) => ({ ...p, smart_list_id: e.target.value }))}
              className={inputCls}
            >
              <option value="">All contacts (no filter)</option>
              {smartLists.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </div>

          {/* Next button */}
          <div className="pt-2 flex justify-end">
            <button
              type="button"
              onClick={handleStep1Next}
              disabled={saving}
              className={primaryBtnCls}
            >
              {saving ? 'Saving...' : 'Next →'}
            </button>
          </div>
        </div>
      )}

      {/* ── Step 2: Content ── */}
      {step === 2 && (
        <div className="bg-white rounded-xl border border-border-brand p-6 space-y-5">
          <h2 className="text-sm font-semibold text-ink">Email Content</h2>

          {/* Subject */}
          <div>
            <label className="block text-xs font-medium text-ink2 mb-1.5">Subject Line</label>
            <input
              type="text"
              value={form.subject}
              onChange={(e) => setForm((p) => ({ ...p, subject: e.target.value }))}
              onBlur={() => autosave({ subject: form.subject })}
              placeholder="Your email subject..."
              className={inputCls}
            />
          </div>

          {/* AI generate */}
          <div>
            <button
              type="button"
              onClick={() => setShowAiPrompt((v) => !v)}
              className="text-xs font-medium text-teal-700 hover:text-teal-800 flex items-center gap-1"
            >
              <span>✨</span>
              {showAiPrompt ? 'Hide AI generator' : 'Generate with AI'}
            </button>

            {showAiPrompt && (
              <div className="mt-3 p-4 bg-teal-50 rounded-lg border border-teal-100 space-y-3">
                <label className="block text-xs font-medium text-teal-800">
                  Optional prompt (describe your campaign goal)
                </label>
                <textarea
                  value={aiPrompt}
                  onChange={(e) => setAiPrompt(e.target.value)}
                  placeholder="e.g. Offer 20% discount to customers who haven't booked in 60 days"
                  rows={3}
                  className="w-full px-3 py-2 text-sm text-ink border border-teal-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500 bg-white"
                />
                <button
                  type="button"
                  onClick={handleGenerate}
                  disabled={generating}
                  className={`${primaryBtnCls} flex items-center gap-2`}
                >
                  {generating && (
                    <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle
                        className="opacity-25"
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        strokeWidth="4"
                      />
                      <path
                        className="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                      />
                    </svg>
                  )}
                  {generating ? 'Generating...' : 'Generate'}
                </button>
              </div>
            )}
          </div>

          {/* Body editor */}
          <div>
            <div className="flex items-center gap-1 mb-2 border-b border-border-brand">
              <button
                type="button"
                onClick={() => setBodyTab('edit')}
                className={`px-4 py-2 text-xs font-medium border-b-2 -mb-px transition-colors ${
                  bodyTab === 'edit'
                    ? 'border-teal-600 text-teal-700'
                    : 'border-transparent text-ink3 hover:text-ink2'
                }`}
              >
                Edit HTML
              </button>
              <button
                type="button"
                onClick={() => setBodyTab('preview')}
                className={`px-4 py-2 text-xs font-medium border-b-2 -mb-px transition-colors ${
                  bodyTab === 'preview'
                    ? 'border-teal-600 text-teal-700'
                    : 'border-transparent text-ink3 hover:text-ink2'
                }`}
              >
                Preview
              </button>
            </div>

            {bodyTab === 'edit' ? (
              <textarea
                value={form.body_html}
                onChange={(e) => setForm((p) => ({ ...p, body_html: e.target.value }))}
                onBlur={() => autosave({ body_html: form.body_html })}
                placeholder="<p>Hello {{first_name}},</p>"
                rows={12}
                className="w-full px-3 py-2 text-sm text-ink border border-border-brand rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500 font-mono"
              />
            ) : (
              <iframe
                srcDoc={
                  form.body_html ||
                  '<p style="color:#999;font-family:sans-serif;padding:16px">No content yet</p>'
                }
                sandbox="allow-same-origin"
                className="w-full h-64 border border-border-brand rounded-lg"
                title="Email preview"
              />
            )}
          </div>

          {/* Nav */}
          <div className="pt-2 flex items-center justify-between">
            <button type="button" onClick={() => setStep(1)} className={backBtnCls}>
              ← Back
            </button>
            <button
              type="button"
              onClick={async () => {
                await autosave({
                  subject: form.subject,
                  body_html: form.body_html,
                  body_text: form.body_text,
                })
                setStep(3)
              }}
              className={primaryBtnCls}
            >
              Next →
            </button>
          </div>
        </div>
      )}

      {/* ── Step 3: Schedule ── */}
      {step === 3 && (
        <div className="bg-white rounded-xl border border-border-brand p-6 space-y-5">
          <h2 className="text-sm font-semibold text-ink">Schedule</h2>

          {/* Radio group */}
          <div className="space-y-3">
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="radio"
                name="schedule_type"
                value="send_now"
                checked={form.schedule_type === 'send_now'}
                onChange={() => setForm((p) => ({ ...p, schedule_type: 'send_now' }))}
                className="w-4 h-4 text-teal-600 border-gray-300 focus:ring-teal-500"
              />
              <div>
                <p className="text-sm font-medium text-ink">Send now</p>
                <p className="text-xs text-ink3">Campaign will begin sending immediately</p>
              </div>
            </label>

            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="radio"
                name="schedule_type"
                value="schedule"
                checked={form.schedule_type === 'schedule'}
                onChange={() => setForm((p) => ({ ...p, schedule_type: 'schedule' }))}
                className="w-4 h-4 text-teal-600 border-gray-300 focus:ring-teal-500"
              />
              <div>
                <p className="text-sm font-medium text-ink">Schedule for later</p>
                <p className="text-xs text-ink3">Pick a date and time at least 5 minutes out</p>
              </div>
            </label>
          </div>

          {form.schedule_type === 'schedule' && (
            <div>
              <label className="block text-xs font-medium text-ink2 mb-1.5">Send At</label>
              <input
                type="datetime-local"
                value={form.scheduled_at}
                min={minScheduledAt()}
                onChange={(e) => setForm((p) => ({ ...p, scheduled_at: e.target.value }))}
                className={inputCls}
              />
            </div>
          )}

          {/* Summary card */}
          <div className="bg-bg rounded-lg border border-border-brand p-4 space-y-2">
            <h3 className="text-xs font-semibold text-ink3 uppercase tracking-wide">Summary</h3>
            <div className="space-y-1">
              <p className="text-sm text-ink">
                <span className="text-ink3">Campaign:</span> {form.name || '—'}
              </p>
              <p className="text-sm text-ink">
                <span className="text-ink3">Segment:</span>{' '}
                {selectedList ? selectedList.name : 'All contacts'}
              </p>
              <p className="text-sm text-ink truncate">
                <span className="text-ink3">Subject:</span> {form.subject || '—'}
              </p>
            </div>
          </div>

          {/* Nav */}
          <div className="pt-2 flex items-center justify-between">
            <button type="button" onClick={() => setStep(2)} className={backBtnCls}>
              ← Back
            </button>
            <button type="button" onClick={() => setStep(4)} className={primaryBtnCls}>
              Review →
            </button>
          </div>
        </div>
      )}

      {/* ── Step 4: Confirm & Send ── */}
      {step === 4 && (
        <div className="bg-white rounded-xl border border-border-brand p-6 space-y-5">
          <h2 className="text-sm font-semibold text-ink">Confirm &amp; Send</h2>

          {/* Final summary */}
          <div className="bg-bg rounded-lg border border-border-brand divide-y divide-gray-100">
            <div className="px-4 py-3 flex items-start justify-between gap-4">
              <span className="text-xs font-medium text-ink3 uppercase tracking-wide w-24 shrink-0">
                Campaign
              </span>
              <span className="text-sm text-ink text-right">{form.name}</span>
            </div>
            <div className="px-4 py-3 flex items-start justify-between gap-4">
              <span className="text-xs font-medium text-ink3 uppercase tracking-wide w-24 shrink-0">
                Type
              </span>
              <span className="text-sm text-ink text-right">Email</span>
            </div>
            <div className="px-4 py-3 flex items-start justify-between gap-4">
              <span className="text-xs font-medium text-ink3 uppercase tracking-wide w-24 shrink-0">
                Segment
              </span>
              <span className="text-sm text-ink text-right">
                {selectedList ? selectedList.name : 'All contacts'}
              </span>
            </div>
            <div className="px-4 py-3 flex items-start justify-between gap-4">
              <span className="text-xs font-medium text-ink3 uppercase tracking-wide w-24 shrink-0">
                Subject
              </span>
              <span className="text-sm text-ink text-right">{form.subject || '—'}</span>
            </div>
            <div className="px-4 py-3 flex items-start justify-between gap-4">
              <span className="text-xs font-medium text-ink3 uppercase tracking-wide w-24 shrink-0">
                Schedule
              </span>
              <span className="text-sm text-ink text-right">
                {form.schedule_type === 'send_now'
                  ? 'Send immediately'
                  : form.scheduled_at
                    ? new Date(form.scheduled_at).toLocaleString()
                    : '—'}
              </span>
            </div>
          </div>

          {/* Suppression note */}
          <div className="flex items-start gap-2 text-xs text-ink3 bg-amber-50 border border-amber-100 rounded-lg px-4 py-3">
            <span className="text-amber-500 shrink-0">ℹ</span>
            <p>Note: Suppressed contacts (bounced/complained) will be automatically skipped.</p>
          </div>

          {/* Nav */}
          <div className="pt-2 flex items-center justify-between">
            <button type="button" onClick={() => setStep(3)} className={backBtnCls}>
              ← Back
            </button>
            <button
              type="button"
              onClick={handleSend}
              disabled={sending}
              className="px-6 py-2.5 bg-red-600 text-white text-sm font-bold rounded-lg hover:bg-red-700 disabled:opacity-50 transition-colors flex items-center gap-2"
            >
              {sending && (
                <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                  />
                </svg>
              )}
              {sending
                ? 'Sending...'
                : form.schedule_type === 'schedule'
                  ? 'Schedule Campaign'
                  : 'Send Campaign'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
