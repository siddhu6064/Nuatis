'use client'

import { useEffect, useState } from 'react'
import { VERTICALS as VERTICALS_CONFIG } from '@nuatis/shared'
import TextField from '@mui/material/TextField'
import MenuItem from '@mui/material/MenuItem'
import Button from '@mui/material/Button'
import { Modal } from '@/components/ui/Modal'

const VERTICALS = Object.entries(VERTICALS_CONFIG).map(([slug, config]) => ({
  value: slug,
  label: config.label,
}))

const MERGE_TAGS = [
  '{{first_name}}',
  '{{last_name}}',
  '{{full_name}}',
  '{{email}}',
  '{{phone}}',
  '{{business_name}}',
  '{{business_phone}}',
]

interface EmailTemplate {
  id: string
  name: string
  subject: string
  body: string
  vertical: string | null
  is_default: boolean
}

interface FormState {
  name: string
  subject: string
  body: string
  vertical: string
}

const emptyForm: FormState = { name: '', subject: '', body: '', vertical: '' }

export default function EmailTemplatesPage() {
  const [templates, setTemplates] = useState<EmailTemplate[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Modal state
  const [modalOpen, setModalOpen] = useState(false)
  const [editingTemplate, setEditingTemplate] = useState<EmailTemplate | null>(null)
  const [form, setForm] = useState<FormState>(emptyForm)
  const [saving, setSaving] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)

  async function fetchTemplates() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/email-templates`)
      if (!res.ok) throw new Error('Failed to load templates')
      const data = await res.json()
      setTemplates(data)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void fetchTemplates()
  }, [])

  function openCreate() {
    setEditingTemplate(null)
    setForm(emptyForm)
    setModalOpen(true)
  }

  function openEdit(t: EmailTemplate) {
    setEditingTemplate(t)
    setForm({
      name: t.name,
      subject: t.subject,
      body: t.body,
      vertical: t.vertical ?? '',
    })
    setModalOpen(true)
  }

  function closeModal() {
    setModalOpen(false)
    setEditingTemplate(null)
    setForm(emptyForm)
  }

  function insertTag(tag: string) {
    setForm((prev) => ({ ...prev, body: prev.body + tag }))
  }

  async function handleSave() {
    if (!form.name.trim() || !form.subject.trim() || !form.body.trim()) return
    setSaving(true)
    try {
      const payload = {
        name: form.name.trim(),
        subject: form.subject.trim(),
        body: form.body.trim(),
        vertical: form.vertical || null,
      }

      if (editingTemplate) {
        const res = await fetch(`/api/email-templates/${editingTemplate.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
        if (!res.ok) throw new Error('Failed to update template')
      } else {
        const res = await fetch(`/api/email-templates`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
        if (!res.ok) throw new Error('Failed to create template')
      }

      await fetchTemplates()
      closeModal()
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(id: string) {
    setDeleting(true)
    try {
      const res = await fetch(`/api/email-templates/${id}`, {
        method: 'DELETE',
      })
      if (!res.ok) throw new Error('Failed to delete template')
      await fetchTemplates()
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : 'Delete failed')
    } finally {
      setDeleting(false)
      setDeleteConfirm(null)
    }
  }

  return (
    <div className="px-8 py-8 max-w-3xl space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-ink">Email Templates</h1>
          <p className="text-sm text-ink3 mt-0.5">Manage reusable email templates for your team</p>
        </div>
        <button
          onClick={openCreate}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 transition-colors"
        >
          + Create Template
        </button>
      </div>

      {/* Content */}
      {loading ? (
        <div className="text-sm text-ink4 py-8 text-center">Loading templates…</div>
      ) : error ? (
        <div className="text-sm text-red-500 py-8 text-center">{error}</div>
      ) : templates.length === 0 ? (
        <div className="rounded-xl border border-border-brand bg-white px-5 py-10 text-center text-sm text-ink4">
          No email templates yet. Click <strong>+ Create Template</strong> to add one.
        </div>
      ) : (
        <div className="space-y-3">
          {templates.map((t) => (
            <div
              key={t.id}
              className="rounded-xl border border-border-brand bg-white px-5 py-4 flex items-start justify-between gap-4"
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2 mb-1">
                  <span className="font-medium text-ink text-sm">{t.name}</span>
                  {t.vertical && (
                    <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700">
                      {VERTICALS.find((v) => v.value === t.vertical)?.label ?? t.vertical}
                    </span>
                  )}
                  {t.is_default && (
                    <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">
                      Default
                    </span>
                  )}
                </div>
                <p className="text-xs text-ink3 truncate">{t.subject}</p>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={() => openEdit(t)}
                  className="rounded-lg border border-border-brand px-3 py-1.5 text-xs font-medium text-ink2 hover:bg-bg transition-colors"
                >
                  Edit
                </button>
                {deleteConfirm === t.id ? (
                  <div className="flex items-center gap-1">
                    <span className="text-xs text-ink3">Are you sure?</span>
                    <button
                      onClick={() => handleDelete(t.id)}
                      disabled={deleting}
                      className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50 transition-colors"
                    >
                      {deleting ? 'Deleting…' : 'Yes, delete'}
                    </button>
                    <button
                      onClick={() => setDeleteConfirm(null)}
                      className="rounded-lg border border-border-brand px-3 py-1.5 text-xs font-medium text-ink2 hover:bg-bg transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setDeleteConfirm(t.id)}
                    disabled={t.is_default}
                    title={t.is_default ? 'Default templates cannot be deleted' : 'Delete template'}
                    className="rounded-lg border border-border-brand px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    Delete
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create / Edit Modal */}
      {modalOpen && (
        <Modal
          onClose={closeModal}
          title={editingTemplate ? 'Edit Template' : 'Create Template'}
          footer={
            <>
              <Button onClick={closeModal} disabled={saving} variant="outlined" color="inherit">
                Cancel
              </Button>
              <Button
                onClick={handleSave}
                disabled={saving || !form.name.trim() || !form.subject.trim() || !form.body.trim()}
                variant="contained"
              >
                {saving ? 'Saving…' : 'Save'}
              </Button>
            </>
          }
        >
          <div className="space-y-4">
            <TextField
              label="Name"
              value={form.name}
              onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
              placeholder="e.g. Welcome Email"
              fullWidth
              size="small"
            />

            <TextField
              label="Subject"
              value={form.subject}
              onChange={(e) => setForm((prev) => ({ ...prev, subject: e.target.value }))}
              placeholder="e.g. Welcome to {{business_name}}!"
              fullWidth
              size="small"
            />

            <TextField
              select
              label="Vertical (optional)"
              value={form.vertical}
              onChange={(e) => setForm((prev) => ({ ...prev, vertical: e.target.value }))}
              fullWidth
              size="small"
            >
              <MenuItem value="">— Any vertical —</MenuItem>
              {VERTICALS.map((v) => (
                <MenuItem key={v.value} value={v.value}>
                  {v.label}
                </MenuItem>
              ))}
            </TextField>

            <div>
              <label className="block text-xs font-medium text-ink2 mb-1">Body</label>

              {/* Merge tag buttons — plain Tailwind buttons kept as-is, not
                  worth an MUI Button here: they're small inline chips, not
                  a case the earlier button-collision checklist item flags
                  (button has no globals.css rule to collide with). */}
              <div className="flex flex-wrap gap-1 mb-2">
                {MERGE_TAGS.map((tag) => (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => insertTag(tag)}
                    className="rounded border border-border-brand bg-bg px-2 py-0.5 text-xs text-ink3 hover:bg-bg2 transition-colors font-mono"
                  >
                    {tag}
                  </button>
                ))}
              </div>

              <TextField
                multiline
                rows={8}
                value={form.body}
                onChange={(e) => setForm((prev) => ({ ...prev, body: e.target.value }))}
                placeholder="Write your email body here…"
                fullWidth
                size="small"
              />
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}
