import { describe, it, expect } from '@jest/globals'
import {
  ALLOWED_TRANSITIONS,
  INCIDENT_STATUSES,
  slaDueAt,
  requiresAuthorisation,
  canTransition,
  DEFAULT_SLA_MINUTES,
  DEFAULT_AUTH_THRESHOLD_CENTS,
} from './incidents.js'

const NOW = new Date('2026-09-15T12:00:00.000Z')

describe('slaDueAt', () => {
  it('derives a due time from severity', () => {
    expect(slaDueAt('critical', NOW).toISOString()).toBe('2026-09-15T13:00:00.000Z')
    expect(slaDueAt('high', NOW).toISOString()).toBe('2026-09-15T16:00:00.000Z')
  })

  it('lets a tenant override one severity without redefining the rest', () => {
    const due = slaDueAt('critical', NOW, { critical: 30 })
    expect(due.toISOString()).toBe('2026-09-15T12:30:00.000Z')
    // high is untouched by the override
    expect(slaDueAt('high', NOW, { critical: 30 }).toISOString()).toBe('2026-09-15T16:00:00.000Z')
  })

  it('has a duration for every severity', () => {
    for (const s of ['low', 'medium', 'high', 'critical'] as const) {
      expect(DEFAULT_SLA_MINUTES[s]).toBeGreaterThan(0)
    }
  })
})

describe('requiresAuthorisation', () => {
  it('needs a manager at or above the threshold', () => {
    expect(requiresAuthorisation(1000, 1000)).toBe(true)
    expect(requiresAuthorisation(1350, 1000)).toBe(true)
  })

  it('does not need one below the threshold', () => {
    expect(requiresAuthorisation(999, 1000)).toBe(false)
  })

  it('never needs one for a zero-cost report — friction stops people reporting', () => {
    expect(requiresAuthorisation(0, 1000)).toBe(false)
    expect(requiresAuthorisation(0, 0)).toBe(false)
  })

  it('defaults to a $10 threshold', () => {
    expect(DEFAULT_AUTH_THRESHOLD_CENTS).toBe(1000)
  })
})

describe('canTransition', () => {
  it('allows the ordinary path', () => {
    expect(canTransition('open', 'triaged')).toBe(true)
    expect(canTransition('triaged', 'in_progress')).toBe(true)
    expect(canTransition('in_progress', 'resolved')).toBe(true)
  })

  it('refuses to reopen a resolved incident', () => {
    expect(canTransition('resolved', 'open')).toBe(false)
  })

  it('allows cancelling from any live state', () => {
    expect(canTransition('open', 'cancelled')).toBe(true)
    expect(canTransition('in_progress', 'cancelled')).toBe(true)
  })

  it('refuses a no-op transition, so an event row is never written for nothing', () => {
    expect(canTransition('open', 'open')).toBe(false)
  })

  it('has an entry for every status, so a new one cannot throw at runtime', () => {
    // canTransition indexes ALLOWED_TRANSITIONS[from] directly. A status added
    // to INCIDENT_STATUSES without a transition entry would throw on the first
    // request that carried it, in production, rather than failing here.
    for (const status of INCIDENT_STATUSES) {
      expect(ALLOWED_TRANSITIONS[status]).toBeDefined()
    }
  })
})
