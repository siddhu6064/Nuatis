import { jest, describe, it, expect, beforeEach } from '@jest/globals'
import { randomUUID } from 'node:crypto'
import {
  createStore,
  createMockSupabase,
  type MockStore,
  type Row,
} from '../routes/__test-support__/supabase-mock.js'

let store: MockStore = createStore()

const calendarInsert = jest.fn(async () => ({ data: { id: 'gcal-evt-001' } }))
const getCalendarClient = jest.fn(() => ({
  events: { insert: calendarInsert },
}))

jest.unstable_mockModule('@supabase/supabase-js', () => ({
  createClient: () => createMockSupabase(store),
}))
jest.unstable_mockModule('../services/google.js', () => ({ getCalendarClient }))

process.env['SUPABASE_URL'] = 'https://mock.supabase.co'
process.env['SUPABASE_SERVICE_ROLE_KEY'] = 'mock-service-key'

const TENANT_ID = 'aaaaaaaa-0000-0000-0000-00000th00001'
const { executeToolCall } = await import('./tool-handlers.js')

// Next Monday after 2026-04-22 (Wed) is 2026-04-27. Dental mon_fri hours 8am-5pm.
const WEEKDAY_DATE = '2026-04-27'

function baseContext(product: 'maya_only' | 'suite') {
  return {
    tenantId: TENANT_ID,
    vertical: 'dental',
    callerId: '+15125557777',
    streamId: 'stream-test',
    callControlId: 'ccid-test',
    product,
  }
}

beforeEach(() => {
  store = createStore()
  store.tables['contacts'] = []
  store.tables['locations'] = []
  store.tables['appointments'] = []
  calendarInsert.mockClear()
  getCalendarClient.mockClear()
})

describe('lookup_contact — maya_only product', () => {
  it('returns found:false without querying contacts table when product is maya_only', async () => {
    // Seed a contact that WOULD match if queried — proves no query happened.
    ;(store.tables['contacts'] as Row[]).push({
      id: randomUUID(),
      tenant_id: TENANT_ID,
      full_name: 'Should Not Be Returned',
      phone: '+15125559999',
      is_archived: false,
    })

    const result = await executeToolCall(
      'lookup_contact',
      { phone_number: '+15125559999' },
      baseContext('maya_only')
    )

    expect(result['found']).toBe(false)
    expect(String(result['message'])).toContain('not available')
    // If suite path ran, result would have contact key. Verify absent.
    expect(result['contact']).toBeUndefined()
  })

  it('queries contacts and returns match when product is suite', async () => {
    ;(store.tables['contacts'] as Row[]).push({
      id: randomUUID(),
      tenant_id: TENANT_ID,
      full_name: 'Suite Sam',
      phone: '+15125551111',
      email: 'sam@example.com',
      is_archived: false,
    })

    const result = await executeToolCall(
      'lookup_contact',
      { phone_number: '+15125551111' },
      baseContext('suite')
    )

    expect(result['found']).toBe(true)
    expect(result['contact']).toBeDefined()
  })
})

describe('book_appointment — maya_only product', () => {
  it('returns appointment_id:null and contact_id:null when product is maya_only', async () => {
    ;(store.tables['locations'] as Row[]).push({
      id: randomUUID(),
      tenant_id: TENANT_ID,
      is_primary: true,
      google_refresh_token: 'refresh-token-test',
      google_calendar_id: 'primary',
    })

    const result = await executeToolCall(
      'book_appointment',
      {
        date: WEEKDAY_DATE,
        start_time: '10:00',
        duration_minutes: 60,
        caller_name: 'Maya Caller',
        caller_phone: '+15125558888',
      },
      baseContext('maya_only')
    )

    expect(result['booked']).toBe(true)
    expect(result['appointment_id']).toBeNull()
    expect(result['contact_id']).toBeNull()
    expect(calendarInsert).toHaveBeenCalledTimes(1)
    // CRM writes must not have happened
    expect((store.tables['contacts'] as Row[]).length).toBe(0)
    expect((store.tables['appointments'] as Row[]).length).toBe(0)
  })

  it('upserts contact and inserts appointment row when product is suite', async () => {
    ;(store.tables['locations'] as Row[]).push({
      id: randomUUID(),
      tenant_id: TENANT_ID,
      is_primary: true,
      google_refresh_token: 'refresh-token-test',
      google_calendar_id: 'primary',
    })

    const result = await executeToolCall(
      'book_appointment',
      {
        date: WEEKDAY_DATE,
        start_time: '10:00',
        duration_minutes: 60,
        caller_name: 'Suite Sally',
        caller_phone: '+15125552222',
      },
      baseContext('suite')
    )

    expect(result['booked']).toBe(true)
    expect(result['appointment_id']).toBeDefined()
    expect(result['appointment_id']).not.toBeNull()
    expect(result['contact_id']).toBeDefined()
    expect(result['contact_id']).not.toBeNull()
    expect((store.tables['appointments'] as Row[]).length).toBe(1)
  })
})

