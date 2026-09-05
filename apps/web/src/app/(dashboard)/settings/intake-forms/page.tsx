'use client'

import { useState, useEffect, useCallback } from 'react'
import { formatDate } from '@nuatis/shared'
import Button from '@mui/material/Button'
import IconButton from '@mui/material/IconButton'
import TextField from '@mui/material/TextField'
import Checkbox from '@mui/material/Checkbox'
import FormControlLabel from '@mui/material/FormControlLabel'
import Switch from '@mui/material/Switch'
import Chip from '@mui/material/Chip'
import Menu from '@mui/material/Menu'
import MenuItem from '@mui/material/MenuItem'
import Alert from '@mui/material/Alert'
import { Modal } from '@/components/ui/Modal'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type FieldType =
  | 'text'
  | 'email'
  | 'phone'
  | 'textarea'
  | 'select'
  | 'checkbox'
  | 'date'
  | 'number'
  | 'signature'
  | 'file'

type VisibleIfOp = 'eq' | 'neq' | 'exists'

interface VisibleIf {
  fieldId: string
  op: VisibleIfOp
  value?: string
}

interface FormField {
  id: string
  type: FieldType
  label: string
  required: boolean
  placeholder?: string
  options?: string[]
  visibleIf?: VisibleIf | null
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
  { value: 'signature', label: 'Signature' },
  { value: 'file', label: 'File upload' },
]

const PLACEHOLDER_TYPES: FieldType[] = ['text', 'email', 'phone', 'number']

// ---------------------------------------------------------------------------
// Icons (inline SVG — matches this app's existing icon convention; no
// @mui/icons-material dependency in this repo)
// ---------------------------------------------------------------------------

function ChevronUpIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M18 15l-6-6-6 6" />
    </svg>
  )
}

function ChevronDownIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 9l6 6 6-6" />
    </svg>
  )
}

function CloseIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
    </svg>
  )
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function generateFieldId(): string {
  return `field_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
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

function renderSubmissionValue(type: FieldType, val: unknown) {
  if (val === undefined || val === null || val === '') return '—'
  const str = String(val)
  if (type === 'signature' && str.startsWith('data:image')) {
    return (
      <img src={str} alt="Signature" className="h-8 border border-border-brand rounded bg-white" />
    )
  }
  if (type === 'file' && str.startsWith('data:')) {
    return (
      <a href={str} download className="text-teal-600 hover:text-teal-700 underline">
        Download
      </a>
    )
  }
  return str
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

const VISIBLE_IF_OPS: { value: VisibleIfOp; label: string }[] = [
  { value: 'eq', label: 'equals' },
  { value: 'neq', label: 'does not equal' },
  { value: 'exists', label: 'is answered' },
]

function FieldCard({
  field,
  index,
  total,
  otherFields,
  onChange,
  onDelete,
  onMove,
}: {
  field: FormField
  index: number
  total: number
  otherFields: FormField[]
  onChange: (updated: FormField) => void
  onDelete: () => void
  onMove: (dir: 'up' | 'down') => void
}) {
  const showPlaceholder = PLACEHOLDER_TYPES.includes(field.type)
  const showOptions = field.type === 'select'
  const [showCondition, setShowCondition] = useState(!!field.visibleIf)

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
    <div className="bg-bg rounded-lg border border-border-brand p-4 space-y-3">
      {/* Header row */}
      <div className="flex items-center gap-2">
        <Chip
          label={typeLabel}
          size="small"
          sx={{
            bgcolor: '#f0fdfa',
            color: '#0f766e',
            fontWeight: 600,
            fontSize: '10px',
            height: 20,
            flexShrink: 0,
          }}
        />
        <TextField
          value={field.label}
          onChange={(e) => onChange({ ...field, label: e.target.value })}
          placeholder="Field label"
          size="small"
          fullWidth
        />
        <FormControlLabel
          control={
            <Checkbox
              size="small"
              checked={field.required}
              onChange={(e) => onChange({ ...field, required: e.target.checked })}
            />
          }
          label="Required"
          sx={{ mr: 0, flexShrink: 0, '& .MuiFormControlLabel-label': { fontSize: '12px' } }}
        />
        <IconButton
          size="small"
          onClick={() => onMove('up')}
          disabled={index === 0}
          title="Move up"
        >
          <ChevronUpIcon />
        </IconButton>
        <IconButton
          size="small"
          onClick={() => onMove('down')}
          disabled={index === total - 1}
          title="Move down"
        >
          <ChevronDownIcon />
        </IconButton>
        <IconButton size="small" onClick={onDelete} title="Delete field" sx={{ color: '#f87171' }}>
          <CloseIcon />
        </IconButton>
      </div>

      {/* Placeholder */}
      {showPlaceholder && (
        <TextField
          value={field.placeholder ?? ''}
          onChange={(e) => onChange({ ...field, placeholder: e.target.value })}
          placeholder="Placeholder text (optional)"
          size="small"
          fullWidth
        />
      )}

      {/* Options editor for select */}
      {showOptions && (
        <div className="space-y-1.5">
          <p className="text-[10px] font-medium text-ink3 uppercase tracking-wide">Options</p>
          {(field.options ?? []).map((opt, i) => (
            <div key={i} className="flex items-center gap-1.5">
              <TextField
                value={opt}
                onChange={(e) => updateOption(i, e.target.value)}
                placeholder={`Option ${i + 1}`}
                size="small"
                fullWidth
              />
              <IconButton size="small" onClick={() => removeOption(i)} sx={{ color: '#f87171' }}>
                <CloseIcon />
              </IconButton>
            </div>
          ))}
          <Button onClick={addOption} size="small" sx={{ textTransform: 'none' }}>
            + Add Option
          </Button>
        </div>
      )}

      {/* Conditional visibility */}
      <div className="space-y-1.5 pt-1 border-t border-border-brand/50">
        <FormControlLabel
          control={
            <Checkbox
              size="small"
              checked={showCondition}
              onChange={(e) => {
                const checked = e.target.checked
                setShowCondition(checked)
                if (!checked) {
                  onChange({ ...field, visibleIf: null })
                } else if (otherFields[0]) {
                  onChange({
                    ...field,
                    visibleIf: { fieldId: otherFields[0].id, op: 'eq', value: '' },
                  })
                }
              }}
              disabled={otherFields.length === 0}
            />
          }
          label="Show only if..."
          sx={{ mr: 0, '& .MuiFormControlLabel-label': { fontSize: '12px' } }}
        />
        {otherFields.length === 0 && (
          <p className="text-[10px] text-ink3">Add another field first to enable conditions.</p>
        )}
        {showCondition && field.visibleIf && (
          <div className="flex items-center gap-1.5">
            <TextField
              select
              size="small"
              value={field.visibleIf.fieldId}
              onChange={(e) =>
                onChange({
                  ...field,
                  visibleIf: { ...field.visibleIf!, fieldId: e.target.value },
                })
              }
              sx={{ minWidth: 140 }}
            >
              {otherFields.map((f) => (
                <MenuItem key={f.id} value={f.id}>
                  {f.label || '(untitled field)'}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              select
              size="small"
              value={field.visibleIf.op}
              onChange={(e) =>
                onChange({
                  ...field,
                  visibleIf: { ...field.visibleIf!, op: e.target.value as VisibleIfOp },
                })
              }
              sx={{ minWidth: 130 }}
            >
              {VISIBLE_IF_OPS.map((o) => (
                <MenuItem key={o.value} value={o.value}>
                  {o.label}
                </MenuItem>
              ))}
            </TextField>
            {field.visibleIf.op !== 'exists' && (
              <TextField
                value={field.visibleIf.value ?? ''}
                onChange={(e) =>
                  onChange({
                    ...field,
                    visibleIf: { ...field.visibleIf!, value: e.target.value },
                  })
                }
                placeholder="Value"
                size="small"
                fullWidth
              />
            )}
          </div>
        )}
      </div>
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
}: {
  editingForm: IntakeForm | null
  services: Service[]
  onClose: () => void
  onSaved: () => void
}) {
  const [name, setName] = useState(editingForm?.name ?? '')
  const [description, setDescription] = useState(editingForm?.description ?? '')
  const [fields, setFields] = useState<FormField[]>(editingForm?.fields ?? [])
  const [linkedServiceIds, setLinkedServiceIds] = useState<string[]>(
    editingForm?.linkedServiceIds ?? []
  )
  const [isActive, setIsActive] = useState(editingForm?.isActive ?? true)
  const [fieldMenuAnchor, setFieldMenuAnchor] = useState<HTMLElement | null>(null)
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
    setFieldMenuAnchor(null)
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
    <Modal
      onClose={onClose}
      title={editingForm ? 'Edit Form' : 'Create Intake Form'}
      maxWidth="md"
      footer={
        <>
          <Button onClick={onClose} variant="text" color="inherit">
            Cancel
          </Button>
          <Button onClick={() => void save()} disabled={saving} variant="contained">
            {saving ? 'Saving...' : editingForm ? 'Update Form' : 'Create Form'}
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        {/* Name */}
        <TextField
          label="Form Name"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. New Patient Intake"
          fullWidth
          size="small"
          autoFocus
        />

        {/* Description */}
        <TextField
          label="Description (optional)"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Describe when this form is used..."
          fullWidth
          multiline
          rows={2}
          size="small"
        />

        {/* Active toggle (edit only) */}
        {editingForm && (
          <FormControlLabel
            control={<Switch checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />}
            label={isActive ? 'Active' : 'Inactive'}
            sx={{ ml: 0 }}
          />
        )}

        {/* Fields */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-xs font-medium text-ink2">Fields ({fields.length})</label>
            <Button
              size="small"
              variant="outlined"
              onClick={(e) => setFieldMenuAnchor(e.currentTarget)}
              sx={{ textTransform: 'none' }}
            >
              + Add Field
            </Button>
            <Menu
              anchorEl={fieldMenuAnchor}
              open={Boolean(fieldMenuAnchor)}
              onClose={() => setFieldMenuAnchor(null)}
            >
              {FIELD_TYPES.map((ft) => (
                <MenuItem key={ft.value} onClick={() => addField(ft.value)}>
                  {ft.label}
                </MenuItem>
              ))}
            </Menu>
          </div>

          {fields.length === 0 ? (
            <div className="border-2 border-dashed border-border-brand rounded-lg py-6 text-center">
              <p className="text-xs text-ink4">
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
                  otherFields={fields.filter((f) => f.id !== field.id)}
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
          <label className="block text-xs font-medium text-ink2 mb-2">
            Link to Services ({linkedServiceIds.length} selected)
          </label>
          {services.length === 0 ? (
            <p className="text-xs text-ink4">No services found</p>
          ) : (
            <div className="border border-border-brand rounded-lg max-h-40 overflow-y-auto divide-y divide-gray-50">
              {services.map((svc) => (
                <FormControlLabel
                  key={svc.id}
                  className="w-full"
                  sx={{ mx: 0, px: 1.5, py: 0.5, width: '100%' }}
                  control={
                    <Checkbox
                      size="small"
                      checked={linkedServiceIds.includes(svc.id)}
                      onChange={() => toggleService(svc.id)}
                    />
                  }
                  label={<span className="text-ink2 text-xs">{svc.name}</span>}
                />
              ))}
            </div>
          )}
        </div>

        {error && <Alert severity="error">{error}</Alert>}
      </div>
    </Modal>
  )
}

// ---------------------------------------------------------------------------
// Submissions Panel
// ---------------------------------------------------------------------------

function SubmissionsPanel({ form, onClose }: { form: IntakeForm; onClose: () => void }) {
  const [submissions, setSubmissions] = useState<Submission[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch(`/api/intake-forms/${form.id}/submissions`)
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
  }, [form.id])

  // Show up to 5 key fields in the table
  const keyFields = form.fields.slice(0, 5)

  return (
    <div className="bg-white rounded-xl border border-border-brand p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-ink">Submissions — {form.name}</h3>
          <p className="text-xs text-ink4 mt-0.5">{submissions.length} total</p>
        </div>
        <div className="flex items-center gap-2">
          {submissions.length > 0 && (
            <Button
              onClick={() => exportCsv(form, submissions)}
              size="small"
              variant="outlined"
              sx={{ textTransform: 'none' }}
            >
              Export CSV
            </Button>
          )}
          <Button onClick={onClose} size="small" color="inherit" sx={{ textTransform: 'none' }}>
            Close
          </Button>
        </div>
      </div>

      {loading ? (
        <p className="text-xs text-ink4 py-4">Loading submissions...</p>
      ) : submissions.length === 0 ? (
        <div className="py-8 text-center">
          <p className="text-sm text-ink4">No submissions yet</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border-brand">
                <th className="text-left py-2 pr-4 text-ink3 font-medium whitespace-nowrap">
                  Submitted At
                </th>
                <th className="text-left py-2 pr-4 text-ink3 font-medium whitespace-nowrap">
                  Contact
                </th>
                {keyFields.map((f) => (
                  <th
                    key={f.id}
                    className="text-left py-2 pr-4 text-ink3 font-medium whitespace-nowrap"
                  >
                    {f.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {submissions.map((sub) => (
                <tr key={sub.id} className="hover:bg-bg">
                  <td className="py-2 pr-4 text-ink3 whitespace-nowrap">
                    {formatDate(sub.submitted_at)}
                  </td>
                  <td className="py-2 pr-4 text-ink2 font-medium whitespace-nowrap">
                    {sub.contactName || '—'}
                  </td>
                  {keyFields.map((f) => {
                    const val = sub.data[f.id] ?? sub.data[f.label]
                    return (
                      <td key={f.id} className="py-2 pr-4 text-ink3 max-w-[160px] truncate">
                        {renderSubmissionValue(f.type, val)}
                      </td>
                    )
                  })}
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
    const res = await fetch(`/api/intake-forms`)
    if (res.ok) {
      const data = await res.json()
      setForms(Array.isArray(data) ? data : ((data as { data?: IntakeForm[] }).data ?? []))
    }
  }, [])

  useEffect(() => {
    Promise.all([
      fetch(`/api/intake-forms`).then((r) => (r.ok ? r.json() : { data: [] })),
      fetch(`/api/settings/booking`).then((r) => (r.ok ? r.json() : { availableServices: [] })),
    ])
      .then(([formsData, bookingData]) => {
        const formsArr = Array.isArray(formsData)
          ? formsData
          : ((formsData as { data?: IntakeForm[] }).data ?? [])
        setForms(formsArr)
        const svcs: Service[] =
          (bookingData as { availableServices?: Service[] }).availableServices ?? []
        setServices(svcs)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

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
        <p className="text-sm text-ink4">Loading intake forms...</p>
      </div>
    )
  }

  return (
    <div className="px-8 py-8 max-w-3xl space-y-6">
      {/* Page header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold text-ink">Intake Forms</h1>
          <p className="text-sm text-ink3 mt-0.5">
            Build custom forms to collect client information before appointments
          </p>
        </div>
        <Button onClick={openCreate} variant="contained" sx={{ textTransform: 'none' }}>
          + Create Form
        </Button>
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
        <div className="bg-white rounded-xl border border-border-brand p-12 text-center">
          <p className="text-sm text-ink4">No intake forms yet</p>
          <p className="text-xs text-gray-300 mt-1">
            Create your first form to start collecting client information
          </p>
          <Button onClick={openCreate} variant="contained" sx={{ textTransform: 'none', mt: 2 }}>
            + Create Form
          </Button>
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
                    : 'border-border-brand hover:border-border-brand'
                }`}
              >
                <div className="flex items-start justify-between gap-4">
                  {/* Left: info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="text-sm font-semibold text-ink">{form.name}</h3>
                      <Chip
                        label={form.isActive ? 'Active' : 'Inactive'}
                        size="small"
                        sx={{
                          height: 18,
                          fontSize: '10px',
                          fontWeight: 600,
                          bgcolor: form.isActive ? '#f0fdf4' : '#f2f0eb',
                          color: form.isActive ? '#15803d' : '#7a7468',
                        }}
                      />
                    </div>
                    {form.description && (
                      <p className="text-xs text-ink4 mt-0.5 line-clamp-1">{form.description}</p>
                    )}
                    <div className="flex items-center gap-3 mt-2 text-xs text-ink4">
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
                    <Button
                      onClick={() =>
                        setViewingSubmissionsFor(
                          viewingSubmissionsFor?.id === form.id ? null : form
                        )
                      }
                      size="small"
                      variant={viewingSubmissionsFor?.id === form.id ? 'outlined' : 'text'}
                      color={viewingSubmissionsFor?.id === form.id ? 'primary' : 'inherit'}
                      sx={{ textTransform: 'none' }}
                    >
                      {viewingSubmissionsFor?.id === form.id ? 'Hide' : 'Submissions'}
                    </Button>
                    <Button
                      onClick={() => openEdit(form)}
                      size="small"
                      color="inherit"
                      sx={{ textTransform: 'none' }}
                    >
                      Edit
                    </Button>
                    <Button
                      onClick={() => void deleteForm(form)}
                      size="small"
                      color="error"
                      sx={{ textTransform: 'none' }}
                    >
                      Delete
                    </Button>
                  </div>
                </div>
              </div>

              {/* Inline submissions panel */}
              {viewingSubmissionsFor?.id === form.id && (
                <div className="mt-2">
                  <SubmissionsPanel form={form} onClose={() => setViewingSubmissionsFor(null)} />
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
          onSaved={() => void handleSaved()}
        />
      )}
    </div>
  )
}
