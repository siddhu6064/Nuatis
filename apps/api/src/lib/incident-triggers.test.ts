import { jest, describe, it, expect, beforeEach } from '@jest/globals'
import {
  createStore,
  createMockSupabase,
  type MockStore,
  type Row,
} from '../routes/__test-support__/supabase-mock.js'

let store: MockStore = createStore()

jest.unstable_mockModule('@supabase/supabase-js', () => ({
  createClient: () => createMockSupabase(store),
}))

process.env['SUPABASE_URL'] = 'https://mock.supabase.co'
process.env['SUPABASE_SERVICE_ROLE_KEY'] = 'mock-service-key'

const TENANT_ID = 'aaaaaaaa-0000-0000-0000-00000trig001'
const { fireIncidentTrigger, runIncidentTrigger, INCIDENT_SAFE_ACTIONS } =
  await import('./incident-triggers.js')

const INCIDENT = {
  id: 'inc-1',
  tenant_id: TENANT_ID,
  reference: 'INC-1001',
  severity: 'critical',
  type_key: 'equipment',
  status: 'open',
}

function automation(overrides: Record<string, unknown> = {}) {
  return {
    id: 'auto-1',
    tenant_id: TENANT_ID,
    status: 'active',
    trigger_type: 'incident_created',
    trigger_config: {},
    action_type: 'create_task',
    action_config: { title: 'Call the engineer' },
    run_count: 0,
    last_run_at: null,
    updated_at: new Date().toISOString(),
    ...overrides,
  }
}

beforeEach(() => {
  store = createStore()
  store.tables['custom_automations'] = []
  store.tables['tasks'] = []
})

describe('runIncidentTrigger', () => {
  it('creates a task linked back to the incident that caused it', async () => {
    store.tables['custom_automations'] = [automation()]

    await runIncidentTrigger(TENANT_ID, 'incident_created', INCIDENT)

    const tasks = (store.tables['tasks'] ?? []) as Row[]
    expect(tasks).toHaveLength(1)
    expect(tasks[0]!['incident_id']).toBe('inc-1')
    expect(tasks[0]!['title']).toBe('Call the engineer')
    // Contactless on purpose — a broken fryer has no customer attached.
    expect(tasks[0]!['contact_id']).toBeNull()
  })

  it('writes a task the tasks table will actually accept', async () => {
    // The mock does not validate columns, so this pins the payload against the
    // real schema: status is open/in_progress/done and the column is due_date.
    store.tables['custom_automations'] = [automation()]

    await runIncidentTrigger(TENANT_ID, 'incident_created', INCIDENT)

    const task = ((store.tables['tasks'] ?? []) as Row[])[0]!
    expect(task['status']).toBe('open')
    expect(task['due_date']).toEqual(expect.any(String))
    expect(task).not.toHaveProperty('due_at')
  })

  it('ignores another tenant"s automation', async () => {
    store.tables['custom_automations'] = [automation({ tenant_id: 'someone-else' })]

    await runIncidentTrigger(TENANT_ID, 'incident_created', INCIDENT)

    expect(store.tables['tasks']).toHaveLength(0)
  })

  it('ignores a paused automation', async () => {
    store.tables['custom_automations'] = [automation({ status: 'paused' })]

    await runIncidentTrigger(TENANT_ID, 'incident_created', INCIDENT)

    expect(store.tables['tasks']).toHaveLength(0)
  })

  it('ignores an automation listening for a different incident event', async () => {
    store.tables['custom_automations'] = [automation({ trigger_type: 'incident_breached' })]

    await runIncidentTrigger(TENANT_ID, 'incident_created', INCIDENT)

    expect(store.tables['tasks']).toHaveLength(0)
  })

  it('refuses to run an action that needs a contact', async () => {
    // send_sms has nowhere to send. Running it would insert an sms_messages row
    // with a null contact_id, which is worse than doing nothing.
    store.tables['custom_automations'] = [automation({ action_type: 'send_sms' })]
    store.tables['sms_messages'] = []

    await runIncidentTrigger(TENANT_ID, 'incident_created', INCIDENT)

    expect(store.tables['sms_messages']).toHaveLength(0)
  })

  it('records the run so the automations list shows it fired', async () => {
    store.tables['custom_automations'] = [automation()]

    await runIncidentTrigger(TENANT_ID, 'incident_created', INCIDENT)

    const auto = (store.tables['custom_automations'] as Row[])[0]!
    expect(auto['run_count']).toBe(1)
    expect(auto['last_run_at']).toEqual(expect.any(String))
  })

  it('runs every matching automation, not just the first', async () => {
    store.tables['custom_automations'] = [
      automation({ id: 'auto-1' }),
      automation({ id: 'auto-2', action_config: { title: 'Log it' } }),
    ]

    await runIncidentTrigger(TENANT_ID, 'incident_created', INCIDENT)

    expect(store.tables['tasks']).toHaveLength(2)
  })

  it('keeps going when one automation fails', async () => {
    // One tenant's broken webhook must not cost the others their task.
    store.tables['custom_automations'] = [
      automation({ id: 'auto-1', action_type: 'send_webhook', action_config: {} }),
      automation({ id: 'auto-2' }),
    ]

    await runIncidentTrigger(TENANT_ID, 'incident_created', INCIDENT)

    expect(store.tables['tasks']).toHaveLength(1)
  })

  it('names the contact-free actions it supports', () => {
    // Guards against an action being added to the engine and silently
    // inheriting incident triggers it cannot serve.
    expect([...INCIDENT_SAFE_ACTIONS].sort()).toEqual(['create_task', 'send_webhook'])
  })
})

describe('fireIncidentTrigger', () => {
  it('never throws when the lookup fails', () => {
    // A failed trigger must not fail the incident report that fired it. The
    // incident is the thing that matters; the automation is a bonus.
    store.tables['custom_automations'] = []
    expect(() => fireIncidentTrigger(TENANT_ID, 'incident_created', INCIDENT)).not.toThrow()
  })

  it('is fire-and-forget — it returns before the work settles', () => {
    store.tables['custom_automations'] = [automation()]

    fireIncidentTrigger(TENANT_ID, 'incident_created', INCIDENT)

    expect(store.tables['tasks']).toHaveLength(0)
  })
})
