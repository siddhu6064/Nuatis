'use client'

import { useState } from 'react'
import Switch from '@mui/material/Switch'
import Button from '@mui/material/Button'
import TextField from '@mui/material/TextField'
import MenuItem from '@mui/material/MenuItem'
import Checkbox from '@mui/material/Checkbox'

type Department = 'general' | 'scheduling' | 'billing' | 'sales' | 'support' | 'maya'
type NumberStatus = 'active' | 'inactive'

export interface TelnyxNumberRow {
  id: string
  phone_number: string
  label: string
  department: Department
  is_primary: boolean
  maya_enabled: boolean
  forwarding_number: string | null
  status: NumberStatus
  created_at: string
}

const DEPT_LABELS: Record<Department, string> = {
  general: 'General',
  scheduling: 'Scheduling',
  billing: 'Billing',
  sales: 'Sales',
  support: 'Support',
  maya: 'Maya',
}

const DEPT_CLASSES: Record<Department, string> = {
  general: 'bg-gray-100 text-gray-600',
  scheduling: 'bg-teal-50 text-teal-700',
  billing: 'bg-green-50 text-green-700',
  sales: 'bg-blue-50 text-blue-700',
  support: 'bg-amber-50 text-amber-700',
  maya: 'bg-orange-50 text-orange-700',
}

const DEPARTMENTS: Department[] = ['general', 'scheduling', 'billing', 'sales', 'support', 'maya']

function formatPhone(p: string) {
  // Format E.164 → (555) 555-5555 for US numbers
  const digits = p.replace(/\D/g, '')
  if (digits.length === 11 && digits.startsWith('1')) {
    return `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`
  }
  return p
}

