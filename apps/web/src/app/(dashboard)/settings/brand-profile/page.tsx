'use client'

import { useState, useEffect, useRef, KeyboardEvent } from 'react'

// ─── Types ────────────────────────────────────────────────────────────────────

interface BrandVoice {
  tone?: 'professional' | 'friendly' | 'casual' | 'authoritative' | 'warm'
  formality?: 'formal' | 'semi-formal' | 'informal'
  emoji_use?: 'none' | 'minimal' | 'moderate'
  industry_terms?: string[]
  avoid_phrases?: string[]
  signature?: string
  sample_message?: string
}

// ─── Tone options ─────────────────────────────────────────────────────────────

const TONE_OPTIONS: Array<{
  value: NonNullable<BrandVoice['tone']>
  label: string
  description: string
}> = [
  { value: 'professional', label: 'Professional', description: 'Clear, competent, no fluff' },
  {
    value: 'friendly',
    label: 'Friendly',
    description: 'Warm and approachable, like talking to a neighbor',
  },
  { value: 'casual', label: 'Casual', description: 'Relaxed, conversational, informal' },
  {
    value: 'authoritative',
    label: 'Authoritative',
    description: 'Expert, confident, industry leader',
  },
  { value: 'warm', label: 'Warm', description: 'Empathetic, caring, relationship-first' },
]

const FORMALITY_OPTIONS: Array<{ value: NonNullable<BrandVoice['formality']>; label: string }> = [
  { value: 'formal', label: 'Formal' },
  { value: 'semi-formal', label: 'Semi-formal' },
  { value: 'informal', label: 'Informal' },
]

const EMOJI_OPTIONS: Array<{ value: NonNullable<BrandVoice['emoji_use']>; label: string }> = [
  { value: 'none', label: 'None' },
  { value: 'minimal', label: 'Minimal' },
  { value: 'moderate', label: 'Moderate' },
]

// ─── Shared class constants ───────────────────────────────────────────────────

const inputCls =
  'w-full px-3 py-2 text-sm text-ink border border-border-brand rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent'
const saveBtnCls =
  'px-4 py-2 bg-teal-600 text-white text-sm font-medium rounded-lg hover:bg-teal-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors'

// ─── Tag input component ──────────────────────────────────────────────────────

