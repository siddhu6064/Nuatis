import { jest, describe, it, expect, beforeEach } from '@jest/globals'
import {
  createStore,
  createMockSupabase,
  type MockStore,
} from '../routes/__test-support__/supabase-mock.js'

const sendPushNotification = jest.fn<() => Promise<void>>()
jest.unstable_mockModule('./push-client.js', () => ({ sendPushNotification }))

let store: MockStore = createStore()
jest.unstable_mockModule('@supabase/supabase-js', () => ({
  createClient: () => createMockSupabase(store),
}))

process.env['SUPABASE_URL'] = 'https://mock.supabase.co'
process.env['SUPABASE_SERVICE_ROLE_KEY'] = 'mock-service-key'

const PLATFORM = 'aaaaaaaa-0000-0000-0000-00000platform'
const { notifyPlatformTeam } = await import('./notify-platform-team.js')

beforeEach(() => {
  store = createStore()
  store.tables['push_subscriptions'] = []
  sendPushNotification.mockClear()
  sendPushNotification.mockResolvedValue(undefined)
  process.env['PLATFORM_TENANT_ID'] = PLATFORM
  delete process.env['PLATFORM_ALERT_WEBHOOK_URL']
  global.fetch = jest.fn(async () => new Response('{}', { status: 200 })) as unknown as typeof fetch
})

describe('notifyPlatformTeam', () => {
  it('pushes to the platform tenant, never to a merchant', async () => {
    // notifyOwner targets a merchant's tenant. Getting this wrong tells every
    // customer about an internal outage.
    await notifyPlatformTeam('platform_incident_declared', { title: 'SEV1', body: 'x' })

    expect(sendPushNotification).toHaveBeenCalledTimes(1)
    expect((sendPushNotification.mock.calls[0] as unknown as string[])[0]).toBe(PLATFORM)
  })

  it('posts to the alert webhook when one is configured', async () => {
    process.env['PLATFORM_ALERT_WEBHOOK_URL'] = 'https://hooks.example.com/abc'
    await notifyPlatformTeam('platform_incident_declared', {
      title: 'SEV1',
      body: 'register down',
    })

    expect(global.fetch).toHaveBeenCalledTimes(1)
    const [url, init] = (global.fetch as unknown as jest.Mock).mock.calls[0] as [
      string,
      RequestInit,
    ]
    expect(url).toBe('https://hooks.example.com/abc')
    expect(String(init.body)).toContain('register down')
  })

  it('skips the webhook when none is configured', async () => {
    await notifyPlatformTeam('platform_incident_declared', { title: 'x', body: 'y' })
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('does nothing and does not throw when PLATFORM_TENANT_ID is unset', async () => {
    delete process.env['PLATFORM_TENANT_ID']
    await expect(notifyPlatformTeam('x', { title: 'a', body: 'b' })).resolves.toBeUndefined()
    expect(sendPushNotification).not.toHaveBeenCalled()
  })

  it('still pushes when the webhook fails', async () => {
    // One broken Slack URL must not cost the team the alert entirely.
    process.env['PLATFORM_ALERT_WEBHOOK_URL'] = 'https://hooks.example.com/abc'
    global.fetch = jest.fn(async () => {
      throw new Error('dns')
    }) as unknown as typeof fetch

    await expect(notifyPlatformTeam('x', { title: 'a', body: 'b' })).resolves.toBeUndefined()
    expect(sendPushNotification).toHaveBeenCalledTimes(1)
  })

  it('never throws when push itself fails', async () => {
    sendPushNotification.mockRejectedValue(new Error('push is down'))
    await expect(notifyPlatformTeam('x', { title: 'a', body: 'b' })).resolves.toBeUndefined()
  })
})

describe('undeliverable alerts are loud', () => {
  it('logs an error when there is no webhook and no push subscription', async () => {
    // sendPushNotification returns early and logs nothing when a tenant has no
    // subscriptions. An alert that reaches nobody must not also be invisible.
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {})
    store.tables['push_subscriptions'] = []

    await notifyPlatformTeam('platform_incident_declared', { title: 'SEV1', body: 'x' })

    const logged = spy.mock.calls.map((c) => String(c[0])).join('\n')
    expect(logged).toContain('ALERT UNDELIVERABLE')
    spy.mockRestore()
  })

  it('stays quiet when a webhook is configured', async () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {})
    process.env['PLATFORM_ALERT_WEBHOOK_URL'] = 'https://hooks.example.com/abc'
    store.tables['push_subscriptions'] = []

    await notifyPlatformTeam('platform_incident_declared', { title: 'SEV1', body: 'x' })

    const logged = spy.mock.calls.map((c) => String(c[0])).join('\n')
    expect(logged).not.toContain('ALERT UNDELIVERABLE')
    spy.mockRestore()
  })

  it('stays quiet when the platform tenant has a subscription', async () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {})
    store.tables['push_subscriptions'] = [
      {
        id: 'sub1',
        tenant_id: PLATFORM,
        endpoint: 'https://push.example/1',
        p256dh: 'k',
        auth: 'a',
      },
    ]

    await notifyPlatformTeam('platform_incident_declared', { title: 'SEV1', body: 'x' })

    const logged = spy.mock.calls.map((c) => String(c[0])).join('\n')
    expect(logged).not.toContain('ALERT UNDELIVERABLE')
    spy.mockRestore()
  })
})
