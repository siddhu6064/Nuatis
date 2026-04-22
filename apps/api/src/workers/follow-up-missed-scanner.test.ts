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
const sendPushNotification = jest.fn(async () => undefined)

jest.unstable_mockModule('@supabase/supabase-js', () => ({
  createClient: () => createMockSupabase(store),
}))
jest.unstable_mockModule('../lib/ops-copilot-client.js', () => ({ publishActivityEvent }))
jest.unstable_mockModule('../lib/push-client.js', () => ({ sendPushNotification }))

process.env['SUPABASE_URL'] = 'https://mock.supabase.co'
process.env['SUPABASE_SERVICE_ROLE_KEY'] = 'mock-service-key'

const TENANT_ID = 'aaaaaaaa-0000-0000-0000-000000fm1001'
const { scan } = await import('./follow-up-missed-scanner.js')

beforeEach(() => {
  store = createStore()
  store.tables['contacts'] = []
  store.tables['voice_sessions'] = []
  store.tables['appointments'] = []
  publishActivityEvent.mockClear()
  sendPushNotification.mockClear()
})

describe('follow-up-missed-scanner scan()', () => {
  it('publishes follow_up.missed and pushes alert for contact with completed session 2-7d ago and no newer activity', async () => {
    const contactId = randomUUID()
    const endedAt = new Date(Date.now() - 3 * 86400000).toISOString()
    const startedAt = new Date(Date.now() - 3 * 86400000 - 30 * 60000).toISOString()
    ;(store.tables['contacts'] as Row[]).push({
      id: contactId,
      tenant_id: TENANT_ID,
      full_name: 'Missed Mia',
    })
    ;(store.tables['voice_sessions'] as Row[]).push({
      id: randomUUID(),
      tenant_id: TENANT_ID,
      contact_id: contactId,
      started_at: startedAt,
      ended_at: endedAt,
    })

    await scan()

    expect(publishActivityEvent).toHaveBeenCalledTimes(1)
    const call = publishActivityEvent.mock.calls[0]![0] as { event_type?: string }
    expect(call.event_type).toBe('follow_up.missed')
    expect(sendPushNotification).toHaveBeenCalledTimes(1)
  })

  it('skips contact who has a newer appointment after the voice session', async () => {
    const contactId = randomUUID()
    const sessionEnded = new Date(Date.now() - 3 * 86400000).toISOString()
    const sessionStarted = new Date(Date.now() - 3 * 86400000 - 30 * 60000).toISOString()
    const apptStart = new Date(Date.now() - 1 * 86400000).toISOString()
    ;(store.tables['contacts'] as Row[]).push({
      id: contactId,
      tenant_id: TENANT_ID,
      full_name: 'Followed Fred',
    })
    ;(store.tables['voice_sessions'] as Row[]).push({
      id: randomUUID(),
      tenant_id: TENANT_ID,
      contact_id: contactId,
      started_at: sessionStarted,
      ended_at: sessionEnded,
    })
    ;(store.tables['appointments'] as Row[]).push({
      id: randomUUID(),
      tenant_id: TENANT_ID,
      contact_id: contactId,
      status: 'scheduled',
      start_time: apptStart,
      end_time: apptStart,
    })

    await scan()

    expect(publishActivityEvent).not.toHaveBeenCalled()
    expect(sendPushNotification).not.toHaveBeenCalled()
  })

  it('skips contact whose voice session is outside the 2-7 day window (too recent)', async () => {
    const contactId = randomUUID()
    const endedAt = new Date(Date.now() - 1 * 86400000).toISOString()
    const startedAt = new Date(Date.now() - 1 * 86400000 - 30 * 60000).toISOString()
    ;(store.tables['contacts'] as Row[]).push({
      id: contactId,
      tenant_id: TENANT_ID,
      full_name: 'Recent Rob',
    })
    ;(store.tables['voice_sessions'] as Row[]).push({
      id: randomUUID(),
      tenant_id: TENANT_ID,
      contact_id: contactId,
      started_at: startedAt,
      ended_at: endedAt,
    })

    await scan()

    expect(publishActivityEvent).not.toHaveBeenCalled()
  })
})
