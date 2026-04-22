import { jest, describe, it, expect, beforeEach } from '@jest/globals'
import { randomUUID } from 'node:crypto'
import {
  createStore,
  createMockSupabase,
  type MockStore,
  type Row,
} from '../routes/__test-support__/supabase-mock.js'

let store: MockStore = createStore()
const dispatchWebhook = jest.fn(async () => undefined)
const sendPushNotification = jest.fn(async () => undefined)
const publishActivityEvent = jest.fn(async () => undefined)

jest.unstable_mockModule('@supabase/supabase-js', () => ({
  createClient: () => createMockSupabase(store),
}))
jest.unstable_mockModule('../lib/webhook-dispatcher.js', () => ({ dispatchWebhook }))
jest.unstable_mockModule('../lib/push-client.js', () => ({ sendPushNotification }))
jest.unstable_mockModule('../lib/ops-copilot-client.js', () => ({ publishActivityEvent }))

process.env['SUPABASE_URL'] = 'https://mock.supabase.co'
process.env['SUPABASE_SERVICE_ROLE_KEY'] = 'mock-service-key'
delete process.env['TELNYX_API_KEY']

const TENANT_ID = 'aaaaaaaa-0000-0000-0000-0000000ns001'
const { scan } = await import('./no-show-scanner.js')

beforeEach(() => {
  store = createStore()
  store.tables['appointments'] = []
  store.tables['contacts'] = []
  store.tables['locations'] = []
  dispatchWebhook.mockClear()
  sendPushNotification.mockClear()
  publishActivityEvent.mockClear()
})

describe('no-show-scanner processor', () => {
  it('flips appointment to no_show when past end_time + 15-min grace and within 24h', async () => {
    const apptId = randomUUID()
    store.tables['appointments']!.push({
      id: apptId,
      tenant_id: TENANT_ID,
      contact_id: null,
      status: 'scheduled',
      start_time: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
      end_time: new Date(Date.now() - 20 * 60 * 1000).toISOString(),
    })

    await scan()

    const row = (store.tables['appointments'] as Row[]).find((r) => r['id'] === apptId)
    expect(row?.['status']).toBe('no_show')
    expect(dispatchWebhook).toHaveBeenCalledTimes(1)
    expect(sendPushNotification).toHaveBeenCalledTimes(1)
  })

  it('does not flip appointment within grace period', async () => {
    const apptId = randomUUID()
    store.tables['appointments']!.push({
      id: apptId,
      tenant_id: TENANT_ID,
      contact_id: null,
      status: 'scheduled',
      start_time: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
      end_time: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
    })

    await scan()

    const row = (store.tables['appointments'] as Row[]).find((r) => r['id'] === apptId)
    expect(row?.['status']).toBe('scheduled')
    expect(dispatchWebhook).not.toHaveBeenCalled()
    expect(sendPushNotification).not.toHaveBeenCalled()
  })

  it('does not flip appointment older than 24h max age', async () => {
    const apptId = randomUUID()
    store.tables['appointments']!.push({
      id: apptId,
      tenant_id: TENANT_ID,
      contact_id: null,
      status: 'scheduled',
      start_time: new Date(Date.now() - 26 * 60 * 60 * 1000).toISOString(),
      end_time: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(),
    })

    await scan()

    const row = (store.tables['appointments'] as Row[]).find((r) => r['id'] === apptId)
    expect(row?.['status']).toBe('scheduled')
  })

  it('does not re-flip an already no_show appointment', async () => {
    const apptId = randomUUID()
    store.tables['appointments']!.push({
      id: apptId,
      tenant_id: TENANT_ID,
      contact_id: null,
      status: 'no_show',
      start_time: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
      end_time: new Date(Date.now() - 20 * 60 * 1000).toISOString(),
    })

    await scan()

    expect(dispatchWebhook).not.toHaveBeenCalled()
    expect(sendPushNotification).not.toHaveBeenCalled()
  })
})
