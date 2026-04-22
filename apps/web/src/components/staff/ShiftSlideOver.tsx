'use client'

import { useState, useEffect } from 'react'
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
      onSaved()
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

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative ml-auto bg-white h-full w-full max-w-md border-l border-gray-200 shadow-xl overflow-y-auto">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-gray-900">
              {isEdit ? 'Edit shift' : 'Add shift'}
            </h2>
            {staffName && !isEdit && (
              <p className="text-xs text-gray-400 mt-0.5">for {staffName}</p>
            )}
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-700"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <div className="px-5 py-5 space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1.5">Staff member *</label>
            <select
              value={selectedStaffId}
              onChange={(e) => setSelectedStaffId(e.target.value)}
              className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white"
            >
              <option value="">— Select —</option>
              {staffList.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1.5">Date *</label>
            <input
              type="date"
              value={shiftDate}
              onChange={(e) => setShiftDate(e.target.value)}
              className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1.5">Start *</label>
              <input
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1.5">End *</label>
              <input
                type="time"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1.5">Notes</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2"
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
                <button
                  onClick={() => setConfirmDel(true)}
                  className="text-sm text-red-600 hover:text-red-700"
                >
                  Delete
                </button>
              )}
            </div>
            <div className="flex gap-2">
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

        {confirmDel && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/30">
            <div className="bg-white rounded-xl shadow-2xl border border-gray-200 w-full max-w-sm p-5 mx-4">
              <h3 className="text-base font-semibold text-gray-900 mb-1">Delete shift?</h3>
              <p className="text-sm text-gray-500 mb-5">This cannot be undone.</p>
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => setConfirmDel(false)}
                  className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  onClick={() => void handleDelete()}
                  disabled={deleting}
                  className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-60"
                >
                  {deleting ? 'Deleting...' : 'Delete'}
                </button>
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
    </div>
  )
}
