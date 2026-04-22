import { jest, describe, it, expect, beforeEach } from '@jest/globals'
import {
  createStore,
  createMockSupabase,
  type MockStore,
  type Row,
} from './__test-support__/supabase-mock.js'

let store: MockStore = createStore()

const getTenantCalendarCredentials = jest.fn(async () => ({
  provider: 'google' as const,
  refreshToken: 'rt',
  calendarId: 'primary',
  timezone: 'America/Chicago',
}))
const isSlotAvailable = jest.fn(async () => true)
const getAvailableSlotsForDate = jest.fn(async () => [])
const createCalendarEvent = jest.fn(async () => ({
  googleEventId: 'gcal-test-001',
  startIso: '2026-05-04T15:00:00.000Z',
  endIso: '2026-05-04T16:00:00.000Z',
}))
const sendSms = jest.fn(async () => undefined)
const sendPushNotification = jest.fn(async () => undefined)
const autoEnrichContact = jest.fn(() => ({ updates: {}, suggestedCompany: null }))
const logActivity = jest.fn(async () => undefined)
const enqueueScoreCompute = jest.fn<() => void>()

jest.unstable_mockModule('@supabase/supabase-js', () => ({
  createClient: () => createMockSupabase(store),
}))
jest.unstable_mockModule('../lib/booking-availability.js', () => ({
  getTenantCalendarCredentials,
  isSlotAvailable,
  getAvailableSlotsForDate,
  createCalendarEvent,
}))
jest.unstable_mockModule('../lib/sms.js', () => ({ sendSms }))
jest.unstable_mockModule('../lib/push-client.js', () => ({ sendPushNotification }))
jest.unstable_mockModule('../lib/contact-enrichment.js', () => ({ autoEnrichContact }))
jest.unstable_mockModule('../lib/activity.js', () => ({ logActivity }))
jest.unstable_mockModule('../lib/lead-score-queue.js', () => ({ enqueueScoreCompute }))

process.env['SUPABASE_URL'] = 'https://mock.supabase.co'
process.env['SUPABASE_SERVICE_ROLE_KEY'] = 'mock-service-key'

const TENANT_ID = 'aaaaaaaa-0000-0000-0000-00000bp00001'
const SERVICE_ID = 'svc-bp-001'
const LOCATION_ID = 'loc-bp-001'

const [{ default: express }, { default: request }, { default: bookingRouter }] = await Promise.all([
  import('express'),
  import('supertest'),
  import('./booking-public.js'),
])

function makeApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/booking', bookingRouter)
  return app
}

function seedTenant(enabled = true): void {
  ;(store.tables['tenants'] as Row[]).push({
    id: TENANT_ID,
    business_name: 'Test Clinic',
    phone: '+15125550000',
    booking_page_slug: 'test-clinic',
    booking_page_enabled: enabled,
    booking_services: [SERVICE_ID],
    booking_buffer_minutes: 15,
    booking_advance_days: 30,
    booking_confirmation_message: 'See you soon!',
    booking_google_review_url: null,
    booking_accent_color: '#2563eb',
  })
}

beforeEach(() => {
  store = createStore()
  store.tables['tenants'] = []
  store.tables['services'] = []
  store.tables['locations'] = []
  store.tables['contacts'] = []
  store.tables['appointments'] = []
  store.tables['intake_forms'] = []
  store.tables['intake_submissions'] = []

  getTenantCalendarCredentials.mockClear()
  getTenantCalendarCredentials.mockResolvedValue({
    provider: 'google',
    refreshToken: 'rt',
    calendarId: 'primary',
    timezone: 'America/Chicago',
  })
  isSlotAvailable.mockClear()
  isSlotAvailable.mockResolvedValue(true)
  createCalendarEvent.mockClear()
  createCalendarEvent.mockResolvedValue({
    googleEventId: 'gcal-test-001',
    startIso: '2026-05-04T15:00:00.000Z',
    endIso: '2026-05-04T16:00:00.000Z',
  })
  sendSms.mockClear()
  sendPushNotification.mockClear()
  autoEnrichContact.mockClear()
  autoEnrichContact.mockReturnValue({ updates: {}, suggestedCompany: null })
  logActivity.mockClear()
  enqueueScoreCompute.mockClear()
})

