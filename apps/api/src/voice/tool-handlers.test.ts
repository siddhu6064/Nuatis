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
