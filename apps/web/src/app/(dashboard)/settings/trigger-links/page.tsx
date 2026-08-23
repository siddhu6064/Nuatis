'use client'

import { useState, useEffect, useCallback } from 'react'
import Button from '@mui/material/Button'
import TextField from '@mui/material/TextField'
import MenuItem from '@mui/material/MenuItem'

const NEXT_PUBLIC_API_URL = process.env['NEXT_PUBLIC_API_URL'] ?? 'https://api.nuatis.com'

const ACTION_LABELS: Record<string, string> = {
  confirm_appointment: 'Confirm Appointment',
  cancel_appointment: 'Cancel Appointment',
  mark_contacted: 'Mark as Contacted',
  mark_won: 'Mark Deal Won',
  mark_lost: 'Mark Deal Lost',
  custom_webhook: 'Custom Webhook',
}

interface TriggerLink {
  id: string
  name: string
  slug: string
  action: string
  click_count: number
  created_at: string
  short_url?: string
}

interface FormState {
  name: string
  action: string
  redirect_url: string
  webhook_url: string
}

const DEFAULT_FORM: FormState = {
  name: '',
  action: 'confirm_appointment',
  redirect_url: '',
  webhook_url: '',
}

function CopyButton({ url }: { url: string }) {
  const [copied, setCopied] = useState(false)

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // clipboard not available
    }
  }

  return (
    <Button onClick={handleCopy} size="small" color="inherit" sx={{ ml: 1, flexShrink: 0 }}>
      {copied ? 'Copied!' : 'Copy'}
    </Button>
  )
}

