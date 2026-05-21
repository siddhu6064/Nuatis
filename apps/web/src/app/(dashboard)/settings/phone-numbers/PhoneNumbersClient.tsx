'use client'

import { useState } from 'react'

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

export default function PhoneNumbersClient({ initialNumbers }: { initialNumbers: TelnyxNumberRow[] }) {
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
    if (!phone) { setAddError('Phone number required'); return }
    if (!/^\+[1-9]\d{1,14}$/.test(phone)) {
      setAddError('Must be E.164 format: +15125551234')
      return
    }
    if (!addForm.label.trim()) { setAddError('Label required'); return }

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
      if (!res.ok) { setAddError(data.error ?? 'Failed to add'); return }
      setNumbers(prev => [...prev, data])
      setShowAddForm(false)
      setAddForm({ phone_number: '', label: '', department: 'general', maya_enabled: true, forwarding_number: '' })
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
        setNumbers(prev => prev.map(n => n.id === id ? { ...n, maya_enabled: !current } : n))
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
        setNumbers(prev => prev.map(n => n.id === id ? { ...n, label: data.label, department: data.department } : n))
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
        setNumbers(prev => prev.map(n => ({ ...n, is_primary: n.id === id })))
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
        setNumbers(prev => prev.filter(n => n.id !== id))
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
          <button
            type="button"
            onClick={() => { setShowAddForm(v => !v); setAddError(null) }}
            className="px-3 py-1.5 text-sm border border-border-brand rounded-lg hover:bg-bg transition-colors text-ink2"
          >
            {showAddForm ? 'Cancel' : 'Add Number'}
          </button>
        </div>

        {actionError && (
          <div className="mx-6 mt-4 px-3 py-2 bg-red-50 text-red-600 text-sm rounded-lg">
            {actionError}
          </div>
        )}

        {/* Add form */}
        {showAddForm && (
          <form onSubmit={handleAdd} className="px-6 py-4 border-b border-border-brand bg-bg space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="add-phone" className="block text-xs text-ink3 mb-1">Phone Number (E.164)</label>
                <input
                  id="add-phone"
                  type="text"
                  placeholder="+15125551234"
                  value={addForm.phone_number}
                  onChange={e => setAddForm(f => ({ ...f, phone_number: e.target.value }))}
                  className="w-full px-3 py-1.5 text-sm border border-border-brand rounded-lg focus:outline-none focus:ring-1 focus:ring-brand bg-white text-ink"
                />
              </div>
              <div>
                <label htmlFor="add-label" className="block text-xs text-ink3 mb-1">Label</label>
                <input
                  id="add-label"
                  type="text"
                  placeholder="Front Desk"
                  maxLength={50}
                  value={addForm.label}
                  onChange={e => setAddForm(f => ({ ...f, label: e.target.value }))}
                  className="w-full px-3 py-1.5 text-sm border border-border-brand rounded-lg focus:outline-none focus:ring-1 focus:ring-brand bg-white text-ink"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="add-department" className="block text-xs text-ink3 mb-1">Department</label>
                <select
                  id="add-department"
                  value={addForm.department}
                  onChange={e => setAddForm(f => ({ ...f, department: e.target.value as Department }))}
                  className="w-full px-3 py-1.5 text-sm border border-border-brand rounded-lg focus:outline-none bg-white text-ink"
                >
                  {DEPARTMENTS.map(d => (
                    <option key={d} value={d}>{DEPT_LABELS[d]}</option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="add-forwarding" className="block text-xs text-ink3 mb-1">
                  Forwarding Number <span className="text-ink4">(optional)</span>
                </label>
                <input
                  id="add-forwarding"
                  type="text"
                  placeholder="+15125559999"
                  value={addForm.forwarding_number}
                  onChange={e => setAddForm(f => ({ ...f, forwarding_number: e.target.value }))}
                  className="w-full px-3 py-1.5 text-sm border border-border-brand rounded-lg focus:outline-none focus:ring-1 focus:ring-brand bg-white text-ink"
                />
              </div>
            </div>
            <div className="flex items-center gap-3">
              <label htmlFor="add-maya" className="flex items-center gap-2 cursor-pointer">
                <input
                  id="add-maya"
                  type="checkbox"
                  checked={addForm.maya_enabled}
                  onChange={e => setAddForm(f => ({ ...f, maya_enabled: e.target.checked }))}
                  className="w-4 h-4 rounded border-border-brand"
                />
                <span className="text-sm text-ink2">Maya answers this number</span>
              </label>
            </div>
            {addError && <p className="text-sm text-red-600">{addError}</p>}
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={adding}
                className="px-4 py-1.5 text-sm bg-brand text-white rounded-lg hover:opacity-90 transition-opacity disabled:opacity-50"
              >
                {adding ? 'Adding…' : 'Add Number'}
              </button>
            </div>
          </form>
        )}

        {/* Numbers list */}
        {numbers.length === 0 ? (
          <div className="px-6 py-8 text-center text-sm text-ink4">
            No phone numbers added yet.
          </div>
        ) : (
          <div className="divide-y divide-border-brand">
            {numbers.map(num => (
              <div key={num.id} className="px-6 py-4">
                {editingId === num.id && editForm ? (
                  /* Inline edit row */
                  <div className="flex items-center gap-3 flex-wrap">
                    <input
                      type="text"
                      value={editForm.label}
                      onChange={e => setEditForm(f => f ? { ...f, label: e.target.value } : f)}
                      maxLength={50}
                      className="px-2 py-1 text-sm border border-border-brand rounded focus:outline-none focus:ring-1 focus:ring-brand"
                    />
                    <select
                      value={editForm.department}
                      onChange={e => setEditForm(f => f ? { ...f, department: e.target.value as Department } : f)}
                      className="px-2 py-1 text-sm border border-border-brand rounded focus:outline-none"
                    >
                      {DEPARTMENTS.map(d => (
                        <option key={d} value={d}>{DEPT_LABELS[d]}</option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => void handleSaveEdit(num.id)}
                      disabled={savingId === num.id}
                      className="text-sm text-brand hover:underline disabled:opacity-50"
                    >
                      {savingId === num.id ? 'Saving…' : 'Save'}
                    </button>
                    <button
                      type="button"
                      onClick={() => { setEditingId(null); setEditForm(null) }}
                      className="text-sm text-ink4 hover:underline"
                    >Cancel</button>
                  </div>
                ) : (
                  /* Normal display row */
                  <div className="flex items-center justify-between gap-4 flex-wrap">
                    <div className="flex items-center gap-3 min-w-0">
                      {num.is_primary && (
                        <span title="Primary number" className="text-amber-500 shrink-0">★</span>
                      )}
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-ink">{formatPhone(num.phone_number)}</p>
                        <p className="text-xs text-ink4">{num.label}</p>
                      </div>
                      <span className={`text-xs px-2 py-0.5 rounded-full shrink-0 ${DEPT_CLASSES[num.department]}`}>
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
                        <button
                          type="button"
                          role="switch"
                          aria-label="Toggle Maya"
                          aria-checked={num.maya_enabled}
                          disabled={togglingId === num.id}
                          onClick={() => void handleToggleMaya(num.id, num.maya_enabled)}
                          className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none disabled:opacity-50 ${num.maya_enabled ? 'bg-brand' : 'bg-gray-200'}`}
                        >
                          <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${num.maya_enabled ? 'translate-x-4' : 'translate-x-1'}`} />
                        </button>
                      </div>
                      {/* Edit */}
                      <button
                        type="button"
                        onClick={() => { setEditingId(num.id); setEditForm({ label: num.label, department: num.department }) }}
                        className="text-xs text-ink4 hover:text-ink transition-colors"
                        title="Edit"
                      >Edit</button>
                      {/* Set Primary */}
                      {!num.is_primary && (
                        <button
                          type="button"
                          onClick={() => void handleSetPrimary(num.id)}
                          disabled={settingPrimaryId === num.id}
                          className="text-xs text-ink4 hover:text-ink transition-colors disabled:opacity-50"
                          title="Set as primary"
                        >Set Primary</button>
                      )}
                      {/* Delete */}
                      {!num.is_primary && (
                        <button
                          type="button"
                          onClick={() => void handleDelete(num.id, num.phone_number)}
                          disabled={deletingId === num.id}
                          className="text-xs text-ink4 hover:text-red-500 transition-colors disabled:opacity-40"
                          title="Remove"
                        >Remove</button>
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
          Numbers are linked to your Telnyx account. To add a new number, purchase it in Telnyx then add it here.
          Maya will answer calls to any number with Maya enabled.
        </p>
      </div>
    </div>
  )
}
