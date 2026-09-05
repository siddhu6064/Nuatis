import { jest, describe, it, expect, beforeEach } from '@jest/globals'
import { randomUUID } from 'node:crypto'
import {
  createStore,
  createMockSupabase,
  type MockStore,
  type Row,
} from '../routes/__test-support__/supabase-mock.js'

let store: MockStore = createStore()
const sendSms = jest.fn(async () => ({ success: true, messageId: 'msg_1' }))
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

const TENANT_ID = 'aaaaaaaa-0000-0000-0000-00000np1001'
const CONTACT_ID = 'bbbbbbbb-0000-0000-0000-00000np1002'
const APPOINTMENT_ID = 'cccccccc-0000-0000-0000-00000np1003'

const { processNpsSurvey } = await import('./nps-survey-worker.js')

function seedTenant(overrides: Row = {}): void {
  store.tables['tenants'] = [
    {
      id: TENANT_ID,
      name: 'Test Biz',
      nps_survey_automation_enabled: true,
      ...overrides,
    },
  ]
}

beforeEach(() => {
  store = createStore()
  seedTenant()
  store.tables['contacts'] = [
    { id: CONTACT_ID, tenant_id: TENANT_ID, full_name: 'Jane Doe', phone: '+15125551234' },
  ]
  store.tables['locations'] = [
    { id: randomUUID(), tenant_id: TENANT_ID, is_primary: true, telnyx_number: '+15125559999' },
  ]
  store.tables['nps_responses'] = []
  sendSms.mockClear()
  notifyOwner.mockClear()
  logActivity.mockClear()
})

describe('processNpsSurvey', () => {
  it('sends a survey SMS and marks the response sent', async () => {
    await processNpsSurvey({
      tenantId: TENANT_ID,
      contactId: CONTACT_ID,
      appointmentId: APPOINTMENT_ID,
    })

    expect(sendSms).toHaveBeenCalledTimes(1)
    const [from, to, body] = sendSms.mock.calls[0] as [string, string, string]
    expect(from).toBe('+15125559999')
    expect(to).toBe('+15125551234')
    expect(body).toContain('Jane')

    const rows = store.tables['nps_responses'] as Row[]
    expect(rows).toHaveLength(1)
    expect(rows[0]?.['status']).toBe('sent')
    expect(rows[0]?.['tenant_id']).toBe(TENANT_ID)
    expect(rows[0]?.['appointment_id']).toBe(APPOINTMENT_ID)
    expect(notifyOwner).toHaveBeenCalledTimes(1)
    expect(logActivity).toHaveBeenCalledTimes(1)
  })

  it('does nothing when automation is disabled', async () => {
    seedTenant({ nps_survey_automation_enabled: false })

    await processNpsSurvey({
      tenantId: TENANT_ID,
      contactId: CONTACT_ID,
      appointmentId: APPOINTMENT_ID,
    })

    expect(sendSms).not.toHaveBeenCalled()
    expect(store.tables['nps_responses']).toHaveLength(0)
  })

  it('skips when a survey was already sent for this appointment', async () => {
    ;(store.tables['nps_responses'] as Row[]).push({
      id: randomUUID(),
      tenant_id: TENANT_ID,
      contact_id: CONTACT_ID,
      appointment_id: APPOINTMENT_ID,
      status: 'sent',
    })

    await processNpsSurvey({
      tenantId: TENANT_ID,
      contactId: CONTACT_ID,
      appointmentId: APPOINTMENT_ID,
    })

    expect(sendSms).not.toHaveBeenCalled()
    // still just the one pre-seeded row — no duplicate inserted
    expect(store.tables['nps_responses']).toHaveLength(1)
  })

  it('skips when the contact has no phone number', async () => {
    store.tables['contacts'] = [
      { id: CONTACT_ID, tenant_id: TENANT_ID, full_name: 'No Phone', phone: null },
    ]

    await processNpsSurvey({
      tenantId: TENANT_ID,
      contactId: CONTACT_ID,
      appointmentId: APPOINTMENT_ID,
    })

    expect(sendSms).not.toHaveBeenCalled()
  })

  it('does not send when there is no primary location telnyx_number', async () => {
    store.tables['locations'] = []

    await processNpsSurvey({
      tenantId: TENANT_ID,
      contactId: CONTACT_ID,
      appointmentId: APPOINTMENT_ID,
    })

    expect(sendSms).not.toHaveBeenCalled()
    // the pending row was inserted before the location check, but never sent
    const rows = store.tables['nps_responses'] as Row[]
    expect(rows).toHaveLength(1)
    expect(rows[0]?.['status']).toBe('pending')
  })
})
