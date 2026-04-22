/**
 * Pure helper functions extracted from staff.ts for unit testing.
 * No Supabase, no Express — only deterministic input/output logic.
 */

export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
export const TIME_RE = /^\d{2}:\d{2}(:\d{2})?$/

export interface ShiftWindow {
  id?: string
  date: string
  start_time: string
  end_time: string
}

/**
 * Determines whether a new shift (start, end) conflicts with any existing
 * shift on the same day. Half-open interval: [start, end). Adjacent shifts
 * (end === otherStart or start === otherEnd) do NOT conflict.
 */
export function detectShiftConflict(
  newShift: { start_time: string; end_time: string },
  existing: ShiftWindow[],
  excludeShiftId?: string
): ShiftWindow | null {
  for (const e of existing) {
    if (excludeShiftId && e.id === excludeShiftId) continue
    const aStart = newShift.start_time
    const aEnd = newShift.end_time
    const bStart = e.start_time
    const bEnd = e.end_time
    if (aStart < bEnd && aEnd > bStart) return e
  }
  return null
}

export interface ShiftValidation {
  ok: true
  date?: string
  start_time?: string
  end_time?: string
  notes?: string | null
}

export interface ShiftValidationError {
  ok: false
  error: string
}

export function validateShiftBody(
  b: Record<string, unknown>,
  partial: boolean
): ShiftValidation | ShiftValidationError {
  const date = typeof b['date'] === 'string' ? b['date'] : null
  const startTime = typeof b['start_time'] === 'string' ? b['start_time'] : null
  const endTime = typeof b['end_time'] === 'string' ? b['end_time'] : null

  if (!partial) {
    if (!date || !DATE_RE.test(date)) return { ok: false, error: 'date must be YYYY-MM-DD' }
    if (!startTime || !TIME_RE.test(startTime))
      return { ok: false, error: 'start_time must be HH:MM' }
    if (!endTime || !TIME_RE.test(endTime)) return { ok: false, error: 'end_time must be HH:MM' }
  } else {
    if (date !== null && !DATE_RE.test(date)) return { ok: false, error: 'date must be YYYY-MM-DD' }
    if (startTime !== null && !TIME_RE.test(startTime))
      return { ok: false, error: 'start_time must be HH:MM' }
    if (endTime !== null && !TIME_RE.test(endTime))
      return { ok: false, error: 'end_time must be HH:MM' }
  }

  if (startTime && endTime && !(endTime > startTime)) {
    return { ok: false, error: 'end_time must be after start_time' }
  }

  const notes = typeof b['notes'] === 'string' ? b['notes'] : b['notes'] === null ? null : undefined

  const result: ShiftValidation = { ok: true }
  if (date) result.date = date
  if (startTime) result.start_time = startTime
  if (endTime) result.end_time = endTime
  if (notes !== undefined) result.notes = notes
  return result
}

export interface StaffBodyValidation {
  ok: true
  name?: string
  role?: string
}

export interface StaffBodyError {
  ok: false
  error: string
}

export function validateStaffCreateBody(
  b: Record<string, unknown>
): StaffBodyValidation | StaffBodyError {
  const name = typeof b['name'] === 'string' ? b['name'].trim() : ''
  const role = typeof b['role'] === 'string' ? b['role'].trim() : ''
  if (!name) return { ok: false, error: 'name is required' }
  if (!role) return { ok: false, error: 'role is required' }
  return { ok: true, name, role }
}
