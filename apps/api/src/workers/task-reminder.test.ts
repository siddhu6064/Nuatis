import { jest, describe, it, expect, beforeEach } from '@jest/globals'
import { randomUUID } from 'node:crypto'
import {
  createStore,
  createMockSupabase,
  type MockStore,
} from '../routes/__test-support__/supabase-mock.js'

let store: MockStore = createStore()
const sendPushNotification = jest.fn(async () => undefined)
const logActivity = jest.fn(async () => undefined)

jest.unstable_mockModule('@supabase/supabase-js', () => ({
  createClient: () => createMockSupabase(store),
}))
jest.unstable_mockModule('../lib/push-client.js', () => ({ sendPushNotification }))
jest.unstable_mockModule('../lib/activity.js', () => ({ logActivity }))

process.env['SUPABASE_URL'] = 'https://mock.supabase.co'
process.env['SUPABASE_SERVICE_ROLE_KEY'] = 'mock-service-key'

const { processReminder } = await import('./task-reminder-worker.js')

const TENANT_ID = 'aaaaaaaa-0000-0000-0000-00000tr00001'

beforeEach(() => {
  store = createStore()
  store.tables['tasks'] = []
  sendPushNotification.mockClear()
  logActivity.mockClear()
})

describe('processReminder', () => {
  it('sends push notification for an open task', async () => {
    const taskId = randomUUID()
    store.tables['tasks']!.push({ id: taskId, completed_at: null })

    await processReminder({ taskId, tenantId: TENANT_ID, title: 'Call back patient' })

    expect(sendPushNotification).toHaveBeenCalledTimes(1)
    const [tenantArg, payload] = sendPushNotification.mock.calls[0]! as unknown as [
      string,
      { title: string; body: string; url?: string },
    ]
    expect(tenantArg).toBe(TENANT_ID)
    expect(payload.title).toContain('Task due')
    expect(payload.url).toBe('/tasks')
  })

  it('skips push when task is already completed', async () => {
    const taskId = randomUUID()
    store.tables['tasks']!.push({ id: taskId, completed_at: '2026-01-01T00:00:00Z' })

    await processReminder({ taskId, tenantId: TENANT_ID, title: 'Old task' })

    expect(sendPushNotification).not.toHaveBeenCalled()
  })

  it('calls logActivity when contactId is provided', async () => {
    const taskId = randomUUID()
    const contactId = randomUUID()
    store.tables['tasks']!.push({ id: taskId, completed_at: null })

    await processReminder({
      taskId,
      tenantId: TENANT_ID,
      contactId,
      title: 'Linked task',
    })

    expect(sendPushNotification).toHaveBeenCalled()
    expect(logActivity).toHaveBeenCalledTimes(1)
    const call = logActivity.mock.calls[0]![0] as { type: string }
    expect(['system', 'task']).toContain(call.type)
  })
})