export default function TriggerLinksPage() {
  const [links, setLinks] = useState<TriggerLink[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState<FormState>(DEFAULT_FORM)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [toast, setToast] = useState<{ type: 'success' | 'error'; msg: string } | null>(null)

  function showToast(type: 'success' | 'error', msg: string) {
    setToast({ type, msg })
    setTimeout(() => setToast(null), 4000)
  }

  const fetchLinks = useCallback(async () => {
    try {
      const res = await fetch('/api/trigger-links')
      if (!res.ok) throw new Error('Failed to fetch')
      const data = (await res.json()) as { trigger_links: TriggerLink[] }
      const withUrls = (data.trigger_links ?? []).map((link) => ({
        ...link,
        short_url: `${NEXT_PUBLIC_API_URL}/t/${link.slug}`,
      }))
      setLinks(withUrls)
    } catch {
      showToast('error', 'Failed to load trigger links')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void fetchLinks()
  }, [fetchLinks])

  async function handleCreate() {
    if (!form.name.trim()) {
      setError('Name is required')
      return
    }
    setError(null)
    setSaving(true)
    try {
      const action_config: Record<string, string> = {}
      if (form.redirect_url.trim()) action_config['redirect_url'] = form.redirect_url.trim()
      if (form.action === 'custom_webhook' && form.webhook_url.trim()) {
        action_config['webhook_url'] = form.webhook_url.trim()
      }

      const res = await fetch('/api/trigger-links', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name.trim(),
          action: form.action,
          action_config,
        }),
      })

      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        throw new Error((d as { error?: string }).error ?? 'Failed to create')
      }

      const data = (await res.json()) as { trigger_link: TriggerLink; short_url: string }
      const newLink: TriggerLink = {
        ...data.trigger_link,
        short_url: data.short_url ?? `${NEXT_PUBLIC_API_URL}/t/${data.trigger_link.slug}`,
      }
      setLinks((prev) => [newLink, ...prev])
      setForm(DEFAULT_FORM)
      setShowForm(false)
      showToast('success', 'Trigger link created')
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : 'Failed to create trigger link')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(id: string, name: string) {
    if (!window.confirm(`Delete trigger link "${name}"? This cannot be undone.`)) return
    try {
      const res = await fetch(`/api/trigger-links/${id}`, { method: 'DELETE' })
      if (!res.ok && res.status !== 204) throw new Error('Failed to delete')
      setLinks((prev) => prev.filter((l) => l.id !== id))
      showToast('success', 'Trigger link deleted')
    } catch {
      showToast('error', 'Failed to delete trigger link')
    }
  }

  function formatDate(iso: string) {
    try {
      return new Date(iso).toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      })
    } catch {
      return iso
    }
  }

  return (
    <div className="px-8 py-8">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-xl font-bold text-ink">Trigger Links</h1>
        <p className="text-sm text-ink3 mt-0.5">
          Trackable short URLs that fire automations on click
        </p>
      </div>

      {/* New link button */}
      <div className="mb-4">
        {!showForm ? (
          <Button
            onClick={() => {
              setForm(DEFAULT_FORM)
              setError(null)
              setShowForm(true)
            }}
            variant="contained"
          >
            + New Trigger Link
          </Button>
        ) : null}
      </div>

      {/* Inline form */}
      {showForm && (
        <div className="mb-6 bg-white rounded-xl border border-border-brand p-6 space-y-4 max-w-2xl">
          <h2 className="text-sm font-semibold text-ink">New Trigger Link</h2>

          {/* Name */}
          <TextField
            label="Name"
            required
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="e.g. Confirm your appointment"
            error={!!error}
            helperText={error}
            fullWidth
            size="small"
          />

          {/* Action */}
          <TextField
            select
            label="Action"
            value={form.action}
            onChange={(e) => setForm({ ...form, action: e.target.value })}
            fullWidth
            size="small"
          >
            {Object.entries(ACTION_LABELS).map(([value, label]) => (
              <MenuItem key={value} value={value}>
                {label}
              </MenuItem>
            ))}
          </TextField>

          {/* Redirect URL */}
          <TextField
            label="Redirect URL (optional)"
            type="url"
            value={form.redirect_url}
            onChange={(e) => setForm({ ...form, redirect_url: e.target.value })}
            placeholder="https://yourbusiness.com/thanks"
            fullWidth
            size="small"
          />

          {/* Webhook URL — only for custom_webhook */}
          {form.action === 'custom_webhook' && (
            <TextField
              label="Webhook URL"
              type="url"
              value={form.webhook_url}
              onChange={(e) => setForm({ ...form, webhook_url: e.target.value })}
              placeholder="https://hooks.example.com/..."
              fullWidth
              size="small"
            />
          )}

          {/* Actions */}
          <div className="flex items-center gap-3 pt-1">
            <Button onClick={() => void handleCreate()} disabled={saving} variant="contained">
              {saving ? 'Saving...' : 'Save'}
            </Button>
            <Button
              onClick={() => {
                setShowForm(false)
                setError(null)
              }}
              disabled={saving}
              color="inherit"
              variant="outlined"
            >
              Cancel
            </Button>
          </div>
        </div>
      )}

      {/* Table */}
      {loading ? (
        <p className="text-sm text-ink4">Loading...</p>
      ) : links.length === 0 ? (
        <div className="bg-white rounded-xl border border-border-brand px-6 py-12 text-center max-w-2xl">
          <p className="text-sm text-ink4">No trigger links yet. Create one above.</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-border-brand overflow-hidden max-w-5xl">
          <table className="w-full text-sm">
            <thead className="border-b border-border-brand bg-bg">
              <tr>
                <th className="text-left py-2 px-4 text-ink3 font-medium">Name</th>
                <th className="text-left py-2 px-4 text-ink3 font-medium">Action</th>
                <th className="text-left py-2 px-4 text-ink3 font-medium">Short URL</th>
                <th className="text-left py-2 px-4 text-ink3 font-medium">Clicks</th>
                <th className="text-left py-2 px-4 text-ink3 font-medium">Created</th>
                <th className="py-2 px-4" />
              </tr>
            </thead>
            <tbody>
              {links.map((link) => (
                <tr key={link.id} className="border-b border-border-brand last:border-0">
                  <td className="py-2 px-4 text-ink font-medium">{link.name}</td>
                  <td className="py-2 px-4 text-ink">
                    {ACTION_LABELS[link.action] ?? link.action}
                  </td>
                  <td className="py-2 px-4 text-ink">
                    <div className="flex items-center min-w-0">
                      <span className="font-mono text-xs text-teal-700 truncate max-w-[220px]">
                        {link.short_url}
                      </span>
                      {link.short_url && <CopyButton url={link.short_url} />}
                    </div>
                  </td>
                  <td className="py-2 px-4 text-ink">{link.click_count ?? 0}</td>
                  <td className="py-2 px-4 text-ink3">{formatDate(link.created_at)}</td>
                  <td className="py-2 px-4 text-right">
                    <Button
                      onClick={() => void handleDelete(link.id, link.name)}
                      size="small"
                      color="error"
                    >
                      Delete
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

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
