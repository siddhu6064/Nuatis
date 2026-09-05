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
const createPaymentLink = jest.fn(async () => ({
  id: 'pl-1',
  url: 'https://pay.example.com/abc',
  amount: 12.5,
  description: 'Order ORD-1001',
}))
const sendSms = jest.fn(async () => ({ success: true }))

jest.unstable_mockModule('@supabase/supabase-js', () => ({
  createClient: () => createMockSupabase(store),
}))
jest.unstable_mockModule('../services/google.js', () => ({ getCalendarClient }))
jest.unstable_mockModule('../lib/payment-link.js', () => ({ createPaymentLink }))
jest.unstable_mockModule('../lib/sms.js', () => ({ sendSms }))

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
  store.tables['caller_memory'] = []
  calendarInsert.mockClear()
  getCalendarClient.mockClear()
  createPaymentLink.mockClear()
  sendSms.mockClear()
})

/** Flushes the fire-and-forget caller-memory write, which isn't awaited by
 *  book_appointment's own return — the mock's promise chain resolves on
 *  microtasks, so a macrotask tick (setImmediate) is enough to let it settle. */
function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve))
}

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

describe('book_appointment — caller_memory booking-path write', () => {
  beforeEach(() => {
    ;(store.tables['locations'] as Row[]).push({
      id: randomUUID(),
      tenant_id: TENANT_ID,
      is_primary: true,
      google_refresh_token: 'refresh-token-test',
      google_calendar_id: 'primary',
    })
  })

  it('fresh caller: inserts a caller_memory row with call_count 0, not the table DEFAULT 1', async () => {
    const phone = '+15125553001'

    await executeToolCall(
      'book_appointment',
      {
        date: WEEKDAY_DATE,
        start_time: '10:00',
        duration_minutes: 60,
        caller_name: 'Fresh Caller',
        caller_phone: phone,
        reason: 'cleaning',
      },
      baseContext('suite')
    )
    await flushMicrotasks()

    const memories = (store.tables['caller_memory'] ?? []) as Row[]
    expect(memories).toHaveLength(1)
    expect(memories[0]!['call_count']).toBe(0)
    expect(memories[0]!['phone']).toBe(phone)
    const facts = memories[0]!['facts'] as Record<string, unknown>
    expect(facts['last_appointment_type']).toBe('cleaning')
    expect(facts['last_appointment_date']).toBe(WEEKDAY_DATE)
  })

  it('existing caller: updates facts/evidence/held but leaves call_count and last_call_at untouched', async () => {
    const phone = '+15125553002'
    store.tables['caller_memory'] = [
      {
        tenant_id: TENANT_ID,
        phone,
        facts: { name: 'Returning Caller' },
        evidence: {},
        held: [],
        call_count: 3,
        last_call_at: '2026-07-01T00:00:00.000Z',
        updated_at: '2026-07-01T00:00:00.000Z',
      },
    ]

    await executeToolCall(
      'book_appointment',
      {
        date: WEEKDAY_DATE,
        start_time: '11:00',
        duration_minutes: 30,
        caller_name: 'Returning Caller',
        caller_phone: phone,
        reason: 'follow-up',
      },
      baseContext('suite')
    )
    await flushMicrotasks()

    const memories = (store.tables['caller_memory'] ?? []) as Row[]
    expect(memories).toHaveLength(1) // update, not a second inserted row
    expect(memories[0]!['call_count']).toBe(3) // untouched
    expect(memories[0]!['last_call_at']).toBe('2026-07-01T00:00:00.000Z') // untouched
    const facts = memories[0]!['facts'] as Record<string, unknown>
    expect(facts['name']).toBe('Returning Caller') // preserved
    expect(facts['last_appointment_type']).toBe('follow-up') // merged in
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

describe('cancel_appointment', () => {
  const CALLER_PHONE = '+15125559877'
  const CONTACT_ID = randomUUID()
  const EXISTING_APPT_ID = randomUUID()
  const FUTURE_ISO = new Date(Date.now() + 86_400_000).toISOString()

  it('cancels the upcoming appointment without booking a new one', async () => {
    ;(store.tables['contacts'] as Row[]).push({
      id: CONTACT_ID,
      tenant_id: TENANT_ID,
      full_name: 'Cancel Casey',
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
      'cancel_appointment',
      { caller_phone: CALLER_PHONE, reason: 'change of plans' },
      baseContext('suite')
    )

    expect(result['canceled']).toBe(true)
    expect(result['appointment_id']).toBe(EXISTING_APPT_ID)

    const appt = (store.tables['appointments'] as Row[]).find((r) => r['id'] === EXISTING_APPT_ID)
    expect(appt?.['status']).toBe('canceled')

    // No new appointment should have been created
    const all = store.tables['appointments'] as Row[]
    expect(all).toHaveLength(1)
  })

  it('returns canceled:false when no contact matches caller phone', async () => {
    const result = await executeToolCall(
      'cancel_appointment',
      { caller_phone: '+15125550000' },
      baseContext('suite')
    )

    expect(result['canceled']).toBe(false)
    expect(String(result['message'])).toContain('No upcoming appointment')
  })

  it('returns canceled:false when contact exists but has no upcoming appointment', async () => {
    ;(store.tables['contacts'] as Row[]).push({
      id: CONTACT_ID,
      tenant_id: TENANT_ID,
      full_name: 'No Appt Nina',
      phone: CALLER_PHONE,
      is_archived: false,
    })

    const result = await executeToolCall(
      'cancel_appointment',
      { caller_phone: CALLER_PHONE },
      baseContext('suite')
    )

    expect(result['canceled']).toBe(false)
    expect(String(result['message'])).toContain('No upcoming appointment')
  })
})

describe('get_appointments — timezone conversion', () => {
  const CONTACT_ID = randomUUID()
  const APPT_ID = randomUUID()

  // get_appointments filters .gte('start_time', new Date().toISOString()) — a
  // fixed calendar-date literal here goes stale and starts failing the moment
  // "now" passes it. Compute a start_time that's always tomorrow at a fixed
  // UTC hour instead, so the fixture never ages into the past. Chicago is
  // UTC-5 (CDT) for most of the year, which is what the 12:00 PM / 1:00 PM
  // assertions below assume.
  function tomorrowAtUtcHour(hourUtc: number): string {
    const d = new Date()
    d.setUTCDate(d.getUTCDate() + 1)
    d.setUTCHours(hourUtc, 0, 0, 0)
    return d.toISOString()
  }

  it('converts start_time/end_time to context.timezone, not raw UTC (regression: 17:00 UTC read as "5 PM")', async () => {
    ;(store.tables['appointments'] as Row[]).push({
      id: APPT_ID,
      tenant_id: TENANT_ID,
      contact_id: CONTACT_ID,
      title: 'Cleaning',
      status: 'scheduled',
      notes: null,
      start_time: tomorrowAtUtcHour(17),
      end_time: tomorrowAtUtcHour(18),
    })

    const result = await executeToolCall(
      'get_appointments',
      {},
      { ...baseContext('suite'), callerContactId: CONTACT_ID, timezone: 'America/Chicago' }
    )

    expect(result['found']).toBe(true)
    const appointments = result['appointments'] as Array<{ start_time: string; end_time: string }>
    expect(appointments[0]?.start_time).toBe('12:00 PM')
    expect(appointments[0]?.end_time).toBe('1:00 PM')
  })

  it('falls back to America/Chicago when context has no timezone', async () => {
    ;(store.tables['appointments'] as Row[]).push({
      id: APPT_ID,
      tenant_id: TENANT_ID,
      contact_id: CONTACT_ID,
      title: 'Cleaning',
      status: 'scheduled',
      notes: null,
      start_time: tomorrowAtUtcHour(17),
      end_time: tomorrowAtUtcHour(18),
    })

    const result = await executeToolCall(
      'get_appointments',
      {},
      { ...baseContext('suite'), callerContactId: CONTACT_ID }
    )

    const appointments = result['appointments'] as Array<{ start_time: string }>
    expect(appointments[0]?.start_time).toBe('12:00 PM')
  })
})

// dateAtHour regression, exercised at its live production call site (book_appointment's
// slot-resolution line, not just the packages/shared unit tests). 'gym' is the only
// vertical whose business hours (5am-10pm) open early enough in America/Chicago for a
// CST (winter) slot to fall inside dateAtHour's old buggy window — no vertical opens at
// literal midnight, so that specific boundary isn't reachable from here; it stays covered
// by tenantDayBoundsUTC's own midnight-anchored DST/non-DST cases in timezone.test.ts.
describe('book_appointment — early-morning slot resolves to the correct UTC calendar date', () => {
  beforeEach(() => {
    ;(store.tables['locations'] as Row[]).push({
      id: randomUUID(),
      tenant_id: TENANT_ID,
      is_primary: true,
      google_refresh_token: 'refresh-token-test',
      google_calendar_id: 'primary',
    })
  })

  it('5:30 AM CST (winter, non-DST) — regression: previously resolved to the prior UTC day', async () => {
    // 2026-01-19 is a Monday; gym hours 5am-10pm mon-fri. America/Chicago is CST
    // (UTC-6) in January, so 5:30 AM local renders as 23:30 the PREVIOUS day when
    // read back through the tz formatter — exactly the day-crossing case the old
    // dateAtHour hour/minute-only diff got wrong.
    const result = await executeToolCall(
      'book_appointment',
      {
        date: '2026-01-19',
        start_time: '05:30',
        duration_minutes: 60,
        caller_name: 'Early Bird',
        caller_phone: '+15125559001',
      },
      { ...baseContext('maya_only'), vertical: 'gym' }
    )

    expect(result['booked']).toBe(true)
    expect(result['start']).toBe('2026-01-19T11:30:00.000Z')
  })

  it('5:30 AM CDT (summer, DST) — same slot resolves correctly across the DST offset change', async () => {
    // 2026-06-15 is a Monday; same gym hours. America/Chicago is CDT (UTC-5) in
    // June, so this proves the fix holds on both sides of a DST transition, not
    // just in winter.
    const result = await executeToolCall(
      'book_appointment',
      {
        date: '2026-06-15',
        start_time: '05:30',
        duration_minutes: 60,
        caller_name: 'Early Bird Summer',
        caller_phone: '+15125559002',
      },
      { ...baseContext('maya_only'), vertical: 'gym' }
    )

    expect(result['booked']).toBe(true)
    expect(result['start']).toBe('2026-06-15T10:30:00.000Z')
  })
})

describe('place_order', () => {
  it('declines when trialExpired is set, without touching the orders table', async () => {
    const result = await executeToolCall(
      'place_order',
      { items: [{ description: 'Latte', quantity: 1 }], caller_name: 'Trial Tina' },
      { ...baseContext('suite'), trialExpired: true }
    )

    expect(result['placed']).toBe(false)
    expect((store.tables['orders'] as Row[] | undefined)?.length ?? 0).toBe(0)
  })

  it('declines when the orders module is disabled for the tenant', async () => {
    store.tables['tenants'] = [{ id: TENANT_ID, modules: { orders: false } }]

    const result = await executeToolCall(
      'place_order',
      { items: [{ description: 'Latte', quantity: 1 }], caller_name: 'Disabled Dana' },
      baseContext('suite')
    )

    expect(result['placed']).toBe(false)
    expect((store.tables['orders'] as Row[] | undefined)?.length ?? 0).toBe(0)
  })

  it('creates an order with computed totals when the module is enabled', async () => {
    store.tables['tenants'] = [{ id: TENANT_ID, modules: { orders: true }, order_counter: 1000 }]

    const result = await executeToolCall(
      'place_order',
      {
        items: [
          { description: 'Latte', quantity: 2, unit_price: 4.5 },
          { description: 'Muffin', quantity: 1, unit_price: 3.5 },
        ],
        caller_name: 'Phone Pete',
        caller_phone: '+15125559999',
      },
      baseContext('suite')
    )

    expect(result['placed']).toBe(true)
    expect(result['order_number']).toBe('ORD-1001')
    expect(result['total']).toBe(12.5)
    const orders = store.tables['orders'] as Row[]
    expect(orders).toHaveLength(1)
    expect(orders[0]?.['source']).toBe('maya')
    expect(orders[0]?.['status']).toBe('pending')
  })

  it('declines when no item has a description', async () => {
    store.tables['tenants'] = [{ id: TENANT_ID, modules: { orders: true } }]

    const result = await executeToolCall(
      'place_order',
      { items: [{ quantity: 1 }], caller_name: 'No Item Nina' },
      baseContext('suite')
    )

    expect(result['placed']).toBe(false)
  })

  it('sends a payment link in the confirmation text when a caller phone is given', async () => {
    store.tables['tenants'] = [
      { id: TENANT_ID, modules: { orders: true }, order_counter: 1000, name: 'Pete’s Diner' },
    ]
    store.tables['locations'] = [
      { id: randomUUID(), tenant_id: TENANT_ID, is_primary: true, telnyx_number: '+15125550000' },
    ]

    const result = await executeToolCall(
      'place_order',
      {
        items: [{ description: 'Latte', quantity: 2, unit_price: 4.5 }],
        caller_name: 'Phone Pete',
        caller_phone: '+15125559999',
      },
      baseContext('suite')
    )
    await flushMicrotasks()

    expect(result['placed']).toBe(true)
    expect(createPaymentLink).toHaveBeenCalledTimes(1)
    expect(createPaymentLink.mock.calls[0]?.[0]).toMatchObject({
      tenantId: TENANT_ID,
      amount: 9,
    })
    expect(sendSms).toHaveBeenCalledTimes(1)
    const text = sendSms.mock.calls[0]?.[2] as string
    expect(text).toContain('Pay online: https://pay.example.com/abc')
  })

  it('skips the payment link, but still confirms by SMS, when the order has no charge (subtotal 0)', async () => {
    store.tables['tenants'] = [{ id: TENANT_ID, modules: { orders: true }, order_counter: 1000 }]
    store.tables['locations'] = [
      { id: randomUUID(), tenant_id: TENANT_ID, is_primary: true, telnyx_number: '+15125550000' },
    ]

    const result = await executeToolCall(
      'place_order',
      {
        items: [{ description: 'Free sample', quantity: 1, unit_price: 0 }],
        caller_name: 'Free Fran',
        caller_phone: '+15125559998',
      },
      baseContext('suite')
    )
    await flushMicrotasks()

    expect(result['placed']).toBe(true)
    expect(createPaymentLink).not.toHaveBeenCalled()
    expect(sendSms).toHaveBeenCalledTimes(1)
    const text = sendSms.mock.calls[0]?.[2] as string
    expect(text).not.toContain('Pay online')
  })

  it('skips both the SMS and the payment link when the business has no primary Telnyx number', async () => {
    store.tables['tenants'] = [{ id: TENANT_ID, modules: { orders: true }, order_counter: 1000 }]

    const result = await executeToolCall(
      'place_order',
      {
        items: [{ description: 'Latte', quantity: 1, unit_price: 4.5 }],
        caller_name: 'No Number Nora',
        caller_phone: '+15125559997',
      },
      baseContext('suite')
    )
    await flushMicrotasks()

    expect(result['placed']).toBe(true)
    expect(createPaymentLink).not.toHaveBeenCalled()
    expect(sendSms).not.toHaveBeenCalled()
  })
})

describe('get_order_status', () => {
  const CONTACT_ID = randomUUID()

  it('returns found:false when context has no callerContactId', async () => {
    const result = await executeToolCall('get_order_status', {}, baseContext('suite'))

    expect(result['found']).toBe(false)
  })

  it('returns the most recent order, tenant-local formatted', async () => {
    store.tables['orders'] = [
      {
        id: randomUUID(),
        tenant_id: TENANT_ID,
        contact_id: CONTACT_ID,
        order_number: 'ORD-1002',
        status: 'ready',
        total: 12.5,
        deleted_at: null,
        created_at: '2026-08-24T17:00:00Z',
      },
    ]

    const result = await executeToolCall(
      'get_order_status',
      {},
      { ...baseContext('suite'), callerContactId: CONTACT_ID, timezone: 'America/Chicago' }
    )

    expect(result['found']).toBe(true)
    expect(result['order_number']).toBe('ORD-1002')
    expect(result['status']).toBe('ready')
    expect(result['placed_at']).toBe('12:00 PM')
  })
})
