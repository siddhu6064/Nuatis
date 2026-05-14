'use client'

import { useState } from 'react'

export interface ContactFields {
  id: string
  full_name: string
  email: string | null
  phone: string | null
  phone_alt: string | null
  source: string | null
  referral_source_detail: string | null
  tags: string[]
  notes: string | null
  pipeline_stage: string | null
}

interface FormState {
  full_name: string
  email: string
  phone: string
  phone_alt: string
  source: string
  referral_source_detail: string
  referred_by: string
  tags: string
  notes: string
}

const SOURCE_OPTIONS = [
  { value: '', label: '— None —' },
  { value: 'manual', label: 'Manual' },
  { value: 'inbound_call', label: 'Inbound Call' },
  { value: 'csv_import', label: 'CSV Import' },
  { value: 'web_form', label: 'Web Form' },
]

function validate(form: FormState): { field: keyof FormState; msg: string } | null {
  if (!form.full_name.trim()) return { field: 'full_name', msg: 'Name is required' }
  if (form.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim()))
    return { field: 'email', msg: 'Invalid email address' }
  return null
}

interface Props {
  contact: ContactFields
}

export default function ContactHeader({ contact: initial }: Props) {
  const [contact, setContact] = useState(initial)
  const [editOpen, setEditOpen] = useState(false)
  const [toast, setToast] = useState<string | null>(null)

  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(null), 3500)
  }

  function handleSaved(updated: ContactFields) {
    setContact(updated)
    setEditOpen(false)
    showToast('Contact updated')
  }

  return (
    <>
      <div className="flex items-start gap-4 mb-8">
        <div className="w-12 h-12 rounded-full bg-teal-100 flex items-center justify-center shrink-0">
          <span className="text-teal-700 text-lg font-bold">
            {contact.full_name?.charAt(0)?.toUpperCase() ?? '?'}
          </span>
        </div>

        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-bold text-ink">{contact.full_name}</h1>
          <div className="flex items-center gap-3 mt-1 text-sm text-ink3 flex-wrap">
            {contact.email && <span>{contact.email}</span>}
            {contact.phone && <span>{contact.phone}</span>}
            {contact.pipeline_stage && (
              <span className="px-2 py-0.5 rounded text-xs font-medium bg-teal-50 text-teal-700">
                {contact.pipeline_stage}
              </span>
            )}
          </div>
        </div>

        <button
          onClick={() => setEditOpen(true)}
          className="shrink-0 inline-flex items-center gap-1.5 rounded-lg border border-border-brand bg-white px-3 py-1.5 text-sm font-medium text-ink2 hover:bg-bg transition-colors"
        >
          <svg
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
          </svg>
          Edit
        </button>
      </div>

      {toast && (
        <div className="fixed bottom-6 right-6 z-50 px-4 py-3 rounded-xl shadow-lg text-sm font-medium bg-teal-600 text-white">
          {toast}
        </div>
      )}

      {editOpen && (
        <EditDrawer contact={contact} onClose={() => setEditOpen(false)} onSaved={handleSaved} />
      )}
    </>
  )
}

