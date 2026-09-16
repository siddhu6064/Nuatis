import { describe, it, expect } from '@jest/globals'
import { severityColor, ackCountdownLabel, canCloseFromUi } from './types'

describe('severityColor', () => {
  it('makes SEV1 unmistakable', () => {
    expect(severityColor('sev1')).toBe('error')
    expect(severityColor('sev4')).toBe('default')
  })
})

describe('ackCountdownLabel', () => {
  it('counts down while there is time left', () => {
    const now = new Date('2026-09-15T10:00:00Z')
    expect(ackCountdownLabel('2026-09-15T10:10:00Z', now)).toBe('10m to ack')
  })

  it('says how late it is once the deadline passed', () => {
    const now = new Date('2026-09-15T10:20:00Z')
    expect(ackCountdownLabel('2026-09-15T10:00:00Z', now)).toBe('20m over')
  })

  it('shows nothing for a severity with no deadline', () => {
    // Rendering "no deadline" as a countdown would imply one exists.
    expect(ackCountdownLabel(null, new Date())).toBe('')
  })

  it('shows nothing for an unparseable deadline rather than NaN', () => {
    expect(ackCountdownLabel('not a date', new Date())).toBe('')
  })
})

describe('canCloseFromUi', () => {
  it('hides Close on a resolved SEV1 with no postmortem', () => {
    // The API refuses this anyway — the gate lives in the transition map. The
    // UI matches it so the button is not offered and then rejected.
    expect(canCloseFromUi({ severity: 'sev1', status: 'resolved', postmortem: null })).toBe(false)
  })

  it('hides Close on a postmortem_due SEV1 whose postmortem is only whitespace', () => {
    expect(canCloseFromUi({ severity: 'sev1', status: 'postmortem_due', postmortem: '   ' })).toBe(
      false
    )
  })

  it('offers Close once the postmortem is written', () => {
    expect(
      canCloseFromUi({
        severity: 'sev1',
        status: 'postmortem_due',
        postmortem: '## What happened',
      })
    ).toBe(true)
  })

  it('offers Close on a resolved SEV3 immediately', () => {
    expect(canCloseFromUi({ severity: 'sev3', status: 'resolved', postmortem: null })).toBe(true)
  })

  it('never offers Close on an incident that is still live', () => {
    expect(canCloseFromUi({ severity: 'sev3', status: 'mitigating', postmortem: null })).toBe(false)
    expect(canCloseFromUi({ severity: 'sev3', status: 'detected', postmortem: null })).toBe(false)
  })

  it('never offers Close on one already closed', () => {
    expect(canCloseFromUi({ severity: 'sev3', status: 'closed', postmortem: null })).toBe(false)
  })
})