describe('reschedule_appointment', () => {
  const CALLER_PHONE = '+15125559876'
  const CONTACT_ID = randomUUID()
  const EXISTING_APPT_ID = randomUUID()
  const FUTURE_ISO = new Date(Date.now() + 86_400_000).toISOString()

  beforeEach(() => {
    // Location with calendar creds for the rebook step
    ;(store.tables['locations'] as Row[]).push({
      id: randomUUID(),
      tenant_id: TENANT_ID,
      is_primary: true,
      google_refresh_token: 'refresh-token-test',
      google_calendar_id: 'primary',
    })
  })

  it('cancels existing appointment and books new one (happy path)', async () => {
    ;(store.tables['contacts'] as Row[]).push({
      id: CONTACT_ID,
      tenant_id: TENANT_ID,
      full_name: 'Reschedule Remy',
      phone: CALLER_PHONE,
      is_archived: false,
    })
    ;(store.tables['appointments'] as Row[]).push({
      id: EXISTING_APPT_ID,
      tenant_id: TENANT_ID,
      contact_id: CONTACT_ID,
      status: 'scheduled',
      start_time: FUTURE_ISO,
      end_time: FUTURE_ISO,
    })

    const result = await executeToolCall(
      'reschedule_appointment',
      {
        caller_phone: CALLER_PHONE,
        new_date: WEEKDAY_DATE,
        new_start_time: '14:00',
      },
      baseContext('suite')
    )

    expect(result['rescheduled']).toBe(true)
    expect(result['old_appointment_id']).toBe(EXISTING_APPT_ID)
    expect(result['new_appointment_id']).toBeDefined()

    // Old appointment must be canceled
    const old = (store.tables['appointments'] as Row[]).find((r) => r['id'] === EXISTING_APPT_ID)
    expect(old?.['status']).toBe('canceled')

    // New appointment must exist
    const newAppt = (store.tables['appointments'] as Row[]).find(
      (r) => r['id'] !== EXISTING_APPT_ID && r['status'] === 'scheduled'
    )
    expect(newAppt).toBeDefined()
  })

  it('returns rescheduled:false when no contact matches caller phone', async () => {
    // No contacts in store

    const result = await executeToolCall(
      'reschedule_appointment',
      {
        caller_phone: '+15125550000',
        new_date: WEEKDAY_DATE,
        new_start_time: '10:00',
      },
      baseContext('suite')
    )

    expect(result['rescheduled']).toBe(false)
    expect(String(result['message'])).toContain('No upcoming appointment')
  })

  it('returns rescheduled:false when contact exists but has no upcoming appointment', async () => {
    ;(store.tables['contacts'] as Row[]).push({
      id: CONTACT_ID,
      tenant_id: TENANT_ID,
      full_name: 'No Appt Nina',
      phone: CALLER_PHONE,
      is_archived: false,
    })
    // No appointments in store

    const result = await executeToolCall(
      'reschedule_appointment',
      {
        caller_phone: CALLER_PHONE,
        new_date: WEEKDAY_DATE,
        new_start_time: '10:00',
      },
      baseContext('suite')
    )

    expect(result['rescheduled']).toBe(false)
    expect(String(result['message'])).toContain('No upcoming appointment')
  })
})
