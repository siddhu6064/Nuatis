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

// dispatchWebhook no longer calls fetch directly — it inserts a
// webhook_deliveries row and enqueues a job; the actual HTTP POST happens in
// workers/webhook-delivery-worker.ts (covered by its own test), driven by
// BullMQ's own retry/backoff instead of a single inline attempt. Mock the
// queue the same way every other test in this codebase mocks a BullMQ queue
// module (see lead-score-queue.js usage elsewhere) rather than hitting Redis.
const addMock = jest.fn<(...args: unknown[]) => Promise<unknown>>(async () => ({}))
jest.unstable_mockModule('./webhook-delivery-queue.js', () => ({
  getWebhookDeliveryQueue: () => ({ add: addMock }),
}))

process.env['SUPABASE_URL'] = 'https://mock.supabase.co'
process.env['SUPABASE_SERVICE_ROLE_KEY'] = 'mock-service-key'

const TENANT_ID = 'aaaaaaaa-0000-0000-0000-00000wd00001'

const { dispatchWebhook } = await import('./webhook-dispatcher.js')

beforeEach(() => {
  store = createStore()
  store.tables['webhook_subscriptions'] = []
  store.tables['webhook_deliveries'] = []
  addMock.mockClear()
})

describe('dispatchWebhook', () => {
  it('logs a delivery and enqueues a job when event_type matches an active subscription', async () => {
    const subId = randomUUID()
    ;(store.tables['webhook_subscriptions'] as Row[]).push({
      id: subId,
      tenant_id: TENANT_ID,
      url: 'https://hook.test/recv',
      event_types: ['call.completed'],
      is_active: true,
      secret: 'test-secret',
    })

    await dispatchWebhook(TENANT_ID, 'call.completed', { duration: 30 })

    const deliveries = store.tables['webhook_deliveries'] as Row[]
    expect(deliveries).toHaveLength(1)
    expect(deliveries[0]?.['subscription_id']).toBe(subId)
    expect(deliveries[0]?.['event_type']).toBe('call.completed')
    expect(deliveries[0]?.['status']).toBe('pending')

    expect(addMock).toHaveBeenCalledTimes(1)
    const [jobName, jobData] = addMock.mock.calls[0]! as [string, { deliveryId: string }]
    expect(jobName).toBe('deliver')
    expect(jobData.deliveryId).toBe(deliveries[0]?.['id'])
  })

  it('does NOT enqueue when event_type does not match subscription event_types', async () => {
    ;(store.tables['webhook_subscriptions'] as Row[]).push({
      id: randomUUID(),
      tenant_id: TENANT_ID,
      url: 'https://hook.test/recv',
      event_types: ['contact.created'],
      is_active: true,
      secret: 'test-secret',
    })

    await dispatchWebhook(TENANT_ID, 'call.completed', {})

    expect(addMock).not.toHaveBeenCalled()
    expect(store.tables['webhook_deliveries']).toHaveLength(0)
  })

  it('does NOT enqueue for an inactive subscription', async () => {
    ;(store.tables['webhook_subscriptions'] as Row[]).push({
      id: randomUUID(),
      tenant_id: TENANT_ID,
      url: 'https://hook.test/recv',
      event_types: ['call.completed'],
      is_active: false,
      secret: 'test-secret',
    })

    await dispatchWebhook(TENANT_ID, 'call.completed', {})

    expect(addMock).not.toHaveBeenCalled()
  })
})
