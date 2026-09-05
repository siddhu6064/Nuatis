import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals'
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
jest.unstable_mockModule('../lib/scanner-pause.js', () => ({
  getPausedTenants: async () => new Set<string>(),
}))

process.env['SUPABASE_URL'] = 'https://mock.supabase.co'
process.env['SUPABASE_SERVICE_ROLE_KEY'] = 'mock-service-key'

const TENANT_ID = 'aaaaaaaa-0000-0000-0000-00000cas1001'
const CONTACT_ID = 'bbbbbbbb-0000-0000-0000-00000cas1002'
const AUTOMATION_ID = 'auto-steps-1'

const { scan } = await import('./custom-automation-worker.js')

function seedAutomation(overrides: Row = {}): void {
  store.tables['custom_automations'] = [
    {
      id: AUTOMATION_ID,
      tenant_id: TENANT_ID,
      status: 'active',
      trigger_type: 'new_contact',
      trigger_config: {},
      action_type: 'send_webhook',
      action_config: { url: 'https://hooks.example.com/base' },
      run_count: 0,
      last_run_at: null,
      updated_at: new Date().toISOString(),
      ...overrides,
    },
  ]
}

function daysAgo(n: number): string {
  return new Date(Date.now() - n * 86400000).toISOString()
}

beforeEach(() => {
  store = createStore()
  seedAutomation()
  store.tables['contacts'] = [
    {
      id: CONTACT_ID,
      tenant_id: TENANT_ID,
      is_archived: false,
      created_at: new Date().toISOString(),
      tags: [],
    },
  ]
  store.tables['custom_automation_steps'] = []
  store.tables['custom_automation_enrollments'] = []
})

afterEach(() => {
  jest.restoreAllMocks()
})

describe('custom-automation-worker — multi-step enrollment', () => {
  it('creates an enrollment and fires the base action once when the automation has extra steps', async () => {
    store.tables['custom_automation_steps'] = [
      {
        id: 'step-1',
        automation_id: AUTOMATION_ID,
        tenant_id: TENANT_ID,
        step_order: 1,
        delay_days: 3,
        action_type: 'send_webhook',
        action_config: { url: 'https://hooks.example.com/step1' },
        condition_field: null,
      },
    ]
    const fetchMock = jest.fn(async () => ({ ok: true }) as Response)
    global.fetch = fetchMock as unknown as typeof fetch

    await scan()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://hooks.example.com/base')

    const enrollments = store.tables['custom_automation_enrollments'] as Row[]
    expect(enrollments).toHaveLength(1)
    expect(enrollments[0]?.['current_step']).toBe(1)
    expect(enrollments[0]?.['status']).toBe('active')
  })

  it('does not re-fire the base action on a second scan for an already-enrolled contact', async () => {
    store.tables['custom_automation_steps'] = [
      {
        id: 'step-1',
        automation_id: AUTOMATION_ID,
        tenant_id: TENANT_ID,
        step_order: 1,
        delay_days: 30,
        action_type: 'send_webhook',
        action_config: { url: 'https://hooks.example.com/step1' },
        condition_field: null,
      },
    ]
    const fetchMock = jest.fn(async () => ({ ok: true }) as Response)
    global.fetch = fetchMock as unknown as typeof fetch

    await scan()
    fetchMock.mockClear()
    await scan()

    // Step is not due (delay_days=30, just enrolled) and base already ran —
    // second scan should make zero calls.
    expect(fetchMock).not.toHaveBeenCalled()
    expect((store.tables['custom_automation_enrollments'] as Row[]).length).toBe(1)
  })
})

