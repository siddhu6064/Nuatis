'use client'

import { useState, useEffect, Suspense } from 'react'
import { useRouter } from 'next/navigation'

// ── Types ──────────────────────────────────────────────────────────────────────

interface SmartList {
  id: string
  name: string
  filters: Record<string, unknown> | null
  created_at: string
}

type Objective = 'reactivate_lapsed' | 'announce_promo' | 'request_review' | 'seasonal' | 'custom'
type Channel = 'sms' | 'email' | 'social'

// ── Step indicator ─────────────────────────────────────────────────────────────

const STEPS = [
  { num: 1, label: 'Objective' },
  { num: 2, label: 'Audience' },
  { num: 3, label: 'Channels' },
]

function StepIndicator({ current }: { current: number }) {
  return (
    <div className="flex items-center gap-0 mb-8">
      {STEPS.map((s, i) => (
        <div key={s.num} className="flex items-center">
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

// ── Objective option data ──────────────────────────────────────────────────────

const OBJECTIVES: {
  value: Objective
  icon: string
  label: string
  description: string
}[] = [
  {
    value: 'reactivate_lapsed',
    icon: '🔄',
    label: 'Reactivate lapsed clients',
    description: "Re-engage clients you haven't heard from in a while",
  },
  {
    value: 'announce_promo',
    icon: '📢',
    label: 'Announce a promotion',
    description: 'Share a special offer, discount, or event',
  },
  {
    value: 'request_review',
    icon: '⭐',
    label: 'Request reviews',
    description: 'Ask satisfied clients to leave a Google or Yelp review',
  },
  {
    value: 'seasonal',
    icon: '🗓',
    label: 'Seasonal campaign',
    description: 'Holiday greetings, seasonal offers, or time-sensitive messages',
  },
  {
    value: 'custom',
    icon: '✏️',
    label: 'Custom',
    description: 'Write your own objective',
  },
]

// ── Channel option data ────────────────────────────────────────────────────────

const CHANNELS: {
  value: Channel
  icon: string
  label: string
  description: string
  disabled?: boolean
}[] = [
  { value: 'sms', icon: '📱', label: 'SMS', description: 'Text message, 160 characters' },
  { value: 'email', icon: '📧', label: 'Email', description: 'Full email with subject line' },
  {
    value: 'social',
    icon: '📣',
    label: 'Social',
    description: 'Short post for social media (coming soon)',
    disabled: true,
  },
]

// ── Shared styles ──────────────────────────────────────────────────────────────

const inputCls =
  'w-full px-3 py-2 text-sm text-ink border border-border-brand rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent'
const primaryBtnCls =
  'px-4 py-2 bg-teal-600 text-white text-sm font-medium rounded-lg hover:bg-teal-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors'
const backBtnCls =
  'px-4 py-2 text-sm text-ink2 border border-border-brand rounded-lg hover:bg-bg transition-colors'

// ── Spinner ────────────────────────────────────────────────────────────────────

function Spinner() {
  return (
    <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
      />
    </svg>
  )
}

// ── Wizard content ─────────────────────────────────────────────────────────────

function NewCampaignContent() {
  const router = useRouter()

  const [step, setStep] = useState(1)
  const [objective, setObjective] = useState<Objective | null>(null)
  const [name, setName] = useState('')
  const [segmentId, setSegmentId] = useState('')
  const [channels, setChannels] = useState<Channel[]>([])
  const [smartLists, setSmartLists] = useState<SmartList[]>([])
  const [listsLoading, setListsLoading] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Load smart lists when entering step 2
  useEffect(() => {
    if (step !== 2) return
    setListsLoading(true)
    fetch('/api/smart-lists')
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { lists?: SmartList[] } | null) => {
        if (d?.lists) setSmartLists(d.lists)
      })
      .catch(() => {})
      .finally(() => setListsLoading(false))
  }, [step])

  function toggleChannel(ch: Channel) {
    setChannels((prev) => (prev.includes(ch) ? prev.filter((c) => c !== ch) : [...prev, ch]))
  }

  async function handleGenerate() {
    setGenerating(true)
    setError(null)
    try {
      // 1. Create campaign
      const createRes = await fetch('/api/campaigns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          objective,
          channels,
          segment_id: segmentId || undefined,
        }),
      })
      const createData = await createRes.json()
      if (!createRes.ok) {
        setError((createData as { error?: string }).error ?? 'Failed to create campaign')
        return
      }
      const campaignId = (createData as { campaign?: { id: string } }).campaign?.id
      if (!campaignId) {
        setError('Unexpected response — no campaign ID returned')
        return
      }

      // 2. Generate copy
      const genRes = await fetch(`/api/campaigns/${campaignId}/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      const genData = await genRes.json()
      if (!genRes.ok) {
        setError((genData as { error?: string }).error ?? 'AI generation failed')
        return
      }

      // 3. Navigate to campaign detail
      router.push(`/campaigns/${campaignId}`)
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setGenerating(false)
    }
  }

  const canGoStep2 = objective !== null
  const canGoStep3 = name.trim().length > 0 && segmentId.length > 0
  const canGenerate = channels.filter((ch) => ch !== 'social').length > 0

  return (
    <div className="px-8 py-8 max-w-2xl">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-xl font-bold text-ink">New Campaign</h1>
        <p className="text-sm text-ink3 mt-0.5">
          Create an AI-powered multi-channel campaign in minutes
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

      {/* ── Step 1: Objective ─────────────────────────────────────────────────── */}
      {step === 1 && (
        <div className="space-y-4">
          <h2 className="text-sm font-semibold text-ink">What&apos;s the goal of this campaign?</h2>

          <div className="space-y-3">
            {OBJECTIVES.map((opt) => {
              const selected = objective === opt.value
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setObjective(opt.value)}
                  className={`w-full text-left px-5 py-4 rounded-xl border-2 transition-all flex items-start gap-4 ${
                    selected
                      ? 'border-teal-500 bg-teal-50'
                      : 'border-border-brand bg-white hover:border-teal-200 hover:bg-teal-50/30'
                  }`}
                >
                  <span className="text-2xl shrink-0 mt-0.5">{opt.icon}</span>
                  <div>
                    <p
                      className={`text-sm font-semibold ${selected ? 'text-teal-800' : 'text-ink'}`}
                    >
                      {opt.label}
                    </p>
                    <p className="text-xs text-ink3 mt-0.5">{opt.description}</p>
                  </div>
                  {selected && (
                    <div className="ml-auto shrink-0 mt-0.5 w-5 h-5 rounded-full bg-teal-500 flex items-center justify-center">
                      <svg
                        className="w-3 h-3 text-white"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={3}
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    </div>
                  )}
                </button>
              )
            })}
          </div>

          <div className="flex justify-end pt-2">
            <button
              type="button"
              onClick={() => setStep(2)}
              disabled={!canGoStep2}
              className={primaryBtnCls}
            >
              Next →
            </button>
          </div>
        </div>
      )}

      {/* ── Step 2: Audience ──────────────────────────────────────────────────── */}
      {step === 2 && (
        <div className="bg-white rounded-xl border border-border-brand p-6 space-y-5">
          <h2 className="text-sm font-semibold text-ink">Who should receive this campaign?</h2>

          {/* Campaign name */}
          <div>
            <label className="block text-xs font-medium text-ink2 mb-1.5">
              Campaign name <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. April lapsed patient win-back"
              className={inputCls}
            />
          </div>

          {/* Segment selector */}
          <div>
            <label className="block text-xs font-medium text-ink2 mb-1.5">
              Target audience <span className="text-red-500">*</span>
            </label>

            {listsLoading ? (
              <div className="flex items-center gap-2 text-sm text-ink3">
                <Spinner />
                Loading segments…
              </div>
            ) : smartLists.length === 0 ? (
              <div className="px-4 py-3 bg-amber-50 border border-amber-100 rounded-lg text-sm text-amber-800">
                No Smart Lists found.{' '}
                <a href="/contacts" className="underline hover:text-amber-900">
                  Create a Smart List first
                </a>{' '}
                to target a specific audience.
              </div>
            ) : (
              <select
                value={segmentId}
                onChange={(e) => setSegmentId(e.target.value)}
                className={inputCls}
              >
                <option value="">Select a Smart List…</option>
                {smartLists.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            )}
          </div>

          <div className="pt-2 flex items-center justify-between">
            <button type="button" onClick={() => setStep(1)} className={backBtnCls}>
              ← Back
            </button>
            <button
              type="button"
              onClick={() => setStep(3)}
              disabled={!canGoStep3}
              className={primaryBtnCls}
            >
              Next →
            </button>
          </div>
        </div>
      )}

      {/* ── Step 3: Channels + Generate ───────────────────────────────────────── */}
      {step === 3 && (
        <div className="space-y-4">
          <h2 className="text-sm font-semibold text-ink">How do you want to reach them?</h2>
          <p className="text-xs text-ink3">Select at least one channel (SMS or Email).</p>

          <div className="space-y-3">
            {CHANNELS.map((ch) => {
              const selected = channels.includes(ch.value)
              return (
                <button
                  key={ch.value}
                  type="button"
                  onClick={() => !ch.disabled && toggleChannel(ch.value)}
                  disabled={ch.disabled}
                  className={`w-full text-left px-5 py-4 rounded-xl border-2 transition-all flex items-start gap-4 ${
                    ch.disabled
                      ? 'border-border-brand bg-gray-50 opacity-50 cursor-not-allowed'
                      : selected
                        ? 'border-teal-500 bg-teal-50'
                        : 'border-border-brand bg-white hover:border-teal-200 hover:bg-teal-50/30'
                  }`}
                >
                  <span className="text-2xl shrink-0 mt-0.5">{ch.icon}</span>
                  <div className="flex-1">
                    <p
                      className={`text-sm font-semibold ${selected && !ch.disabled ? 'text-teal-800' : 'text-ink'}`}
                    >
                      {ch.label}
                      {ch.disabled && (
                        <span className="ml-2 text-xs font-normal text-ink3">(coming soon)</span>
                      )}
                    </p>
                    <p className="text-xs text-ink3 mt-0.5">{ch.description}</p>
                  </div>
                  {selected && !ch.disabled && (
                    <div className="shrink-0 mt-0.5 w-5 h-5 rounded-full bg-teal-500 flex items-center justify-center">
                      <svg
                        className="w-3 h-3 text-white"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={3}
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    </div>
                  )}
                </button>
              )
            })}
          </div>

          {/* Summary */}
          <div className="bg-bg rounded-lg border border-border-brand p-4 text-xs text-ink3 space-y-1">
            <p>
              <span className="font-medium text-ink2">Objective:</span>{' '}
              {OBJECTIVES.find((o) => o.value === objective)?.label ?? '—'}
            </p>
            <p>
              <span className="font-medium text-ink2">Name:</span> {name || '—'}
            </p>
            <p>
              <span className="font-medium text-ink2">Audience:</span>{' '}
              {smartLists.find((l) => l.id === segmentId)?.name ?? '—'}
            </p>
          </div>

          <div className="pt-2 flex items-center justify-between">
            <button type="button" onClick={() => setStep(2)} className={backBtnCls}>
              ← Back
            </button>
            <button
              type="button"
              onClick={handleGenerate}
              disabled={!canGenerate || generating}
              className={`${primaryBtnCls} flex items-center gap-2`}
            >
              {generating && <Spinner />}
              {generating ? 'Generating copy with AI…' : '✨ Generate campaign'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Page export ────────────────────────────────────────────────────────────────

export default function NewCampaignPage() {
  return (
    <Suspense fallback={<div className="px-8 py-8 text-sm text-ink3">Loading…</div>}>
      <NewCampaignContent />
    </Suspense>
  )
}
