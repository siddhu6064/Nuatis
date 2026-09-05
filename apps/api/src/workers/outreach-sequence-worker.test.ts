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
const dispatchWebhook = jest.fn(async () => undefined)
const logActivity = jest.fn(async () => undefined)

jest.unstable_mockModule('@supabase/supabase-js', () => ({
  createClient: () => createMockSupabase(store),
}))
jest.unstable_mockModule('../lib/email-client.js', () => ({ sendTemplatedEmail }))
jest.unstable_mockModule('../lib/webhook-dispatcher.js', () => ({ dispatchWebhook }))
jest.unstable_mockModule('../lib/activity.js', () => ({ logActivity }))

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

const TENANT_ID = 'aaaaaaaa-0000-0000-0000-00000osw0001'
const CONTACT_ID = 'cccccccc-0000-0000-0000-00000osw0001'
const SEQUENCE_ID = 'seq-1'
const { scan } = await import('./outreach-sequence-worker.js')

function seedBase(): void {
  store.tables['tenants'] = [{ id: TENANT_ID, name: 'Acme Co' }]
  store.tables['telnyx_numbers'] = [
    {
      id: randomUUID(),
      tenant_id: TENANT_ID,
      phone_number: '+15550000000',
      status: 'active',
      is_primary: true,
    },
  ]
  store.tables['locations'] = [
    { id: randomUUID(), tenant_id: TENANT_ID, telnyx_number: '+15550000000', is_primary: true },
  ]
  store.tables['contacts'] = [
    {
      id: CONTACT_ID,
      tenant_id: TENANT_ID,
      full_name: 'Jane',
      phone: '+15551112222',
      email: 'jane@example.com',
      sms_opt_in: true,
    },
  ]
  store.tables['outreach_sequences'] = [
    { id: SEQUENCE_ID, tenant_id: TENANT_ID, enabled: true, name: 'Cold lead nurture' },
  ]
  store.tables['outreach_sequence_steps'] = [
    {
      id: 'step-0',
      sequence_id: SEQUENCE_ID,
      step_order: 0,
      days_after: 1,
      channel: 'sms',
      subject: null,
      template: 'Hi {name}, following up from {business}.',
    },
    {
      id: 'step-1',
      sequence_id: SEQUENCE_ID,
      step_order: 1,
      days_after: 3,
      channel: 'email',
      subject: 'Checking in',
      template: 'Just checking in, {name}.',
    },
  ]
}

beforeEach(() => {
  store = createStore()
  seedBase()
  store.tables['outreach_sequence_enrollments'] = []
  fetchMock.mockClear()
  sendTemplatedEmail.mockClear()
  dispatchWebhook.mockClear()
  logActivity.mockClear()
})

describe('outreach-sequence-worker scanner', () => {
  it('sends step 0 (sms) when due, advances current_step, keeps status active', async () => {
    const twoDaysAgo = new Date(Date.now() - 2 * 86400000).toISOString()
    store.tables['outreach_sequence_enrollments'] = [
      {
        id: 'enr-1',
        tenant_id: TENANT_ID,
        sequence_id: SEQUENCE_ID,
        contact_id: CONTACT_ID,
        current_step: 0,
        status: 'active',
        last_sent_at: null,
        enrolled_at: twoDaysAgo,
      },
    ]

    await scan()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const enrollment = (store.tables['outreach_sequence_enrollments'] as Row[])[0]!
    expect(enrollment['current_step']).toBe(1)
    expect(enrollment['status']).toBe('active')
    expect(enrollment['last_sent_at']).toBeTruthy()
    expect(dispatchWebhook).toHaveBeenCalledTimes(1)
  })

  it('does not send when the step is not due yet', async () => {
    store.tables['outreach_sequence_enrollments'] = [
      {
        id: 'enr-1',
        tenant_id: TENANT_ID,
        sequence_id: SEQUENCE_ID,
        contact_id: CONTACT_ID,
        current_step: 0,
        status: 'active',
        last_sent_at: null,
        enrolled_at: new Date().toISOString(),
      },
    ]

    await scan()

    expect(fetchMock).not.toHaveBeenCalled()
    const enrollment = (store.tables['outreach_sequence_enrollments'] as Row[])[0]!
    expect(enrollment['current_step']).toBe(0)
  })

  it('marks status completed after sending the final step', async () => {
    const fourDaysAgo = new Date(Date.now() - 4 * 86400000).toISOString()
    store.tables['outreach_sequence_enrollments'] = [
      {
        id: 'enr-1',
        tenant_id: TENANT_ID,
        sequence_id: SEQUENCE_ID,
        contact_id: CONTACT_ID,
        current_step: 1,
        status: 'active',
        last_sent_at: fourDaysAgo,
        enrolled_at: fourDaysAgo,
      },
    ]

    await scan()

    expect(sendTemplatedEmail).toHaveBeenCalledTimes(1)
    const enrollment = (store.tables['outreach_sequence_enrollments'] as Row[])[0]!
    expect(enrollment['current_step']).toBe(2)
    expect(enrollment['status']).toBe('completed')
  })

  it('skips a disabled sequence', async () => {
    store.tables['outreach_sequences'] = [
      { id: SEQUENCE_ID, tenant_id: TENANT_ID, enabled: false, name: 'Paused' },
    ]
    store.tables['outreach_sequence_enrollments'] = [
      {
        id: 'enr-1',
        tenant_id: TENANT_ID,
        sequence_id: SEQUENCE_ID,
        contact_id: CONTACT_ID,
        current_step: 0,
        status: 'active',
        last_sent_at: null,
        enrolled_at: new Date(Date.now() - 2 * 86400000).toISOString(),
      },
    ]

    await scan()

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('skips a non-active (stopped) enrollment', async () => {
    store.tables['outreach_sequence_enrollments'] = [
      {
        id: 'enr-1',
        tenant_id: TENANT_ID,
        sequence_id: SEQUENCE_ID,
        contact_id: CONTACT_ID,
        current_step: 0,
        status: 'stopped',
        last_sent_at: null,
        enrolled_at: new Date(Date.now() - 2 * 86400000).toISOString(),
      },
    ]

    await scan()

    expect(fetchMock).not.toHaveBeenCalled()
  })
})
