'use client'

import { useState, useEffect } from 'react'
import {
  COLOR_SWATCHES,
  DAY_KEYS,
  DAY_LABEL,
  type Availability,
  type DayKey,
  type StaffMember,
} from './types'

interface Props {
  open: boolean
  onClose: () => void
  member?: StaffMember
  onSaved: (member: StaffMember) => void
}

function emptyAvailability(): Availability {
  const a: Availability = {}
  for (const d of DAY_KEYS) {
    a[d] = { enabled: false, start: '09:00', end: '17:00' }
  }
  return a
}

export default function StaffSlideOver({ open, onClose, member, onSaved }: Props) {
  const isEdit = Boolean(member)

  const [name, setName] = useState('')
  const [role, setRole] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [colorHex, setColorHex] = useState<string>(COLOR_SWATCHES[0])
  const [availability, setAvailability] = useState<Availability>(emptyAvailability())
  const [notes, setNotes] = useState('')

  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [apiError, setApiError] = useState<string | null>(null)

  useEffect(() => {
    if (member) {
      setName(member.name)
      setRole(member.role)
      setEmail(member.email ?? '')
      setPhone(member.phone ?? '')
      setColorHex(member.color_hex || COLOR_SWATCHES[0])
      const merged = emptyAvailability()
      for (const d of DAY_KEYS) {
        const src = member.availability?.[d]
        if (src) {
          merged[d] = {
            enabled: Boolean(src.enabled),
            start: src.start ?? '09:00',
            end: src.end ?? '17:00',
          }
        }
      }
      setAvailability(merged)
      setNotes(member.notes ?? '')
    } else {
      setName('')
      setRole('')
      setEmail('')
      setPhone('')
      setColorHex(COLOR_SWATCHES[0])
      setAvailability(emptyAvailability())
      setNotes('')
    }
    setFieldErrors({})
    setApiError(null)
  }, [member, open])

  const setDay = (d: DayKey, patch: Partial<{ enabled: boolean; start: string; end: string }>) => {
    setAvailability((prev) => ({
      ...prev,
      [d]: { ...(prev[d] ?? { enabled: false, start: '09:00', end: '17:00' }), ...patch },
    }))
  }

  const validate = (): boolean => {
    const errs: Record<string, string> = {}
    if (!name.trim()) errs['name'] = 'Name is required'
    if (!role.trim()) errs['role'] = 'Role is required'
    for (const d of DAY_KEYS) {
      const e = availability[d]
      if (e?.enabled) {
        const s = e.start ?? ''
        const en = e.end ?? ''
        if (!s || !en || !(en > s)) errs[`av_${d}`] = 'End must be after start'
      }
    }
    setFieldErrors(errs)
    return Object.keys(errs).length === 0
  }

  const handleSave = async () => {
    if (!validate()) return
    setSaving(true)
    setApiError(null)

    const body: Record<string, unknown> = {
      name: name.trim(),
      role: role.trim(),
      email: email.trim() || null,
      phone: phone.trim() || null,
      color_hex: colorHex,
      availability,
      notes: notes.trim() || null,
    }

    try {
      const url = isEdit ? `/api/staff/${member?.id}` : '/api/staff'
      const method = isEdit ? 'PUT' : 'POST'
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string }
        setApiError(err.error ?? 'Failed to save')
        return
      }
      const saved = (await res.json()) as StaffMember
      onSaved(saved)
    } finally {
      setSaving(false)
    }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative ml-auto bg-white h-full w-full max-w-md border-l border-gray-200 shadow-xl overflow-y-auto">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-900">
            {isEdit ? 'Edit team member' : 'Add team member'}
          </h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-700"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <div className="px-5 py-5 space-y-4">
          {/* Name */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1.5">Name *</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2"
            />
            {fieldErrors['name'] && (
              <p className="text-xs text-red-500 mt-1">{fieldErrors['name']}</p>
            )}
          </div>

          {/* Role */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1.5">Role *</label>
            <input
              type="text"
              value={role}
              onChange={(e) => setRole(e.target.value)}
              placeholder="e.g. Dentist, Stylist, Agent"
              className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2"
            />
            {fieldErrors['role'] && (
              <p className="text-xs text-red-500 mt-1">{fieldErrors['role']}</p>
            )}
          </div>

          {/* Email + Phone */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1.5">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1.5">Phone</label>
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2"
              />
            </div>
          </div>

          {/* Color swatches */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1.5">Color</label>
            <div className="flex flex-wrap gap-2">
              {COLOR_SWATCHES.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColorHex(c)}
                  className={`w-6 h-6 rounded-full transition-all ${
                    colorHex === c ? 'ring-2 ring-offset-1 ring-teal-500' : ''
                  }`}
                  style={{ backgroundColor: c }}
                  aria-label={`Select color ${c}`}
                />
              ))}
            </div>
          </div>

          {/* Availability editor */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-2">Availability</label>
            <div className="space-y-2">
              {DAY_KEYS.map((d) => {
                const e = availability[d] ?? { enabled: false, start: '09:00', end: '17:00' }
                return (
                  <div key={d} className="flex items-center gap-2">
                    <div className="w-10 text-sm text-gray-600">{DAY_LABEL[d]}</div>
                    <button
                      type="button"
                      onClick={() => setDay(d, { enabled: !e.enabled })}
                      role="switch"
                      aria-checked={Boolean(e.enabled)}
                      className={`relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ${
                        e.enabled ? 'bg-teal-600' : 'bg-gray-200'
                      }`}
                    >
                      <span
                        className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                          e.enabled ? 'translate-x-4' : 'translate-x-0'
                        }`}
                      />
                    </button>
                    {e.enabled ? (
                      <>
                        <input
                          type="time"
                          value={e.start ?? '09:00'}
                          onChange={(ev) => setDay(d, { start: ev.target.value })}
                          className="text-sm border border-gray-200 rounded px-2 py-1"
                        />
                        <span className="text-xs text-gray-400">to</span>
                        <input
                          type="time"
                          value={e.end ?? '17:00'}
                          onChange={(ev) => setDay(d, { end: ev.target.value })}
                          className="text-sm border border-gray-200 rounded px-2 py-1"
                        />
                      </>
                    ) : (
                      <span className="text-xs text-gray-400">Off</span>
                    )}
                    {fieldErrors[`av_${d}`] && (
                      <span className="text-xs text-red-500 ml-1">{fieldErrors[`av_${d}`]}</span>
                    )}
                  </div>
                )
              })}
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1.5">Notes</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2"
            />
          </div>

          {apiError && (
            <p className="text-xs text-red-600 bg-red-50 border border-red-100 px-3 py-2 rounded-lg">
              {apiError}
            </p>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button
              onClick={onClose}
              className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              onClick={() => void handleSave()}
              disabled={saving}
              className="rounded-lg bg-teal-600 px-4 py-2 text-sm font-medium text-white hover:bg-teal-700 disabled:opacity-60"
            >
              {saving ? 'Saving...' : isEdit ? 'Save' : 'Add'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
