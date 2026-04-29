import { jest, describe, it, expect, beforeEach } from '@jest/globals'
import { randomUUID } from 'node:crypto'
import {
  createStore,
  createMockSupabase,
  type MockStore,
  type Row,
} from '../routes/__test-support__/supabase-mock.js'

let store: MockStore = createStore()

// ── Google mock ───────────────────────────────────────────────────────────────
const calendarInsert = jest.fn(async () => ({ data: { id: 'gcal-evt-001' } }))
const getCalendarClient = jest.fn(() => ({ events: { insert: calendarInsert } }))

// ── Outlook mock ──────────────────────────────────────────────────────────────
const createOutlookEventMock = jest.fn(async () => ({ id: 'outlook-evt-123' }))
const getValidOutlookCalendarTokenMock = jest.fn(async () => 'mock-access-token')

jest.unstable_mockModule('@supabase/supabase-js', () => ({
  createClient: () => createMockSupabase(store),
}))
jest.unstable_mockModule('../services/google.js', () => ({ getCalendarClient }))
jest.unstable_mockModule('../lib/outlook-calendar.js', () => ({
  getValidOutlookCalendarToken: getValidOutlookCalendarTokenMock,
  createOutlookEvent: createOutlookEventMock,
  checkOutlookAvailability: jest.fn(async () => []),
  refreshOutlookCalendarToken: jest.fn(async () => 'refreshed-token'),
  exchangeOutlookCalendarCode: jest.fn(async () => ({
    access_token: 'at',
    refresh_token: 'rt',
    expires_in: 3600,
  })),
  getOutlookCalendarAuthUrl: jest.fn(() => 'https://mock-auth-url'),
}))

process.env['SUPABASE_URL'] = 'https://mock.supabase.co'
process.env['SUPABASE_SERVICE_ROLE_KEY'] = 'mock-service-key'

const TENANT_ID = 'cccccccc-0000-0000-0000-native000001'
// Monday 2026-04-27 — dental mon_fri hours: 8am-5pm
const WEEKDAY_DATE = '2026-04-27'

const { executeToolCall } = await import('../voice/tool-handlers.js')
const { isSlotAvailable } = await import('../lib/booking-availability.js')
const { getCalendarCredentials } = await import('../lib/calendar-provider.js')

function baseContext(product: 'maya_only' | 'suite') {
  return {
    tenantId: TENANT_ID,
    vertical: 'dental',
    callerId: '+15125557777',
    streamId: 'stream-native-test',
    callControlId: 'ccid-native-test',
    product,
  }
}

// 10am–11am CDT on WEEKDAY_DATE (America/Chicago, CDT = UTC-5)
const APPT_START = '2026-04-27T15:00:00.000Z'
const APPT_END = '2026-04-27T16:00:00.000Z'

beforeEach(() => {
  store = createStore()
  store.tables['contacts'] = []
  store.tables['locations'] = []
  store.tables['appointments'] = []
  store.tables['tenants'] = []
  calendarInsert.mockClear()
  getCalendarClient.mockClear()
  createOutlookEventMock.mockClear()
  getValidOutlookCalendarTokenMock.mockClear()
})

// ── check_availability — native provider ──────────────────────────────────────

describe('native check_availability', () => {
  it('returns available:true when no appointments conflict (test 1)', async () => {
    // No appointments seeded — busyPeriods will be empty
    const result = await executeToolCall(
      'check_availability',
      { date: WEEKDAY_DATE, preferred_time: '10:00', duration_minutes: 60 },
      baseContext('suite')
    )

    expect(result['available']).toBe(true)
    expect(getCalendarClient).not.toHaveBeenCalled()
  })

  it('returns available:false when scheduled appointment overlaps slot (test 2)', async () => {
    ;(store.tables['appointments'] as Row[]).push({
      id: randomUUID(),
      tenant_id: TENANT_ID,
      start_time: APPT_START,
      end_time: APPT_END,
      status: 'scheduled',
    })

    const result = await executeToolCall(
      'check_availability',
      { date: WEEKDAY_DATE, preferred_time: '10:00', duration_minutes: 60 },
      baseContext('suite')
    )

    expect(result['available']).toBe(false)
    expect(getCalendarClient).not.toHaveBeenCalled()
  })

  it('returns available:true when only canceled appointment overlaps slot (test 3)', async () => {
    ;(store.tables['appointments'] as Row[]).push({
      id: randomUUID(),
      tenant_id: TENANT_ID,
      start_time: APPT_START,
      end_time: APPT_END,
      status: 'canceled',
    })

    const result = await executeToolCall(
      'check_availability',
      { date: WEEKDAY_DATE, preferred_time: '10:00', duration_minutes: 60 },
      baseContext('suite')
    )

    expect(result['available']).toBe(true)
    expect(getCalendarClient).not.toHaveBeenCalled()
  })
})

// ── book_appointment — all three providers ────────────────────────────────────

