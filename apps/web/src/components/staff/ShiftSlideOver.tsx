'use client'

import { useState, useEffect } from 'react'
import Button from '@mui/material/Button'
import TextField from '@mui/material/TextField'
import MenuItem from '@mui/material/MenuItem'
import { SlideOver } from '@/components/ui/SlideOver'
import type { Shift, StaffMember } from './types'

interface Props {
  open: boolean
  onClose: () => void
  shift?: Shift
  staffId?: string
  staffName?: string
  date?: string
  defaultStart?: string
  defaultEnd?: string
  staffList: StaffMember[]
  onSaved: () => void
  onDeleted?: () => void
}

export default function ShiftSlideOver({
  open,
  onClose,
  shift,
  staffId,
  staffName,
  date,
  defaultStart,
  defaultEnd,
  staffList,
  onSaved,
  onDeleted,
}: Props) {
  const isEdit = Boolean(shift)

  const [selectedStaffId, setSelectedStaffId] = useState<string>(shift?.staff_id ?? staffId ?? '')
  const [shiftDate, setShiftDate] = useState<string>(shift?.date ?? date ?? '')
  const [startTime, setStartTime] = useState<string>(
    shift?.start_time?.slice(0, 5) ?? defaultStart ?? '09:00'
  )
  const [endTime, setEndTime] = useState<string>(
    shift?.end_time?.slice(0, 5) ?? defaultEnd ?? '17:00'
  )
  const [notes, setNotes] = useState<string>(shift?.notes ?? '')

  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [confirmDel, setConfirmDel] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setSelectedStaffId(shift?.staff_id ?? staffId ?? '')
    setShiftDate(shift?.date ?? date ?? '')
    setStartTime(shift?.start_time?.slice(0, 5) ?? defaultStart ?? '09:00')
    setEndTime(shift?.end_time?.slice(0, 5) ?? defaultEnd ?? '17:00')
    setNotes(shift?.notes ?? '')
    setError(null)
  }, [shift, staffId, date, defaultStart, defaultEnd, open])

  useEffect(() => {
    if (!toast) return undefined
    const t = setTimeout(() => setToast(null), 4000)
    return () => clearTimeout(t)
  }, [toast])

  const handleSave = async () => {
    setError(null)
    if (!selectedStaffId) {
      setError('Staff member is required')
      return
    }
    if (!shiftDate || !startTime || !endTime) {
      setError('Date, start, and end are required')
      return
    }
    if (!(endTime > startTime)) {
      setError('End time must be after start time')
      return
    }

    setSaving(true)
    try {
      const url = isEdit
        ? `/api/staff/${selectedStaffId}/shifts/${shift?.id}`
        : `/api/staff/${selectedStaffId}/shifts`
      const method = isEdit ? 'PUT' : 'POST'
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date: shiftDate,
          start_time: startTime,
          end_time: endTime,
          notes: notes.trim() || null,
        }),
      })
      if (res.status === 409) {
        const data = (await res.json()) as {
          message?: string
          conflicting_shift?: { start_time: string; end_time: string }
        }
        setToast(
          data.message ??
            `Conflicts with shift ${data.conflicting_shift?.start_time}–${data.conflicting_shift?.end_time}`
        )
        return
      }
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string }
        setError(data.error ?? 'Failed to save')
        return
      }
      const saved = (await res.json().catch(() => ({}))) as { availability_warning?: string | null }
      onSaved()
      if (saved.availability_warning) {
        // Stays open to show the warning, same convention as the conflict case above.
        setToast(saved.availability_warning)
        return
      }
      onClose()
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!shift) return
    setDeleting(true)
    try {
      const res = await fetch(`/api/staff/${selectedStaffId}/shifts/${shift.id}`, {
        method: 'DELETE',
      })
      if (!res.ok) {
        setToast('Failed to delete shift')
        return
      }
      onDeleted?.()
      onClose()
    } finally {
      setDeleting(false)
      setConfirmDel(false)
    }
  }

  return (
    <SlideOver
      onClose={onClose}
      open={open}
      title={
        <div>
          <div>{isEdit ? 'Edit shift' : 'Add shift'}</div>
          {staffName && !isEdit && (
            <p className="text-xs text-ink4 font-normal mt-0.5">for {staffName}</p>
          )}
        </div>
      }
    >
      {/* relative: confirmDel below positions against this panel's content
          area, not the full page — see Phase 15 notes on why this stays
          plain Tailwind instead of a nested Modal. */}
      <div className="relative">
        <div className="px-5 py-5 space-y-4">
          <div>
            <label className="block text-xs font-medium text-ink3 mb-1.5">Staff member *</label>
            <TextField
              select
              value={selectedStaffId}
              onChange={(e) => setSelectedStaffId(e.target.value)}
              fullWidth
              size="small"
            >
              <MenuItem value="">— Select —</MenuItem>
              {staffList.map((m) => (
                <MenuItem key={m.id} value={m.id}>
                  {m.name}
                </MenuItem>
              ))}
            </TextField>
          </div>

          <div>
            <label className="block text-xs font-medium text-ink3 mb-1.5">Date *</label>
            <TextField
              type="date"
              value={shiftDate}
              onChange={(e) => setShiftDate(e.target.value)}
              fullWidth
              size="small"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-ink3 mb-1.5">Start *</label>
              <TextField
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                fullWidth
                size="small"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-ink3 mb-1.5">End *</label>
              <TextField
                type="time"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                fullWidth
                size="small"
              />
            </div>
          </div>

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

          {error && (
            <p className="text-xs text-red-600 bg-red-50 border border-red-100 px-3 py-2 rounded-lg">
              {error}
            </p>
          )}

          <div className="flex justify-between items-center pt-2">
            <div>
              {isEdit && (
                <Button onClick={() => setConfirmDel(true)} size="small" color="error">
                  Delete
                </Button>
              )}
            </div>
            <div className="flex gap-2">
              <Button onClick={onClose} variant="outlined" color="inherit">
                Cancel
              </Button>
              <Button onClick={() => void handleSave()} disabled={saving} variant="contained">
                {saving ? 'Saving...' : isEdit ? 'Save' : 'Add'}
              </Button>
            </div>
          </div>
        </div>

        {confirmDel && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/30">
            <div className="bg-white rounded-xl shadow-2xl border border-border-brand w-full max-w-sm p-5 mx-4">
              <h3 className="text-base font-semibold text-ink mb-1">Delete shift?</h3>
              <p className="text-sm text-ink3 mb-5">This cannot be undone.</p>
              <div className="flex justify-end gap-2">
                <Button onClick={() => setConfirmDel(false)} variant="outlined" color="inherit">
                  Cancel
                </Button>
                <Button
                  onClick={() => void handleDelete()}
                  disabled={deleting}
                  variant="contained"
                  color="error"
                >
                  {deleting ? 'Deleting...' : 'Delete'}
                </Button>
              </div>
            </div>
          </div>
        )}

        {toast && (
          <div className="fixed top-4 right-4 z-[60] px-4 py-2 bg-red-50 text-red-700 text-sm rounded-lg shadow-lg border border-red-200 max-w-xs">
            {toast}
          </div>
        )}
      </div>
    </SlideOver>
  )
}
