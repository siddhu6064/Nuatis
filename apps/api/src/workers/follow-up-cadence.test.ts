import { jest, describe, it, expect, beforeEach } from '@jest/globals'
import { randomUUID } from 'node:crypto'
import {
  createStore,
  createMockSupabase,
  type MockStore,
  type Row,
} from '../routes/__test-support__/supabase-mock.js'

let store: MockStore = createStore()
const sendTemplatedEmail = jest.fn<() => Promise<boolean>>().mockResolvedValue(true)
const publishActivityEvent = jest.fn(async () => undefined)
const dispatchWebhook = jest.fn(async () => undefined)

jest.unstable_mockModule('@supabase/supabase-js', () => ({
  createClient: () => createMockSupabase(store),
}))
jest.unstable_mockModule('../lib/email-client.js', () => ({ sendTemplatedEmail }))
jest.unstable_mockModule('../lib/ops-copilot-client.js', () => ({ publishActivityEvent }))
jest.unstable_mockModule('../lib/webhook-dispatcher.js', () => ({ dispatchWebhook }))

process.env['SUPABASE_URL'] = 'https://mock.supabase.co'
process.env['SUPABASE_SERVICE_ROLE_KEY'] = 'mock-service-key'
process.env['TELNYX_API_KEY'] = 'test-telnyx-key'

const fetchMock = jest.fn<typeof fetch>(async () => {
  return { ok: true, status: 200, text: async () => '' } as unknown as Response
})
// eslint-disable-next-line @typescript-eslint/no-explicit-any
;(globalThis as any).fetch = fetchMock

const TENANT_ID = 'aaaaaaaa-0000-0000-0000-00000fuc0001'
const CONTACT_ID = 'cccccccc-0000-0000-0000-00000fuc0001'
const { scan } = await import('./follow-up-cadence-worker.js')

function seedBase(): void {
  store.tables['tenants'] = [{ id: TENANT_ID, vertical: 'dental', name: 'Clinic' }]
  store.tables['locations'] = [
    { id: randomUUID(), tenant_id: TENANT_ID, telnyx_number: '+15550000000', is_primary: true },
  ]
  store.tables['appointments'] = []
}

beforeEach(() => {
  store = createStore()
  seedBase()
  fetchMock.mockClear()
  sendTemplatedEmail.mockClear()
  publishActivityEvent.mockClear()
  dispatchWebhook.mockClear()
})

describe('follow-up-cadence scanner', () => {
  it('sends SMS and advances step when contact is due for cadence step 0 (sms channel)', async () => {
    // dental cadence step[0]: { days_after: 1, channel: 'sms', ... }
    const twoDaysAgo = new Date(Date.now() - 2 * 86400000).toISOString()
    store.tables['contacts'] = [
      {
        id: CONTACT_ID,
        tenant_id: TENANT_ID,
        full_name: 'Jane',
        phone: '+15551112222',
        email: null,
        follow_up_step: 0,
        follow_up_last_sent: null,
        created_at: twoDaysAgo,
        is_archived: false,
      },
    ]

    await scan()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(publishActivityEvent).toHaveBeenCalled()
    expect(dispatchWebhook).toHaveBeenCalled()
    const row = (store.tables['contacts'] as Row[]).find((r) => r['id'] === CONTACT_ID)
    expect(row?.['follow_up_step']).toBe(1)
  })

  it('sends email and advances step when step channel is email', async () => {
    // dental cadence step[1]: { days_after: 3, channel: 'email', ... }
    const fourDaysAgo = new Date(Date.now() - 4 * 86400000).toISOString()
    store.tables['contacts'] = [
      {
        id: CONTACT_ID,
        tenant_id: TENANT_ID,
        full_name: 'Jane',
        phone: null,
        email: 'jane@example.com',
        follow_up_step: 1,
        follow_up_last_sent: fourDaysAgo,
        created_at: new Date(Date.now() - 10 * 86400000).toISOString(),
        is_archived: false,
      },
    ]

    await scan()

    expect(sendTemplatedEmail).toHaveBeenCalledTimes(1)
    const call = sendTemplatedEmail.mock.calls[0]![0] as { templateName?: string }
    expect(call.templateName).toBe('follow_up')
    const row = (store.tables['contacts'] as Row[]).find((r) => r['id'] === CONTACT_ID)
    expect(row?.['follow_up_step']).toBe(2)
  })

  it('skips contact not yet due for current step', async () => {
    // step[0].days_after = 1 day; set created 12h ago → not due
    const twelveHoursAgo = new Date(Date.now() - 12 * 3600000).toISOString()
    store.tables['contacts'] = [
      {
        id: CONTACT_ID,
        tenant_id: TENANT_ID,
        full_name: 'Jane',
        phone: '+15551112222',
        email: null,
        follow_up_step: 0,
        follow_up_last_sent: null,
        created_at: twelveHoursAgo,
        is_archived: false,
      },
    ]

    await scan()

    expect(fetchMock).not.toHaveBeenCalled()
    expect(sendTemplatedEmail).not.toHaveBeenCalled()
    const row = (store.tables['contacts'] as Row[]).find((r) => r['id'] === CONTACT_ID)
    expect(row?.['follow_up_step']).toBe(0)
  })

  it('skips contact who has an appointment booked', async () => {
    const twoDaysAgo = new Date(Date.now() - 2 * 86400000).toISOString()
    store.tables['contacts'] = [
      {
        id: CONTACT_ID,
        tenant_id: TENANT_ID,
        full_name: 'Jane',
        phone: '+15551112222',
        email: null,
        follow_up_step: 0,
        follow_up_last_sent: null,
        created_at: twoDaysAgo,
        is_archived: false,
      },
    ]
    store.tables['appointments'] = [
      {
        id: randomUUID(),
        tenant_id: TENANT_ID,
        contact_id: CONTACT_ID,
        created_at: new Date().toISOString(),
      },
    ]

    await scan()

    expect(fetchMock).not.toHaveBeenCalled()
    const row = (store.tables['contacts'] as Row[]).find((r) => r['id'] === CONTACT_ID)
    expect(row?.['follow_up_step']).toBe(0)
  })
})