export default function PhoneNumbersClient({
  initialNumbers,
}: {
  initialNumbers: TelnyxNumberRow[]
}) {
  const [numbers, setNumbers] = useState<TelnyxNumberRow[]>(initialNumbers)
  const [showAddForm, setShowAddForm] = useState(false)
  const [addForm, setAddForm] = useState({
    phone_number: '',
    label: '',
    department: 'general' as Department,
    maya_enabled: true,
    forwarding_number: '',
  })
  const [addError, setAddError] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editForm, setEditForm] = useState<{ label: string; department: Department } | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [savingId, setSavingId] = useState<string | null>(null)
  const [togglingId, setTogglingId] = useState<string | null>(null)
  const [settingPrimaryId, setSettingPrimaryId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    const phone = addForm.phone_number.trim()
    if (!phone) {
      setAddError('Phone number required')
      return
    }
    if (!/^\+[1-9]\d{1,14}$/.test(phone)) {
      setAddError('Must be E.164 format: +15125551234')
      return
    }
    if (!addForm.label.trim()) {
      setAddError('Label required')
      return
    }

    setAdding(true)
    setAddError(null)
    try {
      const res = await fetch('/api/telnyx-numbers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone_number: phone,
          label: addForm.label.trim(),
          department: addForm.department,
          maya_enabled: addForm.maya_enabled,
          forwarding_number: addForm.forwarding_number.trim() || null,
        }),
        credentials: 'include',
      })
      const data = (await res.json()) as TelnyxNumberRow & { error?: string }
      if (!res.ok) {
        setAddError(data.error ?? 'Failed to add')
        return
      }
      setNumbers((prev) => [...prev, data])
      setShowAddForm(false)
      setAddForm({
        phone_number: '',
        label: '',
        department: 'general',
        maya_enabled: true,
        forwarding_number: '',
      })
    } catch {
      setAddError('Network error')
    } finally {
      setAdding(false)
    }
  }

  async function handleToggleMaya(id: string, current: boolean) {
    setTogglingId(id)
    setActionError(null)
    try {
      const res = await fetch(`/api/telnyx-numbers/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ maya_enabled: !current }),
        credentials: 'include',
      })
      if (res.ok) {
        setNumbers((prev) => prev.map((n) => (n.id === id ? { ...n, maya_enabled: !current } : n)))
      } else {
        const d = (await res.json()) as { error?: string }
        setActionError(d.error ?? 'Failed to update')
      }
    } catch {
      setActionError('Network error')
    } finally {
      setTogglingId(null)
    }
  }

  async function handleSaveEdit(id: string) {
    if (!editForm) return
    setSavingId(id)
    setActionError(null)
    try {
      const res = await fetch(`/api/telnyx-numbers/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: editForm.label, department: editForm.department }),
        credentials: 'include',
      })
      const data = (await res.json()) as TelnyxNumberRow & { error?: string }
      if (res.ok) {
        setNumbers((prev) =>
          prev.map((n) =>
            n.id === id ? { ...n, label: data.label, department: data.department } : n
          )
        )
        setEditingId(null)
        setEditForm(null)
      } else {
        setActionError(data.error ?? 'Failed to save')
      }
    } catch {
      setActionError('Network error')
    } finally {
      setSavingId(null)
    }
  }

  async function handleSetPrimary(id: string) {
    setSettingPrimaryId(id)
    setActionError(null)
    try {
      const res = await fetch(`/api/telnyx-numbers/${id}/set-primary`, {
        method: 'POST',
        credentials: 'include',
      })
      if (res.ok) {
        setNumbers((prev) => prev.map((n) => ({ ...n, is_primary: n.id === id })))
      } else {
        const d = (await res.json()) as { error?: string }
        setActionError(d.error ?? 'Failed to set primary')
      }
    } catch {
      setActionError('Network error')
    } finally {
      setSettingPrimaryId(null)
    }
  }

  async function handleDelete(id: string, phone: string) {
    if (!confirm(`Remove ${phone} from your account?`)) return
    setDeletingId(id)
    setActionError(null)
    try {
      const res = await fetch(`/api/telnyx-numbers/${id}`, {
        method: 'DELETE',
        credentials: 'include',
      })
      if (res.ok) {
        setNumbers((prev) => prev.filter((n) => n.id !== id))
      } else {
        const d = (await res.json()) as { error?: string }
        setActionError(d.error ?? 'Failed to delete')
      }
    } catch {
      setActionError('Network error')
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <div className="max-w-3xl space-y-6">
      {/* Numbers table */}
      <div className="bg-white rounded-xl border border-border-brand">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border-brand">
          <h2 className="text-sm font-semibold text-ink">Telnyx Numbers</h2>
          <Button
            onClick={() => {
              setShowAddForm((v) => !v)
              setAddError(null)
            }}
            size="small"
            color="inherit"
          >
            {showAddForm ? 'Cancel' : 'Add Number'}
          </Button>
        </div>

        {actionError && (
          <div className="mx-6 mt-4 px-3 py-2 bg-red-50 text-red-600 text-sm rounded-lg">
            {actionError}
          </div>
        )}

        {/* Add form */}
        {showAddForm && (
          <form
            onSubmit={handleAdd}
            className="px-6 py-4 border-b border-border-brand bg-bg space-y-3"
          >
            <div className="grid grid-cols-2 gap-3">
              <TextField
                label="Phone Number (E.164)"
                placeholder="+15125551234"
                value={addForm.phone_number}
                onChange={(e) => setAddForm((f) => ({ ...f, phone_number: e.target.value }))}
                size="small"
                fullWidth
              />
              <TextField
                label="Label"
                placeholder="Front Desk"
                value={addForm.label}
                onChange={(e) => setAddForm((f) => ({ ...f, label: e.target.value }))}
                size="small"
                fullWidth
                slotProps={{ htmlInput: { maxLength: 50 } }}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <TextField
                select
                label="Department"
                value={addForm.department}
                onChange={(e) =>
                  setAddForm((f) => ({ ...f, department: e.target.value as Department }))
                }
                size="small"
                fullWidth
              >
                {DEPARTMENTS.map((d) => (
                  <MenuItem key={d} value={d}>
                    {DEPT_LABELS[d]}
                  </MenuItem>
                ))}
              </TextField>
              <TextField
                label="Forwarding Number (optional)"
                placeholder="+15125559999"
                value={addForm.forwarding_number}
                onChange={(e) => setAddForm((f) => ({ ...f, forwarding_number: e.target.value }))}
                size="small"
                fullWidth
              />
            </div>
            <div className="flex items-center gap-3">
              <label htmlFor="add-maya" className="flex items-center gap-2 cursor-pointer">
                <Checkbox
                  id="add-maya"
                  checked={addForm.maya_enabled}
                  onChange={(e) => setAddForm((f) => ({ ...f, maya_enabled: e.target.checked }))}
                  size="small"
                  sx={{ p: 0 }}
                />
                <span className="text-sm text-ink2">Maya answers this number</span>
              </label>
            </div>
            {addError && <p className="text-sm text-red-600">{addError}</p>}
            <div className="flex gap-2">
              <Button type="submit" disabled={adding} variant="contained" size="small">
                {adding ? 'Adding…' : 'Add Number'}
              </Button>
            </div>
          </form>
        )}

        {/* Numbers list */}
        {numbers.length === 0 ? (
          <div className="px-6 py-8 text-center text-sm text-ink4">No phone numbers added yet.</div>
        ) : (
          <div className="divide-y divide-border-brand">
            {numbers.map((num) => (
              <div key={num.id} className="px-6 py-4">
                {editingId === num.id && editForm ? (
                  /* Inline edit row */
                  <div className="flex items-center gap-3 flex-wrap">
                    <TextField
                      value={editForm.label}
                      onChange={(e) =>
                        setEditForm((f) => (f ? { ...f, label: e.target.value } : f))
                      }
                      size="small"
                      slotProps={{ htmlInput: { maxLength: 50 } }}
                    />
                    <TextField
                      select
                      value={editForm.department}
                      onChange={(e) =>
                        setEditForm((f) =>
                          f ? { ...f, department: e.target.value as Department } : f
                        )
                      }
                      size="small"
                    >
                      {DEPARTMENTS.map((d) => (
                        <MenuItem key={d} value={d}>
                          {DEPT_LABELS[d]}
                        </MenuItem>
                      ))}
                    </TextField>
                    <Button
                      onClick={() => void handleSaveEdit(num.id)}
                      disabled={savingId === num.id}
                      size="small"
                    >
                      {savingId === num.id ? 'Saving…' : 'Save'}
                    </Button>
                    <Button
                      onClick={() => {
                        setEditingId(null)
                        setEditForm(null)
                      }}
                      size="small"
                      color="inherit"
                    >
                      Cancel
                    </Button>
                  </div>
                ) : (
                  /* Normal display row */
                  <div className="flex items-center justify-between gap-4 flex-wrap">
                    <div className="flex items-center gap-3 min-w-0">
                      {num.is_primary && (
                        <span title="Primary number" className="text-amber-500 shrink-0">
                          ★
                        </span>
                      )}
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-ink">
                          {formatPhone(num.phone_number)}
                        </p>
                        <p className="text-xs text-ink4">{num.label}</p>
                      </div>
                      <span
                        className={`text-xs px-2 py-0.5 rounded-full shrink-0 ${DEPT_CLASSES[num.department]}`}
                      >
                        {DEPT_LABELS[num.department]}
                      </span>
                      {num.status === 'inactive' && (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 shrink-0">
                          Inactive
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      {/* Maya toggle */}
                      <div className="flex items-center gap-1.5" title="Maya answers this number">
                        <span className="text-xs text-ink4">Maya</span>
                        <Switch
                          size="small"
                          checked={num.maya_enabled}
                          disabled={togglingId === num.id}
                          onChange={() => void handleToggleMaya(num.id, num.maya_enabled)}
                          slotProps={{
                            input: {
                              'aria-label': `Toggle Maya for ${formatPhone(num.phone_number)}`,
                            },
                          }}
                        />
                      </div>
                      {/* Edit */}
                      <Button
                        onClick={() => {
                          setEditingId(num.id)
                          setEditForm({ label: num.label, department: num.department })
                        }}
                        size="small"
                        color="inherit"
                        title="Edit"
                      >
                        Edit
                      </Button>
                      {/* Set Primary */}
                      {!num.is_primary && (
                        <Button
                          onClick={() => void handleSetPrimary(num.id)}
                          disabled={settingPrimaryId === num.id}
                          size="small"
                          color="inherit"
                          title="Set as primary"
                        >
                          Set Primary
                        </Button>
                      )}
                      {/* Delete */}
                      {!num.is_primary && (
                        <Button
                          onClick={() => void handleDelete(num.id, num.phone_number)}
                          disabled={deletingId === num.id}
                          size="small"
                          color="error"
                          title="Remove"
                        >
                          Remove
                        </Button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Info note */}
      <div className="bg-bg rounded-xl border border-border-brand px-6 py-4">
        <p className="text-xs text-ink3">
          Numbers are linked to your Telnyx account. To add a new number, purchase it in Telnyx then
          add it here. Maya will answer calls to any number with Maya enabled.
        </p>
      </div>
    </div>
  )
}
