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

const TENANT_ID = 'aaaaaaaa-0000-0000-0000-00000wh1001'
const CONTACT_ID = 'bbbbbbbb-0000-0000-0000-00000wh1002'

const { scan } = await import('./custom-automation-worker.js')

function seedAutomation(overrides: Row = {}): void {
  store.tables['custom_automations'] = [
    {
      id: 'auto-1',
      tenant_id: TENANT_ID,
      status: 'active',
      trigger_type: 'new_contact',
      trigger_config: {},
      action_type: 'send_webhook',
      action_config: { url: 'https://hooks.example.com/inbound' },
      run_count: 0,
      last_run_at: null,
      updated_at: new Date().toISOString(),
      ...overrides,
    },
  ]
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
    },
  ]
})

afterEach(() => {
  jest.restoreAllMocks()
})

describe('custom-automation-worker — send_webhook action', () => {
  it('POSTs contact/trigger data to the configured url', async () => {
    const fetchMock = jest.fn(async () => ({ ok: true }) as Response)
    global.fetch = fetchMock as unknown as typeof fetch

    await scan()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, opts] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://hooks.example.com/inbound')
    expect(opts.method).toBe('POST')
    const body = JSON.parse(opts.body as string) as Record<string, unknown>
    expect(body['tenant_id']).toBe(TENANT_ID)
    expect(body['contact_id']).toBe(CONTACT_ID)
    expect(body['trigger_type']).toBe('new_contact')
  })

  it('skips without crashing when action_config.url is missing', async () => {
    seedAutomation({ action_config: {} })
    const fetchMock = jest.fn(async () => ({ ok: true }) as Response)
    global.fetch = fetchMock as unknown as typeof fetch

    await scan()

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('does not throw when the fetch itself fails', async () => {
    const fetchMock = jest.fn(async () => {
      throw new Error('network down')
    })
    global.fetch = fetchMock as unknown as typeof fetch

    await expect(scan()).resolves.toBeUndefined()
  })
})