describe('GET /api/booking/:slug', () => {
  it('returns 200 with booking page data for valid slug', async () => {
    seedTenant(true)
    ;(store.tables['services'] as Row[]).push({
      id: SERVICE_ID,
      tenant_id: TENANT_ID,
      name: 'Cleaning',
      description: 'Dental cleaning',
      duration_minutes: 60,
      unit_price: 150,
      is_active: true,
    })
    ;(store.tables['locations'] as Row[]).push({
      id: LOCATION_ID,
      tenant_id: TENANT_ID,
      is_primary: true,
      telnyx_number: '+15125550100',
    })

    const res = await request(makeApp()).get('/api/booking/test-clinic')

    expect(res.status).toBe(200)
    expect(res.body.businessName).toBe('Test Clinic')
    expect(Array.isArray(res.body.services)).toBe(true)
    expect(res.body.services.length).toBe(1)
  })

  it('returns 404 when booking_page_enabled is false', async () => {
    seedTenant(false)

    const res = await request(makeApp()).get('/api/booking/test-clinic')

    expect(res.status).toBe(404)
  })
})

describe('POST /api/booking/:slug/confirm', () => {
  it('upserts contact, inserts appointment, logs activity, enqueues score, returns 201', async () => {
    seedTenant(true)
    ;(store.tables['services'] as Row[]).push({
      id: SERVICE_ID,
      tenant_id: TENANT_ID,
      name: 'Cleaning',
      duration_minutes: 60,
      is_active: true,
    })
    ;(store.tables['locations'] as Row[]).push({
      id: LOCATION_ID,
      tenant_id: TENANT_ID,
      is_primary: true,
      telnyx_number: '+15125550100',
    })

    const res = await request(makeApp()).post('/api/booking/test-clinic/confirm').send({
      serviceId: SERVICE_ID,
      date: '2026-05-04',
      startTime: '10:00',
      firstName: 'Jane',
      lastName: 'Doe',
      email: 'jane@example.com',
      phone: '+15125550001',
    })

    expect(res.status).toBe(201)
    expect(res.body.success).toBe(true)
    expect(res.body.appointmentId).toBeDefined()

    const contacts = store.tables['contacts'] as Row[]
    expect(contacts.length).toBe(1)

    const appts = store.tables['appointments'] as Row[]
    expect(appts.length).toBe(1)
    expect(appts[0]!['google_event_id']).toBe('gcal-test-001')

    expect(logActivity).toHaveBeenCalled()
    expect(enqueueScoreCompute).toHaveBeenCalledTimes(1)
    const args = enqueueScoreCompute.mock.calls[0]! as unknown as [string, string, string]
    expect(args[2]).toBe('appointment_booked')
    expect(sendSms).toHaveBeenCalledTimes(1)
    expect(sendPushNotification).toHaveBeenCalledTimes(1)
  })

  it('returns 409 when slot is no longer available', async () => {
    seedTenant(true)
    ;(store.tables['services'] as Row[]).push({
      id: SERVICE_ID,
      tenant_id: TENANT_ID,
      name: 'Cleaning',
      duration_minutes: 60,
      is_active: true,
    })
    isSlotAvailable.mockResolvedValueOnce(false)

    const res = await request(makeApp()).post('/api/booking/test-clinic/confirm').send({
      serviceId: SERVICE_ID,
      date: '2026-05-04',
      startTime: '10:00',
      firstName: 'Jane',
      lastName: 'Doe',
      email: 'jane@example.com',
      phone: '+15125550001',
    })

    expect(res.status).toBe(409)
  })
})
