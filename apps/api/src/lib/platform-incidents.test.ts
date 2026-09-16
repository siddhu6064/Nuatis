import { jest, describe, it, expect, beforeEach } from '@jest/globals'
import {
  createStore,
  createMockSupabase,
  type MockStore,
} from '../routes/__test-support__/supabase-mock.js'

let store: MockStore = createStore()
jest.unstable_mockModule('@supabase/supabase-js', () => ({
  createClient: () => createMockSupabase(store),
}))

process.env['SUPABASE_URL'] = 'https://mock.supabase.co'
process.env['SUPABASE_SERVICE_ROLE_KEY'] = 'mock-service-key'

const {
  ACK_TARGET_MINUTES,
  ackDueAt,
  requiresPostmortem,
  canTransition,
  generatePlatformReference,
} = await import('./platform-incidents.js')

beforeEach(() => {
  store = createStore()
  store.tables['platform_incidents'] = []
})

describe('ack targets', () => {
  it('gives SEV1 fifteen minutes, because SEV1 means nobody can take money', () => {
    expect(ACK_TARGET_MINUTES.sev1).toBe(15)
  })

  it('gives SEV2 an hour and SEV3 a business day', () => {
    expect(ACK_TARGET_MINUTES.sev2).toBe(60)
    expect(ACK_TARGET_MINUTES.sev3).toBe(60 * 8)
  })

  it('gives SEV4 no deadline at all', () => {
    // Best effort. A deadline nobody intends to meet is noise that teaches
    // people to ignore the real ones.
    expect(ACK_TARGET_MINUTES.sev4).toBeNull()
    expect(ackDueAt('sev4', new Date())).toBeNull()
  })

  it('counts the deadline from detection', () => {
    const detected = new Date('2026-09-15T10:00:00.000Z')
    expect(ackDueAt('sev1', detected)!.toISOString()).toBe('2026-09-15T10:15:00.000Z')
  })
})

describe('postmortem gate', () => {
  it('requires a postmortem for SEV1 and SEV2', () => {
    expect(requiresPostmortem('sev1')).toBe(true)
    expect(requiresPostmortem('sev2')).toBe(true)
  })

  it('does not for SEV3 and SEV4', () => {
    expect(requiresPostmortem('sev3')).toBe(false)
    expect(requiresPostmortem('sev4')).toBe(false)
  })

  it('sends a resolved SEV1 to postmortem_due, never straight to closed', () => {
    // This rule is the only thing standing between "we had an outage" and
    // "we learned something", so it lives in the transition map rather than
    // in anyone's discipline.
    expect(canTransition('resolved', 'closed', 'sev1')).toBe(false)
    expect(canTransition('resolved', 'postmortem_due', 'sev1')).toBe(true)
    expect(canTransition('postmortem_due', 'closed', 'sev1')).toBe(true)
  })

  it('lets a resolved SEV3 close directly', () => {
    expect(canTransition('resolved', 'closed', 'sev3')).toBe(true)
  })

  it('refuses a no-op transition so no empty event row is written', () => {
    expect(canTransition('mitigating', 'mitigating', 'sev2')).toBe(false)
  })

  it('refuses reopening a closed incident', () => {
    expect(canTransition('closed', 'detected', 'sev1')).toBe(false)
    expect(canTransition('closed', 'mitigating', 'sev1')).toBe(false)
  })

  it('allows skipping mitigating when a fix was immediate', () => {
    expect(canTransition('acknowledged', 'resolved', 'sev2')).toBe(true)
  })

  it('refuses moving backwards from mitigating to acknowledged', () => {
    // Status is a record of what happened, not a cursor someone drags around.
    expect(canTransition('mitigating', 'acknowledged', 'sev2')).toBe(false)
  })
})

describe('generatePlatformReference', () => {
  it('takes the max numerically, so the 1000th incident of a year does not collide', async () => {
    // Zero-padding to three means "SEV-2026-1000" sorts BELOW "SEV-2026-999",
    // so ordering by reference would hand back 999 forever and collide on the
    // unique index every time.
    store.tables['platform_incidents'] = [
      { reference: 'SEV-2026-999' },
      { reference: 'SEV-2026-1000' },
    ]
    expect(await generatePlatformReference(new Date('2026-05-01T00:00:00Z'))).toBe('SEV-2026-1001')
  })

  it('starts at 001 for a fresh year', async () => {
    store.tables['platform_incidents'] = []
    expect(await generatePlatformReference(new Date('2027-01-01T00:00:00Z'))).toBe('SEV-2027-001')
  })

  it('ignores a hand-edited reference rather than producing SEV-YYYY-NaN', async () => {
    store.tables['platform_incidents'] = [
      { reference: 'SEV-2026-oops' },
      { reference: 'SEV-2026-004' },
    ]
    expect(await generatePlatformReference(new Date('2026-05-01T00:00:00Z'))).toBe('SEV-2026-005')
  })
})
