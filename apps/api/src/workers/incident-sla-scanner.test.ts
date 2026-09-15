import { jest, describe, it, expect, beforeEach } from '@jest/globals'
import {
  createStore,
  createMockSupabase,
  type MockStore,
} from '../routes/__test-support__/supabase-mock.js'

let store: MockStore = createStore()
const notifyOwner = jest.fn<() => Promise<void>>()
const getPausedTenants = jest.fn<() => Promise<Set<string>>>()

jest.unstable_mockModule('@supabase/supabase-js', () => ({
  createClient: () => createMockSupabase(store),
}))
jest.unstable_mockModule('../lib/notifications.js', () => ({ notifyOwner }))
jest.unstable_mockModule('../lib/scanner-pause.js', () => ({
  getPausedTenants,
  isScannerPaused: jest.fn(),
  getActivePause: jest.fn(),
}))

const TENANT_ID = 'aaaaaaaa-0000-0000-0000-00000sla0001'
process.env['SUPABASE_URL'] = 'https://mock.supabase.co'
process.env['SUPABASE_SERVICE_ROLE_KEY'] = 'mock-service-key'

const { scan } = await import('./incident-sla-scanner.js')

const PAST = '2026-01-01T10:00:00.000Z'
const FUTURE = '2099-01-01T00:00:00.000Z'

function incident(overrides: Record<string, unknown> = {}) {
  return {
    id: `inc-${Math.random().toString(36).slice(2, 9)}`,
    tenant_id: TENANT_ID,
    reference: 'INC-1001',
    severity: 'critical',
    type_key: 'equipment',
    status: 'open',
    assigned_to_user_id: null,
    sla_due_at: PAST,
    sla_breached_at: null,
    ...overrides,
  }
}

beforeEach(() => {
  store = createStore()
  notifyOwner.mockClear()
  notifyOwner.mockResolvedValue(undefined)
  getPausedTenants.mockClear()
  getPausedTenants.mockResolvedValue(new Set<string>())
  store.tables['incidents'] = []
})

describe('incident-sla-scanner', () => {
  it('selects only live incidents past their SLA', async () => {
    store.tables['incidents'] = [
      incident({ id: 'overdue-open' }),
      incident({ id: 'overdue-resolved', status: 'resolved' }),
      incident({ id: 'overdue-cancelled', status: 'cancelled' }),
      incident({ id: 'not-yet', sla_due_at: FUTURE }),
    ]

    await scan()

    expect(notifyOwner).toHaveBeenCalledTimes(1)
    expect(
      store.tables['incidents']!.find((i) => i['id'] === 'overdue-open')!['sla_breached_at']
    ).toBeTruthy()
    expect(
      store.tables['incidents']!.find((i) => i['id'] === 'overdue-resolved')!['sla_breached_at']
    ).toBeNull()
  })

  it('notifies once, not on every tick', async () => {
    store.tables['incidents'] = [incident()]

    await scan()
    await scan()

    expect(notifyOwner).toHaveBeenCalledTimes(1)
  })

  it('skips paused tenants without stamping them', async () => {
    // Stamping a paused tenant's incident would mean unpausing silently
    // swallows the alert: it is already marked breached, so it never fires.
    store.tables['incidents'] = [incident()]
    getPausedTenants.mockResolvedValue(new Set([TENANT_ID]))

    await scan()

    expect(notifyOwner).not.toHaveBeenCalled()
    expect(store.tables['incidents']![0]!['sla_breached_at']).toBeNull()
  })

  it('does not notify when nothing has breached', async () => {
    store.tables['incidents'] = [incident({ sla_due_at: FUTURE })]

    await scan()

    expect(notifyOwner).not.toHaveBeenCalled()
  })

  it('notifies each tenant separately rather than once for all', async () => {
    store.tables['incidents'] = [
      incident({ id: 'a', tenant_id: 'tenant-a' }),
      incident({ id: 'b', tenant_id: 'tenant-b' }),
    ]

    await scan()

    expect(notifyOwner).toHaveBeenCalledTimes(2)
  })

  it('sends one notification per tenant, not per incident', async () => {
    // A kitchen that falls behind generates a dozen breaches at once, and a
    // dozen pushes is noise.
    store.tables['incidents'] = [incident(), incident(), incident()]

    await scan()

    expect(notifyOwner).toHaveBeenCalledTimes(1)
    const [, , payload] = notifyOwner.mock.calls[0] as unknown as [
      string,
      string,
      { pushTitle?: string },
    ]
    expect(payload.pushTitle).toContain('3')
  })

  it('never passes an SMS body — notifyOwner cannot send one', async () => {
    // lib/notifications.ts has its SMS branch commented out pending a personal
    // phone field on users. Passing smsBody would be silently ignored and
    // would imply a channel that does not work.
    store.tables['incidents'] = [incident()]

    await scan()

    const [, , payload] = notifyOwner.mock.calls[0] as unknown as [
      string,
      string,
      Record<string, unknown>,
    ]
    expect('smsBody' in payload).toBe(false)
  })

  it('does not throw when the query fails', async () => {
    // A scanner that throws takes the worker down with it.
    store.tables['incidents'] = [incident()]
    getPausedTenants.mockRejectedValue(new Error('redis is gone'))

    await expect(scan()).resolves.toBeUndefined()
  })
})

