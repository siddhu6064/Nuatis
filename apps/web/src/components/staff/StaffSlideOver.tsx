'use client'

import { useState, useEffect } from 'react'
import Switch from '@mui/material/Switch'
import Checkbox from '@mui/material/Checkbox'
import Button from '@mui/material/Button'
import TextField from '@mui/material/TextField'
import MenuItem from '@mui/material/MenuItem'
import Select from '@mui/material/Select'
import InputLabel from '@mui/material/InputLabel'
import FormControl from '@mui/material/FormControl'
import { SlideOver } from '@/components/ui/SlideOver'
import {
  COLOR_SWATCHES,
  DAY_KEYS,
  DAY_LABEL,
  type Availability,
  type DayKey,
  type PayType,
  type StaffMember,
} from './types'

function centsToDollarsStr(cents: number | null | undefined): string {
  return cents == null ? '' : (cents / 100).toFixed(2)
}

function dollarsStrToCents(v: string): number | null {
  const trimmed = v.trim()
  if (!trimmed) return null
  const n = Number(trimmed)
  return Number.isFinite(n) ? Math.round(n * 100) : null
}

interface Props {
  open: boolean
  onClose: () => void
  member?: StaffMember
  onSaved: (member: StaffMember) => void
}

interface ServiceOption {
  id: string
  name: string
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
  const [payType, setPayType] = useState<PayType>(null)
  const [hourlyRate, setHourlyRate] = useState('')
  const [salary, setSalary] = useState('')

  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [apiError, setApiError] = useState<string | null>(null)

  const [inviting, setInviting] = useState(false)
  const [inviteResult, setInviteResult] = useState<{ ok: boolean; message: string } | null>(null)
  const [portalLinked, setPortalLinked] = useState(Boolean(member?.user_id))

  const [services, setServices] = useState<ServiceOption[]>([])
  const [selectedServiceIds, setSelectedServiceIds] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (!open || !member) return
    fetch('/api/services')
      .then((r) => (r.ok ? r.json() : { services: [] }))
      .then((data: { services: ServiceOption[] }) => setServices(data.services ?? []))
      .catch(() => setServices([]))

