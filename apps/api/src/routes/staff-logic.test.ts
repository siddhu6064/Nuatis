import { describe, it, expect } from '@jest/globals'
import { detectShiftConflict, validateShiftBody, validateStaffCreateBody } from './staff-logic.js'

// ── Conflict detection (4 tests) ────────────────────────────────────────────

describe('detectShiftConflict', () => {
  const existing = [{ id: 'shift-1', date: '2026-04-21', start_time: '09:00', end_time: '12:00' }]

  it('overlapping shifts: start < existing_end AND end > existing_start → conflict', () => {
    const result = detectShiftConflict({ start_time: '11:00', end_time: '14:00' }, existing)
    expect(result).not.toBeNull()
    expect(result?.id).toBe('shift-1')
  })

  it('non-overlapping before: end <= existing_start → no conflict', () => {
    const result = detectShiftConflict({ start_time: '07:00', end_time: '09:00' }, existing)
    expect(result).toBeNull()
  })

  it('non-overlapping after: start >= existing_end → no conflict', () => {
    const result = detectShiftConflict({ start_time: '12:00', end_time: '15:00' }, existing)
    expect(result).toBeNull()
  })

  it('adjacent times (end === existing_start) do not conflict', () => {
    const result = detectShiftConflict({ start_time: '07:00', end_time: '09:00' }, existing)
    expect(result).toBeNull()
  })

  it('excludeShiftId skips self when checking for update conflicts', () => {
    const result = detectShiftConflict(
      { start_time: '09:30', end_time: '10:30' },
      existing,
      'shift-1'
    )
    expect(result).toBeNull()
  })
})

// ── Staff + shift body validators ───────────────────────────────────────────

describe('validateStaffCreateBody', () => {
  it('accepts a valid body', () => {
    const result = validateStaffCreateBody({ name: 'Dr. Smith', role: 'Dentist' })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.name).toBe('Dr. Smith')
      expect(result.role).toBe('Dentist')
    }
  })

  it('rejects missing name', () => {
    const result = validateStaffCreateBody({ role: 'Dentist' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/name/i)
  })

  it('rejects missing role', () => {
    const result = validateStaffCreateBody({ name: 'Dr. Smith' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/role/i)
  })
})

describe('validateShiftBody', () => {
  it('accepts a valid full body', () => {
    const result = validateShiftBody(
      { date: '2026-04-21', start_time: '09:00', end_time: '17:00' },
      false
    )
    expect(result.ok).toBe(true)
  })

  it('rejects end_time <= start_time', () => {
    const result = validateShiftBody(
      { date: '2026-04-21', start_time: '17:00', end_time: '09:00' },
      false
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/end_time/i)
  })

  it('rejects malformed date', () => {
    const result = validateShiftBody(
      { date: 'not-a-date', start_time: '09:00', end_time: '17:00' },
      false
    )
    expect(result.ok).toBe(false)
  })
})