function EditDrawer({
  contact,
  onClose,
  onSaved,
}: {
  contact: ContactFields
  onClose: () => void
  onSaved: (updated: ContactFields) => void
}) {
  const [form, setForm] = useState<FormState>({
    full_name: contact.full_name,
    email: contact.email ?? '',
    phone: contact.phone ?? '',
    phone_alt: contact.phone_alt ?? '',
    source: contact.source ?? '',
    referral_source_detail: contact.referral_source_detail ?? '',
    referred_by: '',
    tags: (contact.tags ?? []).join(', '),
    notes: contact.notes ?? '',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fieldError, setFieldError] = useState<keyof FormState | null>(null)

  function set(key: keyof FormState, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }))
    setFieldError(null)
    setError(null)
  }

  async function handleSave() {
    const validationErr = validate(form)
    if (validationErr) {
      setFieldError(validationErr.field)
      setError(validationErr.msg)
      return
    }

    setSaving(true)
    setError(null)

    const tags = form.tags
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean)

    const payload = {
      full_name: form.full_name.trim(),
      email: form.email.trim() || null,
      phone: form.phone.trim() || null,
      phone_alt: form.phone_alt.trim() || null,
      source: form.source || null,
      referral_source_detail: form.referral_source_detail.trim() || null,
      tags,
      notes: form.notes.trim() || null,
    }

    try {
      const res = await fetch(`/api/contacts/${contact.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      if (res.ok) {
        const data = (await res.json()) as Record<string, unknown>
        onSaved({
          ...contact,
          full_name: (data['full_name'] as string) ?? payload.full_name,
          email: (data['email'] as string | null) ?? payload.email,
          phone: (data['phone'] as string | null) ?? payload.phone,
          phone_alt: (data['phone_alt'] as string | null) ?? payload.phone_alt,
          source: (data['source'] as string | null) ?? payload.source,
          referral_source_detail:
            (data['referral_source_detail'] as string | null) ?? payload.referral_source_detail,
          tags: Array.isArray(data['tags']) ? (data['tags'] as string[]) : tags,
          notes: (data['notes'] as string | null) ?? payload.notes,
        })
      } else {
        const d = (await res.json().catch(() => ({}))) as { error?: string }
        setError(d.error ?? 'Failed to save. Please try again.')
      }
    } catch {
      setError('Network error. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  const inp = (hasErr: boolean) =>
    `w-full px-3 py-2 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent ${
      hasErr ? 'border-red-300 focus:ring-red-400' : 'border-border-brand'
    }`

  const tagPills = form.tags
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean)

  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-end">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />

      {/* Drawer */}
      <div className="relative w-full max-w-md bg-white shadow-xl flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border-brand shrink-0">
          <h2 className="text-base font-semibold text-ink">Edit Contact</h2>
          <button
            onClick={onClose}
            className="text-ink4 hover:text-ink3 transition-colors"
            aria-label="Close"
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
          <div>
            <label className="block text-xs font-medium text-ink2 mb-1">
              Full Name <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={form.full_name}
              onChange={(e) => set('full_name', e.target.value)}
              className={inp(fieldError === 'full_name')}
              placeholder="Jane Doe"
              autoFocus
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-ink2 mb-1">Email</label>
            <input
              type="email"
              value={form.email}
              onChange={(e) => set('email', e.target.value)}
              className={inp(fieldError === 'email')}
              placeholder="jane@example.com"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-ink2 mb-1">Phone</label>
              <input
                type="tel"
                value={form.phone}
                onChange={(e) => set('phone', e.target.value)}
                className={inp(false)}
                placeholder="+1 (555) 000-0000"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-ink2 mb-1">
                Alt Phone <span className="text-ink4 font-normal">(optional)</span>
              </label>
              <input
                type="tel"
                value={form.phone_alt}
                onChange={(e) => set('phone_alt', e.target.value)}
                className={inp(false)}
                placeholder="+1 (555) 000-0000"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-ink2 mb-1">Source</label>
            <select
              value={form.source}
              onChange={(e) => set('source', e.target.value)}
              className={`${inp(false)} bg-white`}
            >
              {SOURCE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-ink2 mb-1">Referral Source</label>
            <input
              type="text"
              value={form.referral_source_detail}
              onChange={(e) => set('referral_source_detail', e.target.value)}
              className={inp(false)}
              placeholder="e.g. Google, Instagram, Friend"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-ink2 mb-1">Tags</label>
            <input
              type="text"
              value={form.tags}
              onChange={(e) => set('tags', e.target.value)}
              className={inp(false)}
              placeholder="vip, returning, high-priority"
            />
            {tagPills.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-2">
                {tagPills.map((tag, i) => (
                  <span
                    key={i}
                    className="px-2 py-0.5 rounded-full text-xs font-medium bg-bg2 text-ink3"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            )}
            <p className="text-[10px] text-ink4 mt-1">Comma-separated</p>
          </div>

          <div>
            <label className="block text-xs font-medium text-ink2 mb-1">Notes</label>
            <textarea
              value={form.notes}
              onChange={(e) => set('notes', e.target.value)}
              rows={4}
              className={inp(false)}
              placeholder="Any additional notes…"
            />
          </div>

          {error && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
              {error}
            </p>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 px-6 py-4 border-t border-border-brand shrink-0">
          <button
            onClick={onClose}
            disabled={saving}
            className="px-4 py-2 text-sm font-medium text-ink2 border border-border-brand rounded-lg hover:bg-bg transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={() => void handleSave()}
            disabled={saving}
            className="px-4 py-2 text-sm font-medium text-white bg-teal-600 rounded-lg hover:bg-teal-700 disabled:opacity-50 transition-colors"
          >
            {saving ? 'Saving…' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  )
}