describe('book_appointment provider modes', () => {
  it('native suite: writes appointment row with google_event_id=null, no Google API (test 4)', async () => {
    ;(store.tables['locations'] as Row[]).push({
      id: randomUUID(),
      tenant_id: TENANT_ID,
      is_primary: true,
      // no google_refresh_token → native
    })

    const result = await executeToolCall(
      'book_appointment',
      {
        date: WEEKDAY_DATE,
        start_time: '10:00',
        duration_minutes: 60,
        caller_name: 'Native Nat',
        caller_phone: '+15125553333',
      },
      baseContext('suite')
    )

    expect(result['booked']).toBe(true)
    expect(result['google_event_id']).toBeNull()
    expect(result['appointment_id']).toBeDefined()
    expect(result['appointment_id']).not.toBeNull()
    expect(getCalendarClient).not.toHaveBeenCalled()

    const appts = store.tables['appointments'] as Row[]
    expect(appts.length).toBe(1)
    expect(appts[0]!['google_event_id']).toBeNull()
  })

  it('native maya_only: booked:true, null ids, no DB writes, no calendar API (test 5)', async () => {
    const result = await executeToolCall(
      'book_appointment',
      {
        date: WEEKDAY_DATE,
        start_time: '10:00',
        duration_minutes: 60,
        caller_name: 'Maya Native',
        caller_phone: '+15125554444',
      },
      baseContext('maya_only')
    )

    expect(result['booked']).toBe(true)
    expect(result['google_event_id']).toBeNull()
    expect(result['appointment_id']).toBeNull()
    expect(result['contact_id']).toBeNull()
    expect(getCalendarClient).not.toHaveBeenCalled()
    expect((store.tables['contacts'] as Row[]).length).toBe(0)
    expect((store.tables['appointments'] as Row[]).length).toBe(0)
  })

  it('google: calls getCalendarClient and stores google_event_id (test 6)', async () => {
    ;(store.tables['locations'] as Row[]).push({
      id: randomUUID(),
      tenant_id: TENANT_ID,
      is_primary: true,
      google_refresh_token: 'google-refresh-token',
      google_calendar_id: 'primary',
    })

    const result = await executeToolCall(
      'book_appointment',
      {
        date: WEEKDAY_DATE,
        start_time: '10:00',
        duration_minutes: 60,
        caller_name: 'Google Gary',
        caller_phone: '+15125555555',
      },
      baseContext('suite')
    )

    expect(result['booked']).toBe(true)
    expect(result['google_event_id']).toBe('gcal-evt-001')
    expect(getCalendarClient).toHaveBeenCalledTimes(1)
    expect(calendarInsert).toHaveBeenCalledTimes(1)

    const appts = store.tables['appointments'] as Row[]
    expect(appts.length).toBe(1)
    expect(appts[0]!['google_event_id']).toBe('gcal-evt-001')
  })

  it('outlook: calls createOutlookEvent and stores event id — P0 fix (test 7)', async () => {
    ;(store.tables['tenants'] as Row[]).push({
      id: TENANT_ID,
      calendar_provider: 'outlook',
      timezone: 'America/Chicago',
      outlook_calendar_refresh_token: 'encrypted-outlook-token',
    })

    const result = await executeToolCall(
      'book_appointment',
      {
        date: WEEKDAY_DATE,
        start_time: '10:00',
        duration_minutes: 60,
        caller_name: 'Outlook Ollie',
        caller_phone: '+15125556666',
      },
      baseContext('suite')
    )

    expect(result['booked']).toBe(true)
    expect(result['google_event_id']).toBe('outlook-evt-123')
    expect(getCalendarClient).not.toHaveBeenCalled()
    expect(createOutlookEventMock).toHaveBeenCalledTimes(1)
    expect(getValidOutlookCalendarTokenMock).toHaveBeenCalledWith(TENANT_ID)

    const appts = store.tables['appointments'] as Row[]
    expect(appts.length).toBe(1)
    expect(appts[0]!['google_event_id']).toBe('outlook-evt-123')
  })
})

// ── provider resolution ───────────────────────────────────────────────────────

describe('provider resolution', () => {
  it('returns provider=native when tenant has no Google or Outlook tokens (test 8)', async () => {
    ;(store.tables['tenants'] as Row[]).push({
      id: TENANT_ID,
      calendar_provider: null,
      timezone: 'America/Chicago',
      outlook_calendar_refresh_token: null,
    })
    ;(store.tables['locations'] as Row[]).push({
      id: randomUUID(),
      tenant_id: TENANT_ID,
      is_primary: true,
      google_refresh_token: null,
      google_calendar_id: null,
    })

    const creds = await getCalendarCredentials(TENANT_ID)

    expect(creds).not.toBeNull()
    expect(creds!['provider']).toBe('native')
  })
})

// ── booking-availability isSlotAvailable — native ─────────────────────────────

describe('native isSlotAvailable (booking-availability)', () => {
  const nativeCreds = {
    provider: 'native' as const,
    refreshToken: '',
    calendarId: '',
    timezone: 'America/Chicago',
    tenantId: TENANT_ID,
  }

  it('returns true when no appointments conflict the slot (test 9)', async () => {
    const available = await isSlotAvailable(nativeCreds, WEEKDAY_DATE, '10:00', 60)
    expect(available).toBe(true)
  })

  it('returns false when a scheduled appointment overlaps the slot (test 10)', async () => {
    ;(store.tables['appointments'] as Row[]).push({
      id: randomUUID(),
      tenant_id: TENANT_ID,
      start_time: APPT_START,
      end_time: APPT_END,
      status: 'scheduled',
    })

    const available = await isSlotAvailable(nativeCreds, WEEKDAY_DATE, '10:00', 60)
    expect(available).toBe(false)
  })
})
