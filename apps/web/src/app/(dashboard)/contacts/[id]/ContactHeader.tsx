'use client'

import { useEffect, useState } from 'react'
import Button from '@mui/material/Button'
import IconButton from '@mui/material/IconButton'
import TextField from '@mui/material/TextField'
import Select from '@mui/material/Select'
import MenuItem from '@mui/material/MenuItem'
import Alert from '@mui/material/Alert'
import { SlideOver } from '@/components/ui/SlideOver'

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

function buildFormState(contact: ContactFields): FormState {
  return {
    full_name: contact.full_name,
    email: contact.email ?? '',
    phone: contact.phone ?? '',
    phone_alt: contact.phone_alt ?? '',
    source: contact.source ?? '',
    referral_source_detail: contact.referral_source_detail ?? '',
    referred_by: '',
    tags: (contact.tags ?? []).join(', '),
    notes: contact.notes ?? '',
  }
}

function validate(form: FormState): { field: keyof FormState; msg: string } | null {
  if (!form.full_name.trim()) return { field: 'full_name', msg: 'Name is required' }
  if (form.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim()))
    return { field: 'email', msg: 'Invalid email address' }
  return null
}

// ── Icons (inline SVG — matches this app's existing icon convention; no
// @mui/icons-material dependency in this repo) ──────────────────────────────

function PhoneIcon() {
  return (
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
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12 19.79 19.79 0 0 1 1.65 3.44a2 2 0 0 1 1.95-2.17H6a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L7.09 9A16 16 0 0 0 15 16.91l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22.92 16z" />
    </svg>
  )
}

function EditIcon() {
  return (
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
  )
}

interface Props {
  contact: ContactFields
  onSaved?: () => void
}

export default function ContactHeader({ contact: initial, onSaved }: Props) {
  const [contact, setContact] = useState(initial)
  const [editOpen, setEditOpen] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [callJobId, setCallJobId] = useState<string | null>(null)
  const [callStatus, setCallStatus] = useState<'idle' | 'dialing' | 'connected' | 'ended'>('idle')

  useEffect(() => {
    if (!callJobId) return
    let polls = 0
    const MAX_POLLS = 40 // 40 × 3s = 2 min max
    let resetTimeout: ReturnType<typeof setTimeout> | null = null

    const interval = setInterval(async () => {
      polls++
      if (polls > MAX_POLLS) {
        clearInterval(interval)
        setCallStatus('ended')
        setCallJobId(null)
        return
      }
      try {
        const r = await fetch(`/api/outbound-calls/${callJobId}`)
        if (!r.ok) return
        const d = (await r.json()) as { status: string }
        if (d.status === 'connected') {
          setCallStatus('connected')
        } else if (
          d.status === 'completed' ||
          d.status === 'failed' ||
          d.status === 'no_answer' ||
          d.status === 'cancelled'
        ) {
          clearInterval(interval)
          setCallStatus('ended')
          setCallJobId(null)
          resetTimeout = setTimeout(() => setCallStatus('idle'), 3000)
        }
      } catch {
        // ignore poll errors
      }
    }, 3000)

    return () => {
      clearInterval(interval)
      if (resetTimeout) clearTimeout(resetTimeout)
    }
  }, [callJobId])

  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(null), 3500)
  }

  function handleSaved(updated: ContactFields) {
    setContact(updated)
    setEditOpen(false)
    showToast('Contact updated')
    onSaved?.()
  }

  async function handleCall() {
    if (!contact.phone || callStatus !== 'idle') return
    setCallStatus('dialing')
    try {
      const r = await fetch('/api/outbound-calls', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contact_id: contact.id,
          call_context: `Following up with ${contact.full_name ?? 'contact'}`,
        }),
      })
      if (!r.ok) {
        const d = (await r.json().catch(() => ({}))) as { error?: string }
        showToast(d.error ?? 'Failed to initiate call')
        setCallStatus('idle')
        return
      }
      const d = (await r.json()) as { job_id: string }
      setCallJobId(d.job_id)
      showToast(`Dialing ${contact.full_name ?? contact.phone}…`)
    } catch {
      showToast('Failed to initiate call')
      setCallStatus('idle')
    }
  }

  const callBg =
    callStatus === 'connected'
      ? '#dcfce7'
      : callStatus === 'dialing'
        ? '#ffedd5'
        : callStatus === 'ended'
          ? '#f0fdfa'
          : contact.phone
            ? '#fff7ed'
            : undefined
  const callColor =
    callStatus === 'connected'
      ? '#16a34a'
      : callStatus === 'dialing'
        ? '#ea580c'
        : callStatus === 'ended'
          ? '#0d9488'
          : contact.phone
            ? '#ea580c'
            : undefined

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
            <div className="inline-flex items-center gap-1.5">
              <IconButton
                disabled={!contact.phone || callStatus !== 'idle'}
                onClick={() => void handleCall()}
                title={
                  !contact.phone
                    ? 'No phone number'
                    : callStatus === 'dialing'
                      ? 'Dialing…'
                      : callStatus === 'connected'
                        ? 'Connected'
                        : callStatus === 'ended'
                          ? 'Call ended'
                          : `Call ${contact.phone}`
                }
                size="small"
                className={
                  callStatus === 'connected' || callStatus === 'dialing' ? 'animate-pulse' : ''
                }
                sx={{
                  width: 28,
                  height: 28,
                  bgcolor: callBg,
                  color: callColor,
                  '&:hover': { bgcolor: callBg },
                  '&.Mui-disabled': !contact.phone ? { opacity: 0.4 } : undefined,
                }}
              >
                <PhoneIcon />
              </IconButton>
              {callStatus !== 'idle' && (
                <span
                  className={`text-xs font-medium ${
                    callStatus === 'connected'
                      ? 'text-green-600'
                      : callStatus === 'dialing'
                        ? 'text-orange-600'
                        : callStatus === 'ended'
                          ? 'text-teal-600'
                          : 'text-ink4'
                  }`}
                >
                  {callStatus === 'dialing'
                    ? 'Dialing…'
                    : callStatus === 'connected'
                      ? 'Connected'
                      : callStatus === 'ended'
                        ? 'Call ended'
                        : ''}
                </span>
              )}
            </div>
            {contact.pipeline_stage && (
              <span className="px-2 py-0.5 rounded text-xs font-medium bg-teal-50 text-teal-700">
                {contact.pipeline_stage}
              </span>
            )}
          </div>
        </div>

        <Button
          onClick={() => setEditOpen(true)}
          variant="outlined"
          color="inherit"
          size="small"
          startIcon={<EditIcon />}
          sx={{ textTransform: 'none', flexShrink: 0 }}
        >
          Edit
        </Button>
      </div>

      {toast && (
        <div className="fixed bottom-6 right-6 z-50 px-4 py-3 rounded-xl shadow-lg text-sm font-medium bg-teal-600 text-white">
          {toast}
        </div>
      )}

      <EditDrawer
        contact={contact}
        open={editOpen}
        onClose={() => setEditOpen(false)}
        onSaved={handleSaved}
      />
    </>
  )
}

