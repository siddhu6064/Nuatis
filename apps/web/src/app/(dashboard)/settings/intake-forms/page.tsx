'use client'

import { useState, useEffect, useCallback } from 'react'
import { useSession } from 'next-auth/react'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type FieldType = 'text' | 'email' | 'phone' | 'textarea' | 'select' | 'checkbox' | 'date' | 'number'

interface FormField {
  id: string
  type: FieldType
  label: string
  required: boolean
  placeholder?: string
  options?: string[]
}

interface IntakeForm {
  id: string
  name: string
  description: string | null
  fields: FormField[]
  linkedServiceIds: string[]
  isActive: boolean
  fieldCount: number
  submissionCount: number
  linkedServicesCount: number
}

interface Submission {
  id: string
  submitted_at: string
  contactName: string
  data: Record<string, unknown>
}

interface Service {
  id: string
  name: string
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const FIELD_TYPES: { value: FieldType; label: string }[] = [
  { value: 'text', label: 'Text' },
  { value: 'email', label: 'Email' },
  { value: 'phone', label: 'Phone' },
  { value: 'textarea', label: 'Textarea' },
  { value: 'select', label: 'Select (dropdown)' },
  { value: 'checkbox', label: 'Checkbox' },
  { value: 'date', label: 'Date' },
  { value: 'number', label: 'Number' },
]

const PLACEHOLDER_TYPES: FieldType[] = ['text', 'email', 'phone', 'number']

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function generateFieldId(): string {
  return `field_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString()
  } catch {
    return iso
  }
}

function exportCsv(form: IntakeForm, submissions: Submission[]) {
  if (submissions.length === 0) return

  const fieldLabels = form.fields.map((f) => f.label)
  const headers = ['Submitted At', 'Contact Name', ...fieldLabels]

  const rows = submissions.map((sub) => {
    const values = form.fields.map((f) => {
      const val = sub.data[f.id] ?? sub.data[f.label] ?? ''
      return String(val).replace(/"/g, '""')
    })
    return [formatDate(sub.submitted_at), sub.contactName, ...values]
  })

  const csv = [headers, ...rows].map((row) => row.map((cell) => `"${cell}"`).join(',')).join('\n')

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${form.name.replace(/\s+/g, '_')}_submissions.csv`
  a.click()
  URL.revokeObjectURL(url)
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function FieldCard({
  field,
  index,
  total,
  onChange,
  onDelete,
  onMove,
}: {
  field: FormField
  index: number
  total: number
  onChange: (updated: FormField) => void
  onDelete: () => void
  onMove: (dir: 'up' | 'down') => void
}) {
  const showPlaceholder = PLACEHOLDER_TYPES.includes(field.type)
  const showOptions = field.type === 'select'

  function updateOption(idx: number, value: string) {
    const opts = [...(field.options ?? [])]
    opts[idx] = value
    onChange({ ...field, options: opts })
  }

  function addOption() {
    onChange({ ...field, options: [...(field.options ?? []), ''] })
  }

  function removeOption(idx: number) {
    const opts = (field.options ?? []).filter((_, i) => i !== idx)
    onChange({ ...field, options: opts })
  }

  const typeLabel = FIELD_TYPES.find((t) => t.value === field.type)?.label ?? field.type

  return (
    <div className="bg-gray-50 rounded-lg border border-gray-200 p-4 space-y-3">
      {/* Header row */}
      <div className="flex items-center gap-2">
        <span className="text-[10px] font-medium bg-teal-50 text-teal-700 px-2 py-0.5 rounded shrink-0">
          {typeLabel}
        </span>
        <input
          type="text"
          value={field.label}
          onChange={(e) => onChange({ ...field, label: e.target.value })}
          placeholder="Field label"
          className="flex-1 px-2 py-1 text-sm border border-gray-200 rounded focus:outline-none focus:ring-2 focus:ring-teal-500"
        />
        <label className="flex items-center gap-1 text-xs text-gray-500 shrink-0 cursor-pointer">
          <input
            type="checkbox"
            checked={field.required}
            onChange={(e) => onChange({ ...field, required: e.target.checked })}
            className="rounded border-gray-300 text-teal-600 focus:ring-teal-500"
          />
          Required
        </label>
        <button
          onClick={() => onMove('up')}
          disabled={index === 0}
          title="Move up"
          className="text-gray-400 hover:text-gray-700 disabled:opacity-30 text-xs p-0.5"
        >
          ▲
        </button>
        <button
          onClick={() => onMove('down')}
          disabled={index === total - 1}
          title="Move down"
          className="text-gray-400 hover:text-gray-700 disabled:opacity-30 text-xs p-0.5"
        >
          ▼
        </button>
        <button
          onClick={onDelete}
          title="Delete field"
          className="text-red-400 hover:text-red-600 text-xs px-1"
        >
          ✕
        </button>
      </div>

      {/* Placeholder */}
      {showPlaceholder && (
        <input
          type="text"
          value={field.placeholder ?? ''}
          onChange={(e) => onChange({ ...field, placeholder: e.target.value })}
          placeholder="Placeholder text (optional)"
          className="w-full px-2 py-1 text-xs border border-gray-200 rounded focus:outline-none focus:ring-2 focus:ring-teal-500"
        />
      )}

      {/* Options editor for select */}
      {showOptions && (
        <div className="space-y-1.5">
          <p className="text-[10px] font-medium text-gray-500 uppercase tracking-wide">Options</p>
          {(field.options ?? []).map((opt, i) => (
            <div key={i} className="flex items-center gap-1.5">
              <input
                type="text"
                value={opt}
                onChange={(e) => updateOption(i, e.target.value)}
                placeholder={`Option ${i + 1}`}
                className="flex-1 px-2 py-1 text-xs border border-gray-200 rounded focus:outline-none focus:ring-2 focus:ring-teal-500"
              />
              <button
                onClick={() => removeOption(i)}
                className="text-red-400 hover:text-red-600 text-xs"
              >
                ✕
              </button>
            </div>
          ))}
          <button
            onClick={addOption}
            className="text-xs text-teal-600 hover:text-teal-700 font-medium"
          >
            + Add Option
          </button>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Form Builder Modal
// ---------------------------------------------------------------------------

function FormBuilderModal({
  editingForm,
  services,
  onClose,
  onSaved,
  token,
}: {
  editingForm: IntakeForm | null
  services: Service[]
  onClose: () => void
  onSaved: () => void
  token: string
}) {
  const [name, setName] = useState(editingForm?.name ?? '')
  const [description, setDescription] = useState(editingForm?.description ?? '')
  const [fields, setFields] = useState<FormField[]>(editingForm?.fields ?? [])
  const [linkedServiceIds, setLinkedServiceIds] = useState<string[]>(
    editingForm?.linkedServiceIds ?? []
  )
  const [isActive, setIsActive] = useState(editingForm?.isActive ?? true)
  const [showFieldTypeMenu, setShowFieldTypeMenu] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function addField(type: FieldType) {
    const newField: FormField = {
      id: generateFieldId(),
      type,
      label: FIELD_TYPES.find((t) => t.value === type)?.label ?? type,
      required: false,
      placeholder: PLACEHOLDER_TYPES.includes(type) ? '' : undefined,
      options: type === 'select' ? [] : undefined,
    }
    setFields((prev) => [...prev, newField])
    setShowFieldTypeMenu(false)
  }

  function updateField(index: number, updated: FormField) {
    setFields((prev) => prev.map((f, i) => (i === index ? updated : f)))
  }

  function deleteField(index: number) {
    setFields((prev) => prev.filter((_, i) => i !== index))
  }

  function moveField(index: number, dir: 'up' | 'down') {
    setFields((prev) => {
      const next = [...prev]
      const swapIdx = dir === 'up' ? index - 1 : index + 1
      if (swapIdx < 0 || swapIdx >= next.length) return prev
      const tmp = next[index]!
      next[index] = next[swapIdx]!
      next[swapIdx] = tmp
      return next
    })
  }

  function toggleService(id: string) {
    setLinkedServiceIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    )
  }

  async function save() {
    if (!name.trim()) {
      setError('Form name is required')
      return
    }
    setSaving(true)
    setError(null)

    const body = {
      name: name.trim(),
      description: description.trim() || null,
      fields,
      linkedServiceIds,
      ...(editingForm ? { isActive } : {}),
    }

    const url = editingForm ? `/api/intake-forms/${editingForm.id}` : `/api/intake-forms`
    const method = editingForm ? 'PUT' : 'POST'

    try {
      const res = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
      })

      if (res.ok) {
        onSaved()
      } else {
        const d = await res.json().catch(() => ({}))
        setError((d as { error?: string }).error || 'Failed to save')
      }
    } catch {
      setError('Failed to save form')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center overflow-y-auto pt-16 pb-16">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl mx-4">
        {/* Modal header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="text-sm font-semibold text-gray-900">
            {editingForm ? 'Edit Form' : 'Create Intake Form'}
          </h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-lg leading-none"
          >
            ✕
          </button>
        </div>

        <div className="px-6 py-5 space-y-5">
          {/* Name */}
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Form Name *</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. New Patient Intake"
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500"
              autoFocus
            />
          </div>

          {/* Description */}
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">
              Description (optional)
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              placeholder="Describe when this form is used..."
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500 resize-none"
            />
          </div>

          {/* Active toggle (edit only) */}
          {editingForm && (
            <div className="flex items-center gap-3">
              <label className="text-xs font-medium text-gray-700">Status</label>
              <button
                onClick={() => setIsActive((v) => !v)}
                className={`relative w-9 h-5 rounded-full transition-colors ${isActive ? 'bg-teal-600' : 'bg-gray-300'}`}
              >
                <span
                  className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${isActive ? 'translate-x-4' : 'translate-x-0.5'}`}
                />
              </button>
              <span className="text-xs text-gray-500">{isActive ? 'Active' : 'Inactive'}</span>
            </div>
          )}

          {/* Fields */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-medium text-gray-700">Fields ({fields.length})</label>
              <div className="relative">
                <button
                  onClick={() => setShowFieldTypeMenu((v) => !v)}
                  className="text-xs text-teal-600 hover:text-teal-700 font-medium border border-teal-200 rounded px-2 py-1"
                >
                  + Add Field
                </button>
                {showFieldTypeMenu && (
                  <div className="absolute right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-10 w-48 py-1">
                    {FIELD_TYPES.map((ft) => (
                      <button
                        key={ft.value}
                        onClick={() => addField(ft.value)}
                        className="w-full text-left px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50"
                      >
                        {ft.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {fields.length === 0 ? (
              <div className="border-2 border-dashed border-gray-200 rounded-lg py-6 text-center">
                <p className="text-xs text-gray-400">
                  No fields yet — click &ldquo;+ Add Field&rdquo; to start
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {fields.map((field, i) => (
                  <FieldCard
                    key={field.id}
                    field={field}
                    index={i}
                    total={fields.length}
                    onChange={(updated) => updateField(i, updated)}
                    onDelete={() => deleteField(i)}
                    onMove={(dir) => moveField(i, dir)}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Link to services */}
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-2">
              Link to Services ({linkedServiceIds.length} selected)
            </label>
            {services.length === 0 ? (
              <p className="text-xs text-gray-400">No services found</p>
            ) : (
              <div className="border border-gray-200 rounded-lg max-h-40 overflow-y-auto divide-y divide-gray-50">
                {services.map((svc) => (
                  <label
                    key={svc.id}
                    className="flex items-center gap-2 px-3 py-2 text-sm cursor-pointer hover:bg-gray-50"
                  >
                    <input
                      type="checkbox"
                      checked={linkedServiceIds.includes(svc.id)}
                      onChange={() => toggleService(svc.id)}
                      className="rounded border-gray-300 text-teal-600 focus:ring-teal-500"
                    />
                    <span className="text-gray-700 text-xs">{svc.name}</span>
                  </label>
                ))}
              </div>
            )}
          </div>

          {error && <p className="text-xs text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-gray-100">
          <button
            onClick={onClose}
            className="text-xs text-gray-500 px-3 py-1.5 rounded-lg hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            onClick={save}
            disabled={saving}
            className="text-xs text-white bg-teal-600 hover:bg-teal-700 px-4 py-2 rounded-lg font-medium disabled:opacity-50"
          >
            {saving ? 'Saving...' : editingForm ? 'Update Form' : 'Create Form'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Submissions Panel
// ---------------------------------------------------------------------------

function SubmissionsPanel({
  form,
  token,
  onClose,
}: {
  form: IntakeForm
  token: string
  onClose: () => void
}) {
  const [submissions, setSubmissions] = useState<Submission[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch(`/api/intake-forms/${form.id}/submissions`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => (r.ok ? r.json() : { submissions: [] }))
      .then((data: { submissions?: Submission[] } | Submission[]) => {
        if (Array.isArray(data)) {
          setSubmissions(data)
        } else {
          setSubmissions((data as { submissions?: Submission[] }).submissions ?? [])
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [form.id, token])

  // Show up to 5 key fields in the table
  const keyFields = form.fields.slice(0, 5)

  return (
    <div className="bg-white rounded-xl border border-gray-100 p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-gray-900">Submissions — {form.name}</h3>
          <p className="text-xs text-gray-400 mt-0.5">{submissions.length} total</p>
        </div>
        <div className="flex items-center gap-2">
          {submissions.length > 0 && (
            <button
              onClick={() => exportCsv(form, submissions)}
              className="text-xs text-gray-500 hover:text-gray-700 border border-gray-200 rounded px-2.5 py-1.5 font-medium"
            >
              Export CSV
            </button>
          )}
          <button onClick={onClose} className="text-xs text-gray-400 hover:text-gray-600 px-2 py-1">
            ✕ Close
          </button>
        </div>
      </div>

      {loading ? (
        <p className="text-xs text-gray-400 py-4">Loading submissions...</p>
      ) : submissions.length === 0 ? (
        <div className="py-8 text-center">
          <p className="text-sm text-gray-400">No submissions yet</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="text-left py-2 pr-4 text-gray-500 font-medium whitespace-nowrap">
                  Submitted At
                </th>
                <th className="text-left py-2 pr-4 text-gray-500 font-medium whitespace-nowrap">
                  Contact
                </th>
                {keyFields.map((f) => (
                  <th
                    key={f.id}
                    className="text-left py-2 pr-4 text-gray-500 font-medium whitespace-nowrap"
                  >
                    {f.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {submissions.map((sub) => (
                <tr key={sub.id} className="hover:bg-gray-50">
                  <td className="py-2 pr-4 text-gray-600 whitespace-nowrap">
                    {formatDate(sub.submitted_at)}
                  </td>
                  <td className="py-2 pr-4 text-gray-700 font-medium whitespace-nowrap">
                    {sub.contactName || '—'}
                  </td>
                  {keyFields.map((f) => (
                    <td key={f.id} className="py-2 pr-4 text-gray-600 max-w-[160px] truncate">
                      {String(sub.data[f.id] ?? sub.data[f.label] ?? '—')}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function IntakeFormsPage() {
  const { data: session } = useSession()
  const token = ((session as unknown as Record<string, unknown>)?.accessToken ?? '') as string

  const [forms, setForms] = useState<IntakeForm[]>([])
  const [loading, setLoading] = useState(true)
  const [services, setServices] = useState<Service[]>([])
  const [showBuilder, setShowBuilder] = useState(false)
  const [editingForm, setEditingForm] = useState<IntakeForm | null>(null)
  const [viewingSubmissionsFor, setViewingSubmissionsFor] = useState<IntakeForm | null>(null)
  const [toast, setToast] = useState<{ type: 'success' | 'error'; msg: string } | null>(null)

  function showToast(type: 'success' | 'error', msg: string) {
    setToast({ type, msg })
    setTimeout(() => setToast(null), 3500)
  }

  const fetchForms = useCallback(async () => {
    const res = await fetch(`/api/intake-forms`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (res.ok) {
      const data = await res.json()
      setForms(Array.isArray(data) ? data : ((data as { forms?: IntakeForm[] }).forms ?? []))
    }
  }, [token])

  useEffect(() => {
    if (!token) return
    Promise.all([
      fetch(`/api/intake-forms`, {
        headers: { Authorization: `Bearer ${token}` },
      }).then((r) => (r.ok ? r.json() : { forms: [] })),
      fetch(`/api/settings/booking`, {
        headers: { Authorization: `Bearer ${token}` },
      }).then((r) => (r.ok ? r.json() : { services: [] })),
    ])
      .then(([formsData, bookingData]) => {
        const formsArr = Array.isArray(formsData)
          ? formsData
          : ((formsData as { forms?: IntakeForm[] }).forms ?? [])
        setForms(formsArr)
        const svcs: Service[] = (bookingData as { services?: Service[] }).services ?? []
        setServices(svcs)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [token])

  function openCreate() {
    setEditingForm(null)
    setShowBuilder(true)
  }

  function openEdit(form: IntakeForm) {
    setEditingForm(form)
    setShowBuilder(true)
  }

  async function deleteForm(form: IntakeForm) {
    if (
      !confirm(
        `Delete "${form.name}"? This cannot be undone.${form.submissionCount > 0 ? ` This form has ${form.submissionCount} submission(s) and cannot be deleted.` : ''}`
      )
    )
      return

    const res = await fetch(`/api/intake-forms/${form.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    })

    if (res.ok) {
      showToast('success', 'Form deleted')
      await fetchForms()
      if (viewingSubmissionsFor?.id === form.id) setViewingSubmissionsFor(null)
    } else {
      const d = await res.json().catch(() => ({}))
      showToast('error', (d as { error?: string }).error || 'Failed to delete form')
    }
  }

  async function handleSaved() {
    setShowBuilder(false)
    setEditingForm(null)
    showToast('success', editingForm ? 'Form updated' : 'Form created')
    await fetchForms()
  }

  if (loading) {
    return (
      <div className="px-8 py-8 max-w-3xl">
        <p className="text-sm text-gray-400">Loading intake forms...</p>
      </div>
    )
  }

  return (
    <div className="px-8 py-8 max-w-3xl space-y-6">
      {/* Page header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Intake Forms</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Build custom forms to collect client information before appointments
          </p>
        </div>
        <button
          onClick={openCreate}
          className="px-4 py-2 bg-teal-600 text-white text-sm font-medium rounded-lg hover:bg-teal-700 transition-colors"
        >
          + Create Form
        </button>
      </div>

      {/* Toast */}
      {toast && (
        <p
          className={`text-sm px-3 py-2 rounded-lg ${toast.type === 'success' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-600'}`}
        >
          {toast.msg}
        </p>
      )}

      {/* Forms list */}
      {forms.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-100 p-12 text-center">
          <p className="text-sm text-gray-400">No intake forms yet</p>
          <p className="text-xs text-gray-300 mt-1">
            Create your first form to start collecting client information
          </p>
          <button
            onClick={openCreate}
            className="mt-4 px-4 py-2 bg-teal-600 text-white text-sm font-medium rounded-lg hover:bg-teal-700 transition-colors"
          >
            + Create Form
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {forms.map((form) => (
            <div key={form.id}>
              {/* Form card */}
              <div
                className={`bg-white rounded-xl border p-5 transition-colors ${
                  viewingSubmissionsFor?.id === form.id
                    ? 'border-teal-200'
                    : 'border-gray-100 hover:border-gray-200'
                }`}
              >
                <div className="flex items-start justify-between gap-4">
                  {/* Left: info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="text-sm font-semibold text-gray-900">{form.name}</h3>
                      <span
                        className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${
                          form.isActive ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-500'
                        }`}
                      >
                        {form.isActive ? 'Active' : 'Inactive'}
                      </span>
                    </div>
                    {form.description && (
                      <p className="text-xs text-gray-400 mt-0.5 line-clamp-1">
                        {form.description}
                      </p>
                    )}
                    <div className="flex items-center gap-3 mt-2 text-xs text-gray-400">
                      <span>{form.fieldCount ?? form.fields?.length ?? 0} fields</span>
                      <span>&middot;</span>
                      <span>{form.submissionCount ?? 0} submissions</span>
                      {(form.linkedServicesCount ?? form.linkedServiceIds?.length ?? 0) > 0 && (
                        <>
                          <span>&middot;</span>
                          <span>
                            {form.linkedServicesCount ?? form.linkedServiceIds?.length ?? 0} linked{' '}
                            {(form.linkedServicesCount ?? form.linkedServiceIds?.length ?? 0) === 1
                              ? 'service'
                              : 'services'}
                          </span>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Right: actions */}
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() =>
                        setViewingSubmissionsFor(
                          viewingSubmissionsFor?.id === form.id ? null : form
                        )
                      }
                      className={`text-xs px-2.5 py-1.5 rounded font-medium border transition-colors ${
                        viewingSubmissionsFor?.id === form.id
                          ? 'bg-teal-50 text-teal-700 border-teal-200'
                          : 'text-gray-500 border-gray-200 hover:border-gray-300 hover:text-gray-700'
                      }`}
                    >
                      {viewingSubmissionsFor?.id === form.id ? 'Hide' : 'Submissions'}
                    </button>
                    <button
                      onClick={() => openEdit(form)}
                      className="text-xs text-gray-500 hover:text-gray-700 px-2 py-1"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => deleteForm(form)}
                      className="text-xs text-red-400 hover:text-red-600 px-2 py-1"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </div>

              {/* Inline submissions panel */}
              {viewingSubmissionsFor?.id === form.id && (
                <div className="mt-2">
                  <SubmissionsPanel
                    form={form}
                    token={token}
                    onClose={() => setViewingSubmissionsFor(null)}
                  />
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Form Builder Modal */}
      {showBuilder && (
        <FormBuilderModal
          editingForm={editingForm}
          services={services}
          onClose={() => {
            setShowBuilder(false)
            setEditingForm(null)
          }}
          onSaved={handleSaved}
          token={token}
        />
      )}
    </div>
  )
}
