import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals'
import { randomUUID } from 'node:crypto'
import {
  createStore,
  createMockSupabase,
  type MockStore,
  type Row,
} from '../routes/__test-support__/supabase-mock.js'

let store: MockStore = createStore()

type PushResult = { statusCode: number }
const sendNotification = jest
  .fn<(sub: unknown, payload: string) => Promise<PushResult>>()
  .mockResolvedValue({ statusCode: 201 })
const setVapidDetails = jest.fn()

jest.unstable_mockModule('@supabase/supabase-js', () => ({
  createClient: () => createMockSupabase(store),
}))
jest.unstable_mockModule('web-push', () => ({
  default: { setVapidDetails, sendNotification },
  setVapidDetails,
  sendNotification,
}))

process.env['SUPABASE_URL'] = 'https://mock.supabase.co'
process.env['SUPABASE_SERVICE_ROLE_KEY'] = 'mock-service-key'
process.env['VAPID_PUBLIC_KEY'] = 'test-pub-key'
process.env['VAPID_PRIVATE_KEY'] = 'test-priv-key'
process.env['VAPID_EMAIL'] = 'mailto:test@nuatis.com'

const TENANT_ID = 'aaaaaaaa-0000-0000-0000-00000pc00001'

const { sendPushNotification } = await import('./push-client.js')

beforeEach(() => {
  store = createStore()
  store.tables['push_subscriptions'] = []
  sendNotification.mockClear()
  sendNotification.mockResolvedValue({ statusCode: 201 })
  setVapidDetails.mockClear()
})

afterEach(() => {
  process.env['VAPID_PUBLIC_KEY'] = 'test-pub-key'
  process.env['VAPID_PRIVATE_KEY'] = 'test-priv-key'
})

describe('sendPushNotification', () => {
  it('calls webpush.sendNotification for each subscription', async () => {
    ;(store.tables['push_subscriptions'] as Row[]).push(
      {
        id: randomUUID(),
        tenant_id: TENANT_ID,
        endpoint: 'https://fcm.push/sub1',
        p256dh: 'k1',
        auth: 'a1',
      },
      {
        id: randomUUID(),
        tenant_id: TENANT_ID,
        endpoint: 'https://fcm.push/sub2',
        p256dh: 'k2',
        auth: 'a2',
      }
    )

    await sendPushNotification(TENANT_ID, { title: 'Test', body: 'Hello' })

    expect(sendNotification).toHaveBeenCalledTimes(2)
  })

  it('deletes stale subscription when sendNotification returns statusCode 410', async () => {
    const subId = randomUUID()
    ;(store.tables['push_subscriptions'] as Row[]).push({
      id: subId,
      tenant_id: TENANT_ID,
      endpoint: 'https://fcm.push/stale',
      p256dh: 'k',
      auth: 'a',
    })

    sendNotification.mockRejectedValueOnce(Object.assign(new Error('Gone'), { statusCode: 410 }))

    await sendPushNotification(TENANT_ID, { title: 'Stale test', body: 'Gone' })

    const rows = store.tables['push_subscriptions'] as Row[]
    expect(rows.find((r) => r['id'] === subId)).toBeUndefined()
  })

  it('returns early without calling sendNotification when VAPID keys are absent', async () => {
    delete process.env['VAPID_PUBLIC_KEY']
    ;(store.tables['push_subscriptions'] as Row[]).push({
      id: randomUUID(),
      tenant_id: TENANT_ID,
      endpoint: 'https://fcm.push/whatever',
      p256dh: 'k',
      auth: 'a',
    })

    // Force-reset the module-scoped vapidConfigured flag by re-importing.
    // push-client caches vapid state; to simulate "absent at first call",
    // verify via a fresh dynamic import.
    jest.resetModules()
    const { sendPushNotification: freshSend } = (await import('./push-client.js')) as {
      sendPushNotification: typeof sendPushNotification
    }

    await freshSend(TENANT_ID, { title: 'No VAPID', body: 'Skip' })

    // Since caching in the original module may have been primed by earlier tests,
    // fresh import bypasses it. Assert the fresh module did not call sendNotification.
    expect(sendNotification).not.toHaveBeenCalled()
  })
})