describe('custom-automation-worker — advanceSteps', () => {
  function seedEnrollment(overrides: Row = {}): void {
    store.tables['custom_automation_enrollments'] = [
      {
        id: 'enr-1',
        tenant_id: TENANT_ID,
        automation_id: AUTOMATION_ID,
        contact_id: CONTACT_ID,
        current_step: 1,
        status: 'active',
        last_step_at: daysAgo(5),
        enrolled_at: daysAgo(5),
        ...overrides,
      },
    ]
  }

  it('runs a due step, advances current_step, and marks completed when no further step exists', async () => {
    store.tables['custom_automation_steps'] = [
      {
        id: 'step-1',
        automation_id: AUTOMATION_ID,
        tenant_id: TENANT_ID,
        step_order: 1,
        delay_days: 3,
        action_type: 'send_webhook',
        action_config: { url: 'https://hooks.example.com/step1' },
        condition_field: null,
      },
    ]
    seedEnrollment()
    const fetchMock = jest.fn(async () => ({ ok: true }) as Response)
    global.fetch = fetchMock as unknown as typeof fetch

    await scan()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://hooks.example.com/step1')

    const enrollment = (store.tables['custom_automation_enrollments'] as Row[])[0]!
    expect(enrollment['current_step']).toBe(2)
    expect(enrollment['status']).toBe('completed')
  })

  it('does not run a step before its delay has elapsed', async () => {
    store.tables['custom_automation_steps'] = [
      {
        id: 'step-1',
        automation_id: AUTOMATION_ID,
        tenant_id: TENANT_ID,
        step_order: 1,
        delay_days: 10,
        action_type: 'send_webhook',
        action_config: { url: 'https://hooks.example.com/step1' },
        condition_field: null,
      },
    ]
    seedEnrollment({ last_step_at: daysAgo(2), enrolled_at: daysAgo(2) })
    const fetchMock = jest.fn(async () => ({ ok: true }) as Response)
    global.fetch = fetchMock as unknown as typeof fetch

    await scan()

    expect(fetchMock).not.toHaveBeenCalled()
    const enrollment = (store.tables['custom_automation_enrollments'] as Row[])[0]!
    expect(enrollment['current_step']).toBe(1)
  })

  it('skips the action but still advances the step when the condition evaluates false', async () => {
    store.tables['custom_automation_steps'] = [
      {
        id: 'step-1',
        automation_id: AUTOMATION_ID,
        tenant_id: TENANT_ID,
        step_order: 1,
        delay_days: 0,
        action_type: 'send_webhook',
        action_config: { url: 'https://hooks.example.com/step1' },
        condition_field: 'tags',
        condition_op: 'contains',
        condition_value: 'vip',
      },
    ]
    seedEnrollment()
    const fetchMock = jest.fn(async () => ({ ok: true }) as Response)
    global.fetch = fetchMock as unknown as typeof fetch

    await scan()

    expect(fetchMock).not.toHaveBeenCalled()
    const enrollment = (store.tables['custom_automation_enrollments'] as Row[])[0]!
    expect(enrollment['current_step']).toBe(2)
  })

  it('runs the action when the condition evaluates true', async () => {
    store.tables['contacts'] = [
      { id: CONTACT_ID, tenant_id: TENANT_ID, is_archived: false, tags: ['vip'] },
    ]
    store.tables['custom_automation_steps'] = [
      {
        id: 'step-1',
        automation_id: AUTOMATION_ID,
        tenant_id: TENANT_ID,
        step_order: 1,
        delay_days: 0,
        action_type: 'send_webhook',
        action_config: { url: 'https://hooks.example.com/step1' },
        condition_field: 'tags',
        condition_op: 'contains',
        condition_value: 'vip',
      },
    ]
    seedEnrollment()
    const fetchMock = jest.fn(async () => ({ ok: true }) as Response)
    global.fetch = fetchMock as unknown as typeof fetch

    await scan()

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('does not advance a stopped enrollment', async () => {
    store.tables['custom_automation_steps'] = [
      {
        id: 'step-1',
        automation_id: AUTOMATION_ID,
        tenant_id: TENANT_ID,
        step_order: 1,
        delay_days: 0,
        action_type: 'send_webhook',
        action_config: { url: 'https://hooks.example.com/step1' },
        condition_field: null,
      },
    ]
    seedEnrollment({ status: 'stopped' })
    const fetchMock = jest.fn(async () => ({ ok: true }) as Response)
    global.fetch = fetchMock as unknown as typeof fetch

    await scan()

    expect(fetchMock).not.toHaveBeenCalled()
  })
})