function EditDrawer({
  contact,
  open,
  onClose,
  onSaved,
}: {
  contact: ContactFields
  open: boolean
  onClose: () => void
  onSaved: (updated: ContactFields) => void
}) {
  const [form, setForm] = useState<FormState>(() => buildFormState(contact))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fieldError, setFieldError] = useState<keyof FormState | null>(null)

  // Reset the form from the latest contact data each time the drawer opens —
  // it now stays mounted (per Phase 14/16 convention, so the slide animation
  // plays), so state can't rely on a fresh mount to reset itself anymore.
  useEffect(() => {
    if (open) {
      setForm(buildFormState(contact))
      setError(null)
      setFieldError(null)
    }
  }, [open, contact])

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

  const tagPills = form.tags
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean)

  return (
    <SlideOver
      open={open}
      onClose={onClose}
      title="Edit Contact"
      footer={
        <div className="flex gap-2">
          <Button
            onClick={onClose}
            disabled={saving}
            variant="outlined"
            color="inherit"
            sx={{ flex: 1 }}
          >
            Cancel
          </Button>
          <Button
            onClick={() => void handleSave()}
            disabled={saving}
            variant="contained"
            sx={{ flex: 1 }}
          >
            {saving ? 'Saving…' : 'Save Changes'}
          </Button>
        </div>
      }
    >
      <div className="px-6 py-5 space-y-4">
        <TextField
          label="Full Name"
          required
          value={form.full_name}
          onChange={(e) => set('full_name', e.target.value)}
          error={fieldError === 'full_name'}
          placeholder="Jane Doe"
          size="small"
          fullWidth
          autoFocus
        />

        <TextField
          label="Email"
          type="email"
          value={form.email}
          onChange={(e) => set('email', e.target.value)}
          error={fieldError === 'email'}
          placeholder="jane@example.com"
          size="small"
          fullWidth
        />

        <div className="grid grid-cols-2 gap-3">
          <TextField
            label="Phone"
            type="tel"
            value={form.phone}
            onChange={(e) => set('phone', e.target.value)}
            placeholder="+1 (555) 000-0000"
            size="small"
            fullWidth
          />
          <TextField
            label="Alt Phone (optional)"
            type="tel"
            value={form.phone_alt}
            onChange={(e) => set('phone_alt', e.target.value)}
            placeholder="+1 (555) 000-0000"
            size="small"
            fullWidth
          />
        </div>

        <Select
          value={form.source}
          onChange={(e) => set('source', e.target.value)}
          size="small"
          fullWidth
        >
          {SOURCE_OPTIONS.map((o) => (
            <MenuItem key={o.value} value={o.value}>
              {o.label}
            </MenuItem>
          ))}
        </Select>

        <TextField
          label="Referral Source"
          value={form.referral_source_detail}
          onChange={(e) => set('referral_source_detail', e.target.value)}
          placeholder="e.g. Google, Instagram, Friend"
          size="small"
          fullWidth
        />

        <div>
          <TextField
            label="Tags"
            value={form.tags}
            onChange={(e) => set('tags', e.target.value)}
            placeholder="vip, returning, high-priority"
            helperText="Comma-separated"
            size="small"
            fullWidth
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
        </div>

        <TextField
          label="Notes"
          value={form.notes}
          onChange={(e) => set('notes', e.target.value)}
          multiline
          rows={4}
          placeholder="Any additional notes…"
          size="small"
          fullWidth
        />

        {error && <Alert severity="error">{error}</Alert>}
      </div>
    </SlideOver>
  )
}
