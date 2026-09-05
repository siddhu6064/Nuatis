import { jest, describe, it, expect, beforeEach } from '@jest/globals'
import { randomUUID } from 'node:crypto'
import {
  createStore,
  createMockSupabase,
  type MockStore,
  type Row,
} from '../routes/__test-support__/supabase-mock.js'

let store: MockStore = createStore()
const publishActivityEvent = jest.fn(async () => undefined)

jest.unstable_mockModule('@supabase/supabase-js', () => ({
  createClient: () => createMockSupabase(store),
}))
jest.unstable_mockModule('../lib/ops-copilot-client.js', () => ({ publishActivityEvent }))

process.env['SUPABASE_URL'] = 'https://mock.supabase.co'
process.env['SUPABASE_SERVICE_ROLE_KEY'] = 'mock-service-key'

const TENANT_ID = 'aaaaaaaa-0000-0000-0000-000000ls1001'
const { scan } = await import('./lead-stalled-scanner.js')

beforeEach(() => {
  store = createStore()
  store.tables['contacts'] = []
  store.tables['pipeline_stages'] = []
  publishActivityEvent.mockClear()
})

describe('lead-stalled-scanner scan()', () => {
  it('publishes lead.stalled event for contact stuck in non-terminal stage past 7 days', async () => {
    const contactId = randomUUID()
    ;(store.tables['contacts'] as Row[]).push({
      id: contactId,
      tenant_id: TENANT_ID,
      full_name: 'Stalled Sam',
      is_archived: false,
      updated_at: new Date(Date.now() - 8 * 86400000).toISOString(),
      last_contacted: null,
      pipeline_stage: 'Qualified',
    })
    ;(store.tables['pipeline_stages'] as Row[]).push({
      id: randomUUID(),
      tenant_id: TENANT_ID,
      name: 'Qualified',
      is_terminal: false,
    })

    await scan()

    expect(publishActivityEvent).toHaveBeenCalledTimes(1)
    const call = publishActivityEvent.mock.calls[0]![0] as { event_type?: string }
    expect(call.event_type).toBe('lead.stalled')
  })

  it('skips contact in terminal stage (won/lost)', async () => {
    const contactId = randomUUID()
    ;(store.tables['contacts'] as Row[]).push({
      id: contactId,
      tenant_id: TENANT_ID,
      full_name: 'Terminal Ted',
      is_archived: false,
      updated_at: new Date(Date.now() - 8 * 86400000).toISOString(),
      last_contacted: null,
      pipeline_stage: 'Closed Won',
    })
    ;(store.tables['pipeline_stages'] as Row[]).push({
      id: randomUUID(),
      tenant_id: TENANT_ID,
      name: 'Closed Won',
      is_terminal: true,
    })

    await scan()

    expect(publishActivityEvent).not.toHaveBeenCalled()
  })

  it('skips contact updated within 7 days', async () => {
    const contactId = randomUUID()
    ;(store.tables['contacts'] as Row[]).push({
      id: contactId,
      tenant_id: TENANT_ID,
      full_name: 'Recent Rita',
      is_archived: false,
      updated_at: new Date(Date.now() - 3 * 86400000).toISOString(),
      last_contacted: null,
    })

    await scan()

    expect(publishActivityEvent).not.toHaveBeenCalled()
  })
})
