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

const fetchMock = jest.fn<typeof fetch>(async () => {
  return { ok: true, status: 200, text: async () => '' } as unknown as Response
})
// eslint-disable-next-line @typescript-eslint/no-explicit-any
;(globalThis as any).fetch = fetchMock

process.env['SUPABASE_URL'] = 'https://mock.supabase.co'
process.env['SUPABASE_SERVICE_ROLE_KEY'] = 'mock-service-key'

const TENANT_ID = 'aaaaaaaa-0000-0000-0000-0000wdlvr001'

const { processWebhookDelivery } = await import('./webhook-delivery-worker.js')

beforeEach(() => {
  store = createStore()
  store.tables['webhook_subscriptions'] = []
  store.tables['webhook_deliveries'] = []
  fetchMock.mockClear()
  fetchMock.mockResolvedValue({
    ok: true,
    status: 200,
    text: async () => '',
  } as unknown as Response)
})

describe('processWebhookDelivery', () => {
  it('POSTs the signed payload and marks the delivery delivered on a 2xx response', async () => {
    const subId = randomUUID()
    const deliveryId = randomUUID()
    ;(store.tables['webhook_subscriptions'] as Row[]).push({
      id: subId,
      tenant_id: TENANT_ID,
      url: 'https://hook.test/recv',
      secret: 'test-secret',
      is_active: true,
    })
    ;(store.tables['webhook_deliveries'] as Row[]).push({
      id: deliveryId,
      tenant_id: TENANT_ID,
      subscription_id: subId,
      event_type: 'call.completed',
      payload: { duration: 30 },
      status: 'pending',
      attempt_count: 0,
    })

    await processWebhookDelivery({ deliveryId })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, opts] = fetchMock.mock.calls[0]! as [string, RequestInit]
    expect(url).toBe('https://hook.test/recv')
    expect(opts.method).toBe('POST')
    const headers = opts.headers as Record<string, string>
    expect(headers['X-Webhook-Signature']!.length).toBeGreaterThan(0)

    const row = (store.tables['webhook_deliveries'] as Row[]).find((r) => r['id'] === deliveryId)
    expect(row?.['status']).toBe('delivered')
    expect(row?.['attempt_count']).toBe(1)
    expect(row?.['response_status']).toBe(200)
  })

  it('records the failure and throws (so BullMQ retries) on a non-2xx response', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: async () => '',
    } as unknown as Response)
    const subId = randomUUID()
    const deliveryId = randomUUID()
    ;(store.tables['webhook_subscriptions'] as Row[]).push({
      id: subId,
      tenant_id: TENANT_ID,
      url: 'https://hook.test/recv',
      secret: 'test-secret',
      is_active: true,
    })
    ;(store.tables['webhook_deliveries'] as Row[]).push({
      id: deliveryId,
      tenant_id: TENANT_ID,
      subscription_id: subId,
      event_type: 'call.completed',
      payload: {},
      status: 'pending',
      attempt_count: 0,
    })

    await expect(processWebhookDelivery({ deliveryId })).rejects.toThrow('Non-2xx response: 500')

    const row = (store.tables['webhook_deliveries'] as Row[]).find((r) => r['id'] === deliveryId)
    expect(row?.['status']).toBe('pending')
    expect(row?.['attempt_count']).toBe(1)
    expect(row?.['response_status']).toBe(500)
  })

  it('marks the delivery failed without attempting a fetch when the subscription is inactive', async () => {
    const subId = randomUUID()
    const deliveryId = randomUUID()
    ;(store.tables['webhook_subscriptions'] as Row[]).push({
      id: subId,
      tenant_id: TENANT_ID,
      url: 'https://hook.test/recv',
      secret: 'test-secret',
      is_active: false,
    })
    ;(store.tables['webhook_deliveries'] as Row[]).push({
      id: deliveryId,
      tenant_id: TENANT_ID,
      subscription_id: subId,
      event_type: 'call.completed',
      payload: {},
      status: 'pending',
      attempt_count: 0,
    })

    await processWebhookDelivery({ deliveryId })

    expect(fetchMock).not.toHaveBeenCalled()
    const row = (store.tables['webhook_deliveries'] as Row[]).find((r) => r['id'] === deliveryId)
    expect(row?.['status']).toBe('failed')
  })
})