function rule(overrides: Record<string, unknown> = {}) {
  return {
    id: 'r1',
    tenant_id: TENANT_ID,
    when_event: 'breached',
    match_severity: 'critical',
    match_type_key: null,
    action: 'assign_to',
    target_user_id: 'user-oncall',
    delay_minutes: 0,
    enabled: true,
    ...overrides,
  }
}

function minutesAgo(n: number): string {
  return new Date(Date.now() - n * 60_000).toISOString()
}

describe('escalation rules', () => {
  beforeEach(() => {
    store.tables['incident_rules'] = []
    store.tables['incident_events'] = []
  })

  it('applies an assign_to rule on breach', async () => {
    store.tables['incidents'] = [incident({ severity: 'critical' })]
    store.tables['incident_rules'] = [rule()]

    await scan()

    expect(store.tables['incidents']![0]!['assigned_to_user_id']).toBe('user-oncall')
  })

  it('ignores a rule belonging to another tenant', async () => {
    store.tables['incidents'] = [incident({ severity: 'critical' })]
    store.tables['incident_rules'] = [
      rule({ tenant_id: 'someone-else', target_user_id: 'their-user' }),
    ]

    await scan()

    expect(store.tables['incidents']![0]!['assigned_to_user_id']).toBeNull()
  })

  it('ignores a disabled rule', async () => {
    store.tables['incidents'] = [incident({ severity: 'critical' })]
    store.tables['incident_rules'] = [rule({ enabled: false })]

    await scan()

    expect(store.tables['incidents']![0]!['assigned_to_user_id']).toBeNull()
  })

  it('does not overwrite an assignee a human already chose', async () => {
    // A rule that reassigns work someone already picked up is how automation
    // gets turned off.
    store.tables['incidents'] = [
      incident({ severity: 'critical', assigned_to_user_id: 'user-dana' }),
    ]
    store.tables['incident_rules'] = [rule()]

    await scan()

    expect(store.tables['incidents']![0]!['assigned_to_user_id']).toBe('user-dana')
  })

  it('matches on type_key as well as severity', async () => {
    store.tables['incidents'] = [incident({ severity: 'low', type_key: 'equipment' })]
    store.tables['incident_rules'] = [
      rule({ match_severity: null, match_type_key: 'equipment', target_user_id: 'user-maint' }),
    ]

    await scan()

    expect(store.tables['incidents']![0]!['assigned_to_user_id']).toBe('user-maint')
  })

  it('writes an event so the timeline shows the rule acted, not a person', async () => {
    store.tables['incidents'] = [incident({ severity: 'critical' })]
    store.tables['incident_rules'] = [rule()]

    await scan()

    const events = store.tables['incident_events'] ?? []
    expect(events).toHaveLength(1)
    expect(events[0]!['actor_kind']).toBe('system')
    expect((events[0]!['detail'] as Record<string, unknown>)['by_rule']).toBe('r1')
  })

  it('honours a notify_owner rule instead of silently doing nothing', async () => {
    // The schema allows two actions. Handling only assign_to would leave a
    // configured notify_owner rule looking active while doing nothing.
    store.tables['incidents'] = [incident({ severity: 'critical' })]
    store.tables['incident_rules'] = [rule({ action: 'notify_owner', target_user_id: null })]

    await scan()

    const escalations = notifyOwner.mock.calls.filter(
      (c) => (c as unknown as string[])[1] === 'incident_escalated'
    )
    expect(escalations).toHaveLength(1)
    expect(store.tables['incidents']![0]!['assigned_to_user_id']).toBeNull()
  })

  it('holds a delayed rule until its delay has elapsed', async () => {
    store.tables['incidents'] = [incident({ severity: 'critical', sla_breached_at: minutesAgo(5) })]
    store.tables['incident_rules'] = [rule({ delay_minutes: 30 })]

    await scan()

    expect(store.tables['incidents']![0]!['assigned_to_user_id']).toBeNull()
  })

  it('fires a delayed rule on a later tick, once the delay has passed', async () => {
    // The whole point of a delay is "escalate if nobody has picked this up in
    // 30 minutes", which only works if the scanner revisits breached rows.
    store.tables['incidents'] = [
      incident({ severity: 'critical', sla_breached_at: minutesAgo(40) }),
    ]
    store.tables['incident_rules'] = [rule({ delay_minutes: 30 })]

    await scan()

    expect(store.tables['incidents']![0]!['assigned_to_user_id']).toBe('user-oncall')
  })

  it('applies a rule once, not on every tick after the breach', async () => {
    store.tables['incidents'] = [incident({ severity: 'critical' })]
    store.tables['incident_rules'] = [rule({ action: 'notify_owner', target_user_id: null })]

    await scan()
    await scan()
    await scan()

    const escalations = notifyOwner.mock.calls.filter(
      (c) => (c as unknown as string[])[1] === 'incident_escalated'
    )
    expect(escalations).toHaveLength(1)
  })

  it('does not re-notify the owner of a breach it has already announced', async () => {
    // Revisiting breached rows for delayed rules must not resurrect the
    // once-only breach notification.
    store.tables['incidents'] = [incident({ sla_breached_at: minutesAgo(40) })]

    await scan()

    expect(notifyOwner).not.toHaveBeenCalled()
  })
})
