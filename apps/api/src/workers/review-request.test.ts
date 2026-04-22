import { jest, describe, it, expect, beforeEach } from '@jest/globals'
import { randomUUID } from 'node:crypto'
import {
  createStore,
  createMockSupabase,
  type MockStore,
  type Row,
} from '../routes/__test-support__/supabase-mock.js'

let store: MockStore = createStore()
const sendSms = jest
  .fn<() => Promise<{ success: boolean; messageId?: string }>>()
  .mockResolvedValue({ success: true, messageId: 'msg-1' })
const notifyOwner = jest.fn(async () => undefined)
const logActivity = jest.fn(async () => undefined)

jest.unstable_mockModule('@supabase/supabase-js', () => ({
  createClient: () => createMockSupabase(store),
}))
jest.unstable_mockModule('../lib/sms.js', () => ({ sendSms }))
jest.unstable_mockModule('../lib/notifications.js', () => ({ notifyOwner }))
jest.unstable_mockModule('../lib/activity.js', () => ({ logActivity }))

process.env['SUPABASE_URL'] = 'https://mock.supabase.co'
process.env['SUPABASE_SERVICE_ROLE_KEY'] = 'mock-service-key'
process.env['API_URL'] = 'http://mock-api.local'

const TENANT_ID = 'aaaaaaaa-0000-0000-0000-00000rr00001'
const CONTACT_ID = 'cccccccc-0000-0000-0000-00000rr00001'
const APPT_ID = 'ffffffff-0000-0000-0000-00000rr00001'

const { processReviewRequest } = await import('./review-request-worker.js')

function seedEnabledTenant(): void {
  store.tables['tenants'] = [
    {
      id: TENANT_ID,
      name: 'Test Clinic',
      review_automation_enabled: true,
      review_message_template: null,
      booking_google_review_url: 'https://g.page/test',
    },
  ]
  store.tables['locations'] = [
    { id: randomUUID(), tenant_id: TENANT_ID, telnyx_number: '+15550000000', is_primary: true },
  ]
}

beforeEach(() => {
  store = createStore()
  store.tables['tenants'] = []
  store.tables['contacts'] = []
  store.tables['locations'] = []
  store.tables['review_requests'] = []
  sendSms.mockClear()
  sendSms.mockResolvedValue({ success: true, messageId: 'msg-1' })
  notifyOwner.mockClear()
  logActivity.mockClear()
})

describe('processReviewRequest', () => {
  it('inserts review_request row, sends SMS, updates status to sent, and notifies owner', async () => {
    seedEnabledTenant()
    store.tables['contacts']!.push({
      id: CONTACT_ID,
      first_name: 'Jane',
      last_name: 'Doe',
      phone: '+15551112222',
    })

    await processReviewRequest({
      tenantId: TENANT_ID,
      contactId: CONTACT_ID,
      appointmentId: APPT_ID,
    })

    const rows = store.tables['review_requests'] as Row[]
    expect(rows.length).toBe(1)
    expect(rows[0]!['status']).toBe('sent')
    expect(rows[0]!['sent_at']).toBeDefined()

    expect(sendSms).toHaveBeenCalledTimes(1)
    expect(notifyOwner).toHaveBeenCalledTimes(1)
    const [, eventKey] = notifyOwner.mock.calls[0]!
    expect(eventKey).toBe('review_sent')
  })

  it('skips when review_automation_enabled is false', async () => {
    store.tables['tenants']!.push({
      id: TENANT_ID,
      name: 'Clinic',
      review_automation_enabled: false,
      booking_google_review_url: 'https://g.page/test',
    })

    await processReviewRequest({
      tenantId: TENANT_ID,
      contactId: CONTACT_ID,
      appointmentId: APPT_ID,
    })

    expect(sendSms).not.toHaveBeenCalled()
    expect((store.tables['review_requests'] as Row[]).length).toBe(0)
  })

  it('skips when duplicate review request already sent for this appointment', async () => {
    seedEnabledTenant()
    store.tables['contacts']!.push({
      id: CONTACT_ID,
      first_name: 'Jane',
      last_name: 'Doe',
      phone: '+15551112222',
    })
    store.tables['review_requests']!.push({
      id: randomUUID(),
      tenant_id: TENANT_ID,
      contact_id: CONTACT_ID,
      appointment_id: APPT_ID,
      status: 'sent',
    })

    await processReviewRequest({
      tenantId: TENANT_ID,
      contactId: CONTACT_ID,
      appointmentId: APPT_ID,
    })

    expect(sendSms).not.toHaveBeenCalled()
  })

  it('skips when contact has no phone number', async () => {
    seedEnabledTenant()
    store.tables['contacts']!.push({
      id: CONTACT_ID,
      first_name: 'Jane',
      last_name: 'Doe',
      phone: null,
    })

    await processReviewRequest({
      tenantId: TENANT_ID,
      contactId: CONTACT_ID,
      appointmentId: APPT_ID,
    })

    expect(sendSms).not.toHaveBeenCalled()
  })
})