function TagInput({
  tags,
  onChange,
  placeholder,
  maxTags = 10,
}: {
  tags: string[]
  onChange: (tags: string[]) => void
  placeholder?: string
  maxTags?: number
}) {
  const [input, setInput] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  function addTag() {
    const val = input.trim()
    if (!val || tags.includes(val) || tags.length >= maxTags) return
    onChange([...tags, val])
    setInput('')
  }

  function removeTag(index: number) {
    onChange(tags.filter((_, i) => i !== index))
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault()
      addTag()
    } else if (e.key === 'Backspace' && input === '' && tags.length > 0) {
      onChange(tags.slice(0, -1))
    }
  }

  const atMax = tags.length >= maxTags

  return (
    <div>
      <div
        className="flex flex-wrap gap-1.5 p-2 border border-border-brand rounded-lg bg-white min-h-[42px] cursor-text"
        onClick={() => inputRef.current?.focus()}
      >
        {tags.map((tag, i) => (
          <span
            key={i}
            className="inline-flex items-center gap-1 px-2 py-0.5 bg-gray-100 text-ink text-xs rounded-md"
          >
            {tag}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                removeTag(i)
              }}
              className="text-ink3 hover:text-ink transition-colors leading-none"
              aria-label={`Remove ${tag}`}
            >
              ×
            </button>
          </span>
        ))}
        {!atMax && (
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            onBlur={addTag}
            placeholder={tags.length === 0 ? placeholder : ''}
            className="flex-1 min-w-[120px] text-sm text-ink bg-transparent outline-none placeholder:text-ink4"
          />
        )}
      </div>
      <p className="text-[11px] text-ink4 mt-1 text-right">
        {tags.length}/{maxTags}
      </p>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function BrandVoicePage() {
  const [form, setForm] = useState<BrandVoice>({
    tone: undefined,
    formality: undefined,
    emoji_use: undefined,
    industry_terms: [],
    avoid_phrases: [],
    signature: '',
    sample_message: '',
  })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState<{ type: 'success' | 'error'; msg: string } | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [previewing, setPreviewing] = useState(false)

  // ─── Load on mount ──────────────────────────────────────────────────────────
  useEffect(() => {
    fetch('/api/brand-voice', { headers: { 'Content-Type': 'application/json' } })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: BrandVoice | null) => {
        if (data) {
          setForm({
            tone: data.tone,
            formality: data.formality,
            emoji_use: data.emoji_use,
            industry_terms: data.industry_terms ?? [],
            avoid_phrases: data.avoid_phrases ?? [],
            signature: data.signature ?? '',
            sample_message: data.sample_message ?? '',
          })
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  // ─── Save ───────────────────────────────────────────────────────────────────
  async function save() {
    setSaving(true)
    setToast(null)
    try {
      const res = await fetch('/api/brand-voice', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      if (res.ok) {
        setToast({ type: 'success', msg: 'Brand voice saved — AI will now match your style.' })
      } else {
        const d = await res.json().catch(() => ({}))
        setToast({ type: 'error', msg: (d as { error?: string }).error ?? 'Failed to save' })
      }
    } catch {
      setToast({ type: 'error', msg: 'Failed to save brand voice' })
    } finally {
      setSaving(false)
      setTimeout(() => setToast(null), 3000)
    }
  }

  // ─── Preview ────────────────────────────────────────────────────────────────
  async function generatePreview() {
    setPreviewing(true)
    setPreview(null)
    try {
      const res = await fetch('/api/brand-voice/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      if (res.ok) {
        const d = await res.json()
        setPreview(
          (d as { preview?: string; message?: string }).preview ??
            (d as { preview?: string; message?: string }).message ??
            ''
        )
      } else {
        setPreview('Preview unavailable — try saving your settings first.')
      }
    } catch {
      setPreview('Failed to generate preview.')
    } finally {
      setPreviewing(false)
    }
  }

  function patch(partial: Partial<BrandVoice>) {
    setForm((prev) => ({ ...prev, ...partial }))
  }

  if (loading) {
    return (
      <div className="px-8 py-8 max-w-3xl">
        <p className="text-sm text-ink4">Loading brand voice settings...</p>
      </div>
    )
  }

  const signatureCount = (form.signature ?? '').length
  const sampleCount = (form.sample_message ?? '').length

  return (
    <div className="px-8 py-8 max-w-3xl space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-ink mb-1">Brand Voice</h1>
        <p className="text-sm text-ink3">
          Shape how your AI sounds — tone, style, and the words that are uniquely yours.
        </p>
      </div>

      {/* ── Section 1: Tone & Style ──────────────────────────────────────────── */}
      <section className="space-y-6">
        <h2 className="text-sm font-semibold text-ink uppercase tracking-wide">Tone &amp; Style</h2>

        {/* Tone cards */}
        <div>
          <p className="text-sm font-medium text-ink mb-2">Tone</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {TONE_OPTIONS.map(({ value, label, description }) => {
              const selected = form.tone === value
              return (
                <button
                  key={value}
                  type="button"
                  onClick={() => patch({ tone: value })}
                  className={`text-left px-4 py-3 rounded-xl border-2 transition-colors ${
                    selected
                      ? 'border-teal-500 bg-teal-50'
                      : 'border-border-brand bg-white hover:bg-bg'
                  }`}
                >
                  <p className={`text-sm font-medium ${selected ? 'text-teal-700' : 'text-ink'}`}>
                    {label}
                  </p>
                  <p className="text-xs text-ink3 mt-0.5 leading-snug">{description}</p>
                </button>
              )
            })}
          </div>
        </div>

        {/* Formality toggle */}
        <div>
          <p className="text-sm font-medium text-ink mb-2">Formality</p>
          <div className="inline-flex rounded-lg overflow-hidden border border-border-brand">
            {FORMALITY_OPTIONS.map(({ value, label }) => {
              const selected = form.formality === value
              return (
                <button
                  key={value}
                  type="button"
                  onClick={() => patch({ formality: value })}
                  className={`px-4 py-2 text-sm font-medium transition-colors ${
                    selected
                      ? 'bg-teal-600 text-white'
                      : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                  }`}
                >
                  {label}
                </button>
              )
            })}
          </div>
        </div>

        {/* Emoji use toggle */}
        <div>
          <p className="text-sm font-medium text-ink mb-2">Emoji use</p>
          <div className="inline-flex rounded-lg overflow-hidden border border-border-brand">
            {EMOJI_OPTIONS.map(({ value, label }) => {
              const selected = form.emoji_use === value
              return (
                <button
                  key={value}
                  type="button"
                  onClick={() => patch({ emoji_use: value })}
                  className={`px-4 py-2 text-sm font-medium transition-colors ${
                    selected
                      ? 'bg-teal-600 text-white'
                      : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                  }`}
                >
                  {label}
                </button>
              )
            })}
          </div>
        </div>
      </section>

      {/* ── Section 2: Your Words ────────────────────────────────────────────── */}
      <section className="space-y-6">
        <h2 className="text-sm font-semibold text-ink uppercase tracking-wide">Your Words</h2>

        {/* Industry terms */}
        <div>
          <p className="text-sm font-medium text-ink mb-1">Industry terms</p>
          <p className="text-xs text-ink3 mb-2">
            Words and phrases your AI should use naturally in messages.
          </p>
          <TagInput
            tags={form.industry_terms ?? []}
            onChange={(tags) => patch({ industry_terms: tags })}
            placeholder="e.g. same-day service, free estimates, HVAC"
          />
        </div>

        {/* Phrases to avoid */}
        <div>
          <p className="text-sm font-medium text-ink mb-1">Phrases to avoid</p>
          <p className="text-xs text-ink3 mb-2">Words or phrases your AI should never use.</p>
          <TagInput
            tags={form.avoid_phrases ?? []}
            onChange={(tags) => patch({ avoid_phrases: tags })}
            placeholder="e.g. cheap, discount, no problem"
          />
        </div>
      </section>

      {/* ── Section 3: Signature & Sample ───────────────────────────────────── */}
      <section className="space-y-6">
        <h2 className="text-sm font-semibold text-ink uppercase tracking-wide">
          Signature &amp; Sample
        </h2>

        {/* Sign-off line */}
        <div>
          <label className="block text-sm font-medium text-ink mb-1" htmlFor="signature">
            Sign-off line
          </label>
          <input
            id="signature"
            type="text"
            maxLength={100}
            value={form.signature ?? ''}
            onChange={(e) => patch({ signature: e.target.value })}
            placeholder="The team at Sunrise Dental"
            className={inputCls}
          />
          <p className="text-[11px] text-ink4 mt-1 text-right">{signatureCount}/100</p>
        </div>

        {/* Sample message */}
        <div>
          <label className="block text-sm font-medium text-ink mb-1" htmlFor="sample_message">
            Sample message
          </label>
          <p className="text-xs text-ink3 mb-2">
            Write a sample message in your voice — AI will match this style.
          </p>
          <textarea
            id="sample_message"
            maxLength={500}
            rows={5}
            value={form.sample_message ?? ''}
            onChange={(e) => patch({ sample_message: e.target.value })}
            placeholder={
              "Hi Sarah! Just a reminder your cleaning is tomorrow at 2pm with Dr. Kim.\nText us if you need to reschedule — we're always happy to help! See you soon 😊 — Sunrise Dental"
            }
            className={`${inputCls} resize-none`}
          />
          <p className="text-[11px] text-ink4 mt-1 text-right">{sampleCount}/500</p>
        </div>
      </section>

      {/* ── Preview Panel ────────────────────────────────────────────────────── */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-ink uppercase tracking-wide">SMS Preview</h2>
        <p className="text-xs text-ink3">
          Generate a sample message to see how your AI will sound with these settings.
        </p>
        <button
          type="button"
          onClick={generatePreview}
          disabled={previewing}
          className="px-4 py-2 bg-white text-ink text-sm font-medium rounded-lg border border-border-brand hover:bg-bg disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {previewing ? 'Generating...' : 'Preview'}
        </button>
        {preview !== null && (
          <div className="mt-3">
            <p className="text-[11px] text-ink4 mb-1.5 uppercase tracking-wide font-medium">
              SMS Preview
            </p>
            <div className="bg-gray-100 rounded-2xl rounded-tl-sm px-4 py-3 max-w-sm">
              <p className="text-sm text-ink leading-relaxed whitespace-pre-wrap">{preview}</p>
            </div>
          </div>
        )}
      </section>

      {/* ── Toast ────────────────────────────────────────────────────────────── */}
      {toast && (
        <p
          className={`text-sm px-3 py-2 rounded-lg ${
            toast.type === 'success' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-600'
          }`}
        >
          {toast.msg}
        </p>
      )}

      {/* ── Save button ──────────────────────────────────────────────────────── */}
      <div>
        <button type="button" onClick={save} disabled={saving} className={saveBtnCls}>
          {saving ? 'Saving...' : 'Save Brand Voice'}
        </button>
      </div>
    </div>
  )
}
