'use client'

import { useState, useEffect, useCallback } from 'react'
import Button from '@mui/material/Button'
import TextField from '@mui/material/TextField'
import MenuItem from '@mui/material/MenuItem'
import Checkbox from '@mui/material/Checkbox'
import FormControlLabel from '@mui/material/FormControlLabel'
import { Modal } from '@/components/ui/Modal'

const FIELD_TYPES = ['text', 'textarea', 'number', 'date', 'select', 'boolean'] as const
type FieldType = (typeof FIELD_TYPES)[number]

const TYPE_LABEL: Record<FieldType, string> = {
  text: 'Text',
  textarea: 'Long text',
  number: 'Number',
  date: 'Date',
  select: 'Dropdown',
  boolean: 'Yes/No',
}

interface FieldDef {
  key: string
  label: string
  type: FieldType
  required: boolean
  options?: string[]
}

interface FieldForm {
  key: string
  label: string
  type: FieldType
  required: boolean
  optionsText: string
}

const EMPTY_FORM: FieldForm = { key: '', label: '', type: 'text', required: false, optionsText: '' }

function toKeySuggestion(label: string): string {
  return label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/^(\d)/, 'f_$1')
}

export default function CustomFieldsSettingsPage() {
  const [fields, setFields] = useState<FieldDef[]>([])
  const [loading, setLoading] = useState(true)
  const [toast, setToast] = useState<{ type: 'success' | 'error'; msg: string } | null>(null)

  const [showAddModal, setShowAddModal] = useState(false)
  const [addForm, setAddForm] = useState<FieldForm>(EMPTY_FORM)
  const [addKeyTouched, setAddKeyTouched] = useState(false)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')

  const [editingKey, setEditingKey] = useState<string | null>(null)
  const [editForm, setEditForm] = useState<FieldForm>(EMPTY_FORM)

  function showToast(type: 'success' | 'error', msg: string) {
    setToast({ type, msg })
    setTimeout(() => setToast(null), 3500)
  }

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/settings/custom-fields', { credentials: 'include' })
      if (res.ok) {
        const data = (await res.json()) as { fields: FieldDef[] }
        setFields(data.fields ?? [])
      }
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  function openAddModal() {
    setAddForm(EMPTY_FORM)
    setAddKeyTouched(false)
    setFormError('')
    setShowAddModal(true)
  }

  function formToPayload(f: FieldForm): Record<string, unknown> {
    return {
      label: f.label.trim(),
      type: f.type,
      required: f.required,
      ...(f.type === 'select'
        ? {
            options: f.optionsText
              .split(',')
              .map((o) => o.trim())
              .filter(Boolean),
          }
        : {}),
    }
  }

  async function addField() {
    if (!addForm.label.trim()) {
      setFormError('Label is required')
      return
    }
    if (!addForm.key.trim()) {
      setFormError('Key is required')
      return
    }
    setSaving(true)
    setFormError('')
    try {
      const res = await fetch('/api/settings/custom-fields', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: addForm.key.trim(), ...formToPayload(addForm) }),
      })
      if (!res.ok) {
        const d = (await res.json().catch(() => ({}))) as { error?: string }
        setFormError(d.error ?? 'Failed to add field')
        return
      }
      setShowAddModal(false)
      await load()
      showToast('success', 'Field added')
    } finally {
      setSaving(false)
    }
  }

  function startEdit(f: FieldDef) {
    setEditingKey(f.key)
    setEditForm({
      key: f.key,
      label: f.label,
      type: f.type,
      required: f.required,
      optionsText: (f.options ?? []).join(', '),
    })
    setFormError('')
  }

  async function saveEdit() {
    if (!editingKey) return
    if (!editForm.label.trim()) {
      setFormError('Label is required')
      return
    }
    setSaving(true)
    setFormError('')
    try {
      const res = await fetch(`/api/settings/custom-fields/${editingKey}`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formToPayload(editForm)),
      })
      if (!res.ok) {
        const d = (await res.json().catch(() => ({}))) as { error?: string }
        setFormError(d.error ?? 'Failed to save field')
        return
      }
      setEditingKey(null)
      await load()
      showToast('success', 'Field updated')
    } finally {
      setSaving(false)
    }
  }

  async function deleteField(f: FieldDef) {
    if (!confirm(`Remove "${f.label}"? Existing data under this field is kept, just hidden.`))
      return
    const res = await fetch(`/api/settings/custom-fields/${f.key}`, {
      method: 'DELETE',
      credentials: 'include',
    })
    if (res.ok) {
      setFields((prev) => prev.filter((x) => x.key !== f.key))
      showToast('success', 'Field removed')
    } else {
      const d = (await res.json().catch(() => ({}))) as { error?: string }
      showToast('error', d.error ?? 'Failed to remove field')
    }
  }

  async function move(index: number, dir: -1 | 1) {
    const next = [...fields]
    const target = index + dir
    if (target < 0 || target >= next.length) return
    ;[next[index], next[target]] = [next[target]!, next[index]!]
    setFields(next)

    const res = await fetch('/api/settings/custom-fields/reorder', {
      method: 'PUT',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ keys: next.map((f) => f.key) }),
    })
    if (!res.ok) {
      showToast('error', 'Failed to save order')
      await load()
    }
  }

  return (
    <div className="px-8 py-8 max-w-2xl space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-ink mb-1">Custom Fields</h1>
          <p className="text-sm text-ink3">
            Define the extra fields shown on every contact&apos;s detail page.
          </p>
        </div>
        <Button onClick={openAddModal} variant="contained" sx={{ flexShrink: 0 }}>
          + Add Field
        </Button>
      </div>

      {toast && (
        <div
          className={`fixed bottom-6 right-6 z-50 px-4 py-3 rounded-xl shadow-lg text-sm font-medium ${
            toast.type === 'success'
              ? 'bg-teal-600 text-white'
              : 'bg-red-50 text-red-700 border border-red-200'
          }`}
        >
          {toast.msg}
        </div>
      )}

      {loading ? (
        <p className="text-sm text-ink4">Loading fields...</p>
      ) : fields.length === 0 ? (
        <div className="bg-white rounded-xl border border-dashed border-border-brand p-8 text-center">
          <p className="text-sm text-ink4">No custom fields yet — add one above.</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-border-brand overflow-hidden">
          {fields.map((f, i) =>
            editingKey === f.key ? (
              <div key={f.key} className="p-4 border-b border-border-brand last:border-0 space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <TextField
                    label="Label"
                    value={editForm.label}
                    onChange={(e) => setEditForm((s) => ({ ...s, label: e.target.value }))}
                    size="small"
                    fullWidth
                  />
                  <TextField
                    select
                    label="Type"
                    value={editForm.type}
                    onChange={(e) =>
                      setEditForm((s) => ({ ...s, type: e.target.value as FieldType }))
                    }
                    size="small"
                    fullWidth
                  >
                    {FIELD_TYPES.map((t) => (
                      <MenuItem key={t} value={t}>
                        {TYPE_LABEL[t]}
                      </MenuItem>
                    ))}
                  </TextField>
                </div>
                {editForm.type === 'select' && (
                  <TextField
                    label="Options"
                    helperText="comma-separated"
                    value={editForm.optionsText}
                    onChange={(e) => setEditForm((s) => ({ ...s, optionsText: e.target.value }))}
                    size="small"
                    fullWidth
                  />
                )}
                <FormControlLabel
                  control={
                    <Checkbox
                      size="small"
                      checked={editForm.required}
                      onChange={(e) => setEditForm((s) => ({ ...s, required: e.target.checked }))}
                    />
                  }
                  label={<span className="text-sm text-ink2">Required</span>}
                />
                {formError && <p className="text-xs text-rose-600">{formError}</p>}
                <div className="flex items-center gap-2">
                  <Button
                    onClick={() => void saveEdit()}
                    disabled={saving}
                    size="small"
                    variant="contained"
                  >
                    {saving ? 'Saving...' : 'Save'}
                  </Button>
                  <Button onClick={() => setEditingKey(null)} size="small" color="inherit">
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <div
                key={f.key}
                className="flex items-center justify-between gap-3 px-4 py-3 border-b border-border-brand last:border-0"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium text-ink">{f.label}</span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-bg2 text-ink4 font-medium">
                      {TYPE_LABEL[f.type]}
                    </span>
                    {f.required && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 font-medium">
                        Required
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-ink4 font-mono mt-0.5">
                    {f.key}
                    {f.type === 'select' && f.options?.length ? ` · ${f.options.join(', ')}` : ''}
                  </p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={() => void move(i, -1)}
                    disabled={i === 0}
                    className="text-ink4 hover:text-ink3 disabled:opacity-30 px-1"
                    title="Move up"
                    aria-label="Move up"
                  >
                    ↑
                  </button>
                  <button
                    onClick={() => void move(i, 1)}
                    disabled={i === fields.length - 1}
                    className="text-ink4 hover:text-ink3 disabled:opacity-30 px-1"
                    title="Move down"
                    aria-label="Move down"
                  >
                    ↓
                  </button>
                  <Button onClick={() => startEdit(f)} size="small" color="inherit">
                    Edit
                  </Button>
                  <Button onClick={() => void deleteField(f)} size="small" color="error">
                    Remove
                  </Button>
                </div>
              </div>
            )
          )}
        </div>
      )}

      {showAddModal && (
        <Modal
          onClose={() => setShowAddModal(false)}
          title="Add Custom Field"
          footer={
            <>
              <Button onClick={() => setShowAddModal(false)} variant="text" color="inherit">
                Cancel
              </Button>
              <Button onClick={() => void addField()} disabled={saving} variant="contained">
                {saving ? 'Adding…' : 'Add Field'}
              </Button>
            </>
          }
        >
          <div className="space-y-4">
            <TextField
              label="Label"
              value={addForm.label}
              onChange={(e) => {
                const label = e.target.value
                setAddForm((s) => ({
                  ...s,
                  label,
                  key: addKeyTouched ? s.key : toKeySuggestion(label),
                }))
              }}
              placeholder="e.g. Preferred Contact Time"
              fullWidth
              size="small"
            />
            <TextField
              label="Key"
              helperText="Lowercase letters, numbers, underscores only. Can't be changed later."
              value={addForm.key}
              onChange={(e) => {
                setAddKeyTouched(true)
                setAddForm((s) => ({ ...s, key: e.target.value }))
              }}
              placeholder="preferred_contact_time"
              fullWidth
              size="small"
            />
            <TextField
              select
              label="Type"
              value={addForm.type}
              onChange={(e) => setAddForm((s) => ({ ...s, type: e.target.value as FieldType }))}
              fullWidth
              size="small"
            >
              {FIELD_TYPES.map((t) => (
                <MenuItem key={t} value={t}>
                  {TYPE_LABEL[t]}
                </MenuItem>
              ))}
            </TextField>
            {addForm.type === 'select' && (
              <TextField
                label="Options"
                helperText="comma-separated, e.g. Morning, Afternoon, Evening"
                value={addForm.optionsText}
                onChange={(e) => setAddForm((s) => ({ ...s, optionsText: e.target.value }))}
                fullWidth
                size="small"
              />
            )}
            <FormControlLabel
              control={
                <Checkbox
                  size="small"
                  checked={addForm.required}
                  onChange={(e) => setAddForm((s) => ({ ...s, required: e.target.checked }))}
                />
              }
              label={<span className="text-sm text-ink2">Required</span>}
            />
            {formError && <p className="text-xs text-rose-600">{formError}</p>}
          </div>
        </Modal>
      )}
    </div>
  )
}
