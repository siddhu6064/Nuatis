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
process.env['TELNYX_API_KEY'] = 'test-telnyx-key'

const fetchMock = jest.fn<typeof fetch>(async () => {
  return {
    ok: true,
    status: 200,
    text: async () => '',
    json: async () => ({}),
  } as unknown as Response
})
// eslint-disable-next-line @typescript-eslint/no-explicit-any
;(globalThis as any).fetch = fetchMock

const TENANT_ID = 'aaaaaaaa-0000-0000-0000-000000ar0001'
const CONTACT_ID = 'cccccccc-0000-0000-0000-000000ar0001'
const { scan } = await import('./appointment-reminder-worker.js')

function seedBase(): void {
  store.tables['tenants'] = [{ id: TENANT_ID, name: 'Test Clinic' }]
  store.tables['contacts'] = [
    { id: CONTACT_ID, tenant_id: TENANT_ID, phone: '+15551112222', sms_opt_in: true },
  ]
  store.tables['locations'] = [
    { id: randomUUID(), tenant_id: TENANT_ID, telnyx_number: '+15550000000', is_primary: true },
  ]
}

beforeEach(() => {
  store = createStore()
  seedBase()
  fetchMock.mockClear()
})

describe('appointment-reminder processor', () => {
  it('sends 24h reminder and sets reminder_24h_sent flag', async () => {
    const apptId = randomUUID()
    store.tables['appointments'] = [
      {
        id: apptId,
        tenant_id: TENANT_ID,
        contact_id: CONTACT_ID,
        title: 'Cleaning',
        status: 'scheduled',
        start_time: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        reminder_24h_sent: false,
        reminder_1h_sent: false,
      },
    ]

    await scan()

    expect(fetchMock).toHaveBeenCalled()
    const row = (store.tables['appointments'] as Row[]).find((r) => r['id'] === apptId)
    expect(row?.['reminder_24h_sent']).toBe(true)
  })

  it('sends 1h reminder and sets reminder_1h_sent flag', async () => {
    const apptId = randomUUID()
    store.tables['appointments'] = [
      {
        id: apptId,
        tenant_id: TENANT_ID,
        contact_id: CONTACT_ID,
        title: 'Consult',
        status: 'scheduled',
        start_time: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        reminder_24h_sent: false,
        reminder_1h_sent: false,
      },
    ]

    await scan()

    expect(fetchMock).toHaveBeenCalled()
    const row = (store.tables['appointments'] as Row[]).find((r) => r['id'] === apptId)
    expect(row?.['reminder_1h_sent']).toBe(true)
  })

  it('does not re-send 24h reminder if already sent', async () => {
    const apptId = randomUUID()
    store.tables['appointments'] = [
      {
        id: apptId,
        tenant_id: TENANT_ID,
        contact_id: CONTACT_ID,
        title: 'Cleaning',
        status: 'scheduled',
        start_time: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        reminder_24h_sent: true,
        reminder_1h_sent: false,
      },
    ]

    await scan()

    // Scanner still queries the 1h window but the appt is outside that range,
    // so no SMS should fire for this row. Fetch may be called 0 times.
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('does not send reminder for cancelled appointment', async () => {
    const apptId = randomUUID()
    store.tables['appointments'] = [
      {
        id: apptId,
        tenant_id: TENANT_ID,
        contact_id: CONTACT_ID,
        title: 'Consult',
        status: 'canceled',
        start_time: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        reminder_24h_sent: false,
        reminder_1h_sent: false,
      },
    ]

    await scan()

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('formats the reminder time in the tenant location timezone, not a hardcoded one', async () => {
    store.tables['locations'] = [
      {
        id: randomUUID(),
        tenant_id: TENANT_ID,
        telnyx_number: '+15550000000',
        is_primary: true,
        timezone: 'America/Los_Angeles',
      },
    ]
    const apptId = randomUUID()
    // 2026-08-24T17:00:00Z = 10:00 AM PDT, 12:00 PM Chicago — pick a
    // start_time inside the 1h reminder window and assert on the PDT text.
    const startTime = new Date(Date.now() + 60 * 60 * 1000).toISOString()
    store.tables['appointments'] = [
      {
        id: apptId,
        tenant_id: TENANT_ID,
        contact_id: CONTACT_ID,
        title: 'Consult',
        status: 'scheduled',
        start_time: startTime,
        reminder_24h_sent: false,
        reminder_1h_sent: false,
      },
    ]

    await scan()

    const expectedTime = new Date(startTime).toLocaleString('en-US', {
      timeZone: 'America/Los_Angeles',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    })
    const [, requestInit] = fetchMock.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(requestInit.body as string) as { text: string }
    expect(body.text).toContain(expectedTime)
  })
})
