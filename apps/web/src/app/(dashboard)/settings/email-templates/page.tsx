'use client'

import { useEffect, useState } from 'react'
import { useSession } from 'next-auth/react'

const VERTICALS = [
  { value: 'dental', label: 'Dental' },
  { value: 'salon', label: 'Salon' },
  { value: 'contractor', label: 'Contractor' },
  { value: 'medspa', label: 'Med Spa' },
  { value: 'fitness', label: 'Fitness' },
  { value: 'auto', label: 'Auto' },
  { value: 'hvac', label: 'HVAC' },
]

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
  const { data: session } = useSession()
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

  const token =
    (session as unknown as Record<string, unknown>)?.accessToken ??
    ((session?.user as Record<string, unknown> | undefined)?.accessToken as string) ??
    ''

  async function fetchTemplates() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/email-templates`, {
        headers: { Authorization: `Bearer ${token}` },
      })
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
    if (token) fetchTemplates()
  }, [token])

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
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(payload),
        })
        if (!res.ok) throw new Error('Failed to update template')
      } else {
        const res = await fetch(`/api/email-templates`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
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
        headers: { Authorization: `Bearer ${token}` },
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
          <h1 className="text-xl font-bold text-gray-900">Email Templates</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Manage reusable email templates for your team
          </p>
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
        <div className="text-sm text-gray-400 py-8 text-center">Loading templates…</div>
      ) : error ? (
        <div className="text-sm text-red-500 py-8 text-center">{error}</div>
      ) : templates.length === 0 ? (
        <div className="rounded-xl border border-gray-100 bg-white px-5 py-10 text-center text-sm text-gray-400">
          No email templates yet. Click <strong>+ Create Template</strong> to add one.
        </div>
      ) : (
        <div className="space-y-3">
          {templates.map((t) => (
            <div
              key={t.id}
              className="rounded-xl border border-gray-100 bg-white px-5 py-4 flex items-start justify-between gap-4"
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2 mb-1">
                  <span className="font-medium text-gray-900 text-sm">{t.name}</span>
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
                <p className="text-xs text-gray-500 truncate">{t.subject}</p>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={() => openEdit(t)}
                  className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 transition-colors"
                >
                  Edit
                </button>
                {deleteConfirm === t.id ? (
                  <div className="flex items-center gap-1">
                    <span className="text-xs text-gray-500">Are you sure?</span>
                    <button
                      onClick={() => handleDelete(t.id)}
                      disabled={deleting}
                      className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50 transition-colors"
                    >
                      {deleting ? 'Deleting…' : 'Yes, delete'}
                    </button>
                    <button
                      onClick={() => setDeleteConfirm(null)}
                      className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setDeleteConfirm(t.id)}
                    disabled={t.is_default}
                    title={t.is_default ? 'Default templates cannot be deleted' : 'Delete template'}
                    className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-full max-w-lg rounded-xl bg-white p-6 shadow-xl mx-4">
            <h2 className="text-base font-semibold text-gray-900 mb-5">
              {editingTemplate ? 'Edit Template' : 'Create Template'}
            </h2>

            <div className="space-y-4">
              {/* Name */}
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Name</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
                  placeholder="e.g. Welcome Email"
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              {/* Subject */}
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Subject</label>
                <input
                  type="text"
                  value={form.subject}
                  onChange={(e) => setForm((prev) => ({ ...prev, subject: e.target.value }))}
                  placeholder="e.g. Welcome to {{business_name}}!"
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              {/* Vertical */}
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Vertical <span className="text-gray-400 font-normal">(optional)</span>
                </label>
                <select
                  value={form.vertical}
                  onChange={(e) => setForm((prev) => ({ ...prev, vertical: e.target.value }))}
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                >
                  <option value="">— Any vertical —</option>
                  {VERTICALS.map((v) => (
                    <option key={v.value} value={v.value}>
                      {v.label}
                    </option>
                  ))}
                </select>
              </div>

              {/* Body */}
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Body</label>

                {/* Merge tag buttons */}
                <div className="flex flex-wrap gap-1 mb-2">
                  {MERGE_TAGS.map((tag) => (
                    <button
                      key={tag}
                      type="button"
                      onClick={() => insertTag(tag)}
                      className="rounded border border-gray-200 bg-gray-50 px-2 py-0.5 text-xs text-gray-600 hover:bg-gray-100 transition-colors font-mono"
                    >
                      {tag}
                    </button>
                  ))}
                </div>

                <textarea
                  rows={8}
                  value={form.body}
                  onChange={(e) => setForm((prev) => ({ ...prev, body: e.target.value }))}
                  placeholder="Write your email body here…"
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                />
              </div>
            </div>

            {/* Actions */}
            <div className="flex justify-end gap-2 mt-5">
              <button
                onClick={closeModal}
                disabled={saving}
                className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={saving || !form.name.trim() || !form.subject.trim() || !form.body.trim()}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
