import { jest, describe, it, expect, beforeEach } from '@jest/globals'
import { randomUUID } from 'node:crypto'
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

const TENANT_ID = 'aaaaaaaa-0000-0000-0000-00000wd00001'

const fetchMock = jest.fn<typeof fetch>(async () => {
  return { ok: true, status: 200, text: async () => '' } as unknown as Response
})
// eslint-disable-next-line @typescript-eslint/no-explicit-any
;(globalThis as any).fetch = fetchMock

const { dispatchWebhook } = await import('./webhook-dispatcher.js')

beforeEach(() => {
  store = createStore()
  store.tables['webhook_subscriptions'] = []
  fetchMock.mockClear()
  fetchMock.mockResolvedValue({
    ok: true,
    status: 200,
    text: async () => '',
  } as unknown as Response)
})

describe('dispatchWebhook', () => {
  it('POSTs to subscriber URL with HMAC signature header when event_type matches', async () => {
    ;(store.tables['webhook_subscriptions'] as Row[]).push({
      id: randomUUID(),
      tenant_id: TENANT_ID,
      url: 'https://hook.test/recv',
      event_types: ['call.completed'],
      is_active: true,
      secret: 'test-secret',
    })

    await dispatchWebhook(TENANT_ID, 'call.completed', { duration: 30 })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, opts] = fetchMock.mock.calls[0]! as [string, RequestInit]
    expect(url).toBe('https://hook.test/recv')
    expect(opts.method).toBe('POST')
    const headers = opts.headers as Record<string, string>
    expect(headers['X-Webhook-Signature']).toBeDefined()
    expect(typeof headers['X-Webhook-Signature']).toBe('string')
    expect(headers['X-Webhook-Signature']!.length).toBeGreaterThan(0)
  })

  it('does NOT call fetch when event_type does not match subscription event_types', async () => {
    ;(store.tables['webhook_subscriptions'] as Row[]).push({
      id: randomUUID(),
      tenant_id: TENANT_ID,
      url: 'https://hook.test/recv',
      event_types: ['contact.created'],
      is_active: true,
      secret: 'test-secret',
    })

    await dispatchWebhook(TENANT_ID, 'call.completed', {})

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('does NOT call fetch for inactive subscription', async () => {
    ;(store.tables['webhook_subscriptions'] as Row[]).push({
      id: randomUUID(),
      tenant_id: TENANT_ID,
      url: 'https://hook.test/recv',
      event_types: ['call.completed'],
      is_active: false,
      secret: 'test-secret',
    })

    await dispatchWebhook(TENANT_ID, 'call.completed', {})

    expect(fetchMock).not.toHaveBeenCalled()
  })
})