    fetch(`/api/staff/${member.id}/services`)
      .then((r) => (r.ok ? r.json() : { service_ids: [] }))
      .then((data: { service_ids: string[] }) =>
        setSelectedServiceIds(new Set(data.service_ids ?? []))
      )
      .catch(() => setSelectedServiceIds(new Set()))
  }, [open, member])

  const toggleService = (id: string) => {
    setSelectedServiceIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

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
      setPayType(member.pay_type ?? null)
      setHourlyRate(centsToDollarsStr(member.hourly_rate_cents))
      setSalary(centsToDollarsStr(member.salary_cents))
      setPortalLinked(Boolean(member.user_id))
    } else {
      setName('')
      setRole('')
      setEmail('')
      setPhone('')
      setColorHex(COLOR_SWATCHES[0])
      setAvailability(emptyAvailability())
      setNotes('')
      setPayType(null)
      setHourlyRate('')
      setSalary('')
      setPortalLinked(false)
    }
    setFieldErrors({})
    setApiError(null)
    setInviteResult(null)
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
      pay_type: payType,
      hourly_rate_cents: payType === 'hourly' ? dollarsStrToCents(hourlyRate) : null,
      salary_cents: payType === 'salary' ? dollarsStrToCents(salary) : null,
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

      if (isEdit && member) {
        await fetch(`/api/staff/${member.id}/services`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ service_ids: Array.from(selectedServiceIds) }),
        })
      }

      onSaved(saved)
    } finally {
      setSaving(false)
    }
  }

  const handleInvite = async () => {
    if (!member) return
    setInviting(true)
    setInviteResult(null)
    try {
      const res = await fetch(`/api/staff/${member.id}/invite`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim() || undefined }),
      })
      const body = (await res.json().catch(() => ({}))) as { error?: string; email?: string }
      if (!res.ok) {
        setInviteResult({ ok: false, message: body.error ?? 'Failed to send invite' })
        return
      }
      setPortalLinked(true)
      setInviteResult({ ok: true, message: `Invite sent to ${body.email ?? email}` })
    } finally {
      setInviting(false)
    }
  }

  return (
    <SlideOver
      onClose={onClose}
      open={open}
      title={isEdit ? 'Edit team member' : 'Add team member'}
    >
      <div className="px-5 py-5 space-y-4">
        {/* Name */}
        <div>
          <label className="block text-xs font-medium text-ink3 mb-1.5">Name *</label>
          <TextField
            value={name}
            onChange={(e) => setName(e.target.value)}
            error={!!fieldErrors['name']}
            helperText={fieldErrors['name']}
            fullWidth
            size="small"
          />
        </div>

        {/* Role */}
        <div>
          <label className="block text-xs font-medium text-ink3 mb-1.5">Role *</label>
          <TextField
            value={role}
            onChange={(e) => setRole(e.target.value)}
            placeholder="e.g. Dentist, Stylist, Agent"
            error={!!fieldErrors['role']}
            helperText={fieldErrors['role']}
            fullWidth
            size="small"
          />
        </div>

        {/* Email + Phone */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-ink3 mb-1.5">Email</label>
            <TextField
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              fullWidth
              size="small"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-ink3 mb-1.5">Phone</label>
            <TextField
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              fullWidth
              size="small"
            />
          </div>
        </div>

        {/* Color swatches */}
        <div>
          <label className="block text-xs font-medium text-ink3 mb-1.5">Color</label>
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
          <label className="block text-xs font-medium text-ink3 mb-2">Availability</label>
          <div className="space-y-2">
            {DAY_KEYS.map((d) => {
              const e = availability[d] ?? { enabled: false, start: '09:00', end: '17:00' }
              return (
                <div key={d} className="flex items-center gap-2">
                  <div className="w-10 text-sm text-ink3">{DAY_LABEL[d]}</div>
                  <Switch
                    size="small"
                    checked={Boolean(e.enabled)}
                    onChange={(ev) => setDay(d, { enabled: ev.target.checked })}
                    slotProps={{ input: { 'aria-label': `${DAY_LABEL[d]} availability` } }}
                  />
                  {e.enabled ? (
                    <>
                      <TextField
                        type="time"
                        value={e.start ?? '09:00'}
                        onChange={(ev) => setDay(d, { start: ev.target.value })}
                        size="small"
                        sx={{ width: 120 }}
                      />
                      <span className="text-xs text-ink4">to</span>
                      <TextField
                        type="time"
                        value={e.end ?? '17:00'}
                        onChange={(ev) => setDay(d, { end: ev.target.value })}
                        size="small"
                        sx={{ width: 120 }}
                      />
                    </>
                  ) : (
                    <span className="text-xs text-ink4">Off</span>
                  )}
                  {fieldErrors[`av_${d}`] && (
                    <span className="text-xs text-red-500 ml-1">{fieldErrors[`av_${d}`]}</span>
                  )}
                </div>
              )
            })}
          </div>
        </div>

        {/* Services this staff member can perform — powers the booking-page staff picker */}
        {isEdit && services.length > 0 && (
          <div>
            <label className="block text-xs font-medium text-ink3 mb-1.5">Services</label>
            <p className="text-xs text-ink4 mb-2">
              Only checked services show this person as a staff option on the booking page.
              Unchecked services stay open to any staff.
            </p>
            <div className="space-y-1 max-h-40 overflow-y-auto">
              {services.map((s) => (
                <label key={s.id} className="flex items-center gap-2 text-sm text-ink2">
                  <Checkbox
                    size="small"
                    checked={selectedServiceIds.has(s.id)}
                    onChange={() => toggleService(s.id)}
                    sx={{ p: 0.5 }}
                  />
                  {s.name}
                </label>
              ))}
            </div>
          </div>
        )}

        {/* Pay rate — storage only, not a payroll run */}
        <div>
          <label className="block text-xs font-medium text-ink3 mb-1.5">Pay rate</label>
          <div className="grid grid-cols-2 gap-3">
            <FormControl size="small" fullWidth>
              <InputLabel id="pay-type-label">Type</InputLabel>
              <Select
                labelId="pay-type-label"
                label="Type"
                value={payType ?? ''}
                onChange={(e) => setPayType((e.target.value || null) as PayType)}
              >
                <MenuItem value="">Not set</MenuItem>
                <MenuItem value="hourly">Hourly</MenuItem>
                <MenuItem value="salary">Salary</MenuItem>
              </Select>
            </FormControl>
            {payType === 'hourly' && (
              <TextField
                label="$ / hour"
                value={hourlyRate}
                onChange={(e) => setHourlyRate(e.target.value)}
                size="small"
                fullWidth
                slotProps={{ htmlInput: { inputMode: 'decimal' } }}
              />
            )}
            {payType === 'salary' && (
              <TextField
                label="$ / year"
                value={salary}
                onChange={(e) => setSalary(e.target.value)}
                size="small"
                fullWidth
                slotProps={{ htmlInput: { inputMode: 'decimal' } }}
              />
            )}
          </div>
        </div>

        {/* Staff portal login — invite/status */}
        {isEdit && (
          <div className="bg-gray-50 rounded-lg p-3">
            <label className="block text-xs font-medium text-ink3 mb-1.5">Staff portal</label>
            {portalLinked ? (
              <p className="text-xs text-teal-700">
                ✓ Has a login — sees their own schedule, appointments, and time clock.
              </p>
            ) : (
              <>
                <p className="text-xs text-ink4 mb-2">
                  No login yet. Sending an invite emails a link to set a password.
                </p>
                <Button
                  onClick={() => void handleInvite()}
                  disabled={inviting || !email.trim()}
                  variant="outlined"
                  size="small"
                >
                  {inviting ? 'Sending…' : 'Invite to staff portal'}
                </Button>
                {!email.trim() && (
                  <p className="text-xs text-ink4 mt-1.5">Add an email above first.</p>
                )}
              </>
            )}
            {inviteResult && (
              <p className={`text-xs mt-2 ${inviteResult.ok ? 'text-teal-700' : 'text-red-600'}`}>
                {inviteResult.message}
              </p>
            )}
          </div>
        )}

        {/* Notes */}
        <div>
          <label className="block text-xs font-medium text-ink3 mb-1.5">Notes</label>
          <TextField
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            multiline
            rows={3}
            fullWidth
            size="small"
          />
        </div>

        {apiError && (
          <p className="text-xs text-red-600 bg-red-50 border border-red-100 px-3 py-2 rounded-lg">
            {apiError}
          </p>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <Button onClick={onClose} variant="outlined" color="inherit">
            Cancel
          </Button>
          <Button onClick={() => void handleSave()} disabled={saving} variant="contained">
            {saving ? 'Saving...' : isEdit ? 'Save' : 'Add'}
          </Button>
        </div>
      </div>
    </SlideOver>
  )
}
