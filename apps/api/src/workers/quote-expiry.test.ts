import { jest, describe, it, expect, beforeEach } from '@jest/globals'
import { randomUUID } from 'node:crypto'
import {
  createStore,
  createMockSupabase,
  type MockStore,
  type Row,
} from '../routes/__test-support__/supabase-mock.js'

let store: MockStore = createStore()
const sendPushNotification = jest.fn(async () => undefined)

jest.unstable_mockModule('@supabase/supabase-js', () => ({
  createClient: () => createMockSupabase(store),
}))
jest.unstable_mockModule('../lib/push-client.js', () => ({ sendPushNotification }))

process.env['SUPABASE_URL'] = 'https://mock.supabase.co'
process.env['SUPABASE_SERVICE_ROLE_KEY'] = 'mock-service-key'

const TENANT_ID = 'aaaaaaaa-0000-0000-0000-000000qe0001'
const { scan } = await import('./quote-expiry-worker.js')

beforeEach(() => {
  store = createStore()
  store.tables['quotes'] = []
  sendPushNotification.mockClear()
})

describe('quote-expiry processor', () => {
  it('flips sent quote to expired when valid_until is past', async () => {
    const quoteId = randomUUID()
    store.tables['quotes']!.push({
      id: quoteId,
      tenant_id: TENANT_ID,
      quote_number: 'Q-2026-0001',
      status: 'sent',
      valid_until: new Date(Date.now() - 86400000).toISOString(),
    })

    await scan()

    const row = (store.tables['quotes'] as Row[]).find((r) => r['id'] === quoteId)
    expect(row?.['status']).toBe('expired')
    expect(sendPushNotification).toHaveBeenCalledTimes(1)
  })

  it('flips draft quote to expired when valid_until is past', async () => {
    const quoteId = randomUUID()
    store.tables['quotes']!.push({
      id: quoteId,
      tenant_id: TENANT_ID,
      quote_number: 'Q-2026-0002',
      status: 'draft',
      valid_until: new Date(Date.now() - 86400000).toISOString(),
    })

    await scan()

    const row = (store.tables['quotes'] as Row[]).find((r) => r['id'] === quoteId)
    expect(row?.['status']).toBe('expired')
  })

  it('does not expire quote with future valid_until', async () => {
    const quoteId = randomUUID()
    store.tables['quotes']!.push({
      id: quoteId,
      tenant_id: TENANT_ID,
      quote_number: 'Q-2026-0003',
      status: 'sent',
      valid_until: new Date(Date.now() + 86400000).toISOString(),
    })

    await scan()

    const row = (store.tables['quotes'] as Row[]).find((r) => r['id'] === quoteId)
    expect(row?.['status']).toBe('sent')
    expect(sendPushNotification).not.toHaveBeenCalled()
  })
})
