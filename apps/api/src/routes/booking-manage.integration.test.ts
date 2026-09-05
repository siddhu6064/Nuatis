import { jest, describe, it, expect, beforeEach } from '@jest/globals'
import {
  createStore,
  createMockSupabase,
  type MockStore,
} from './__test-support__/supabase-mock.js'

let store: MockStore = createStore()

const getTenantCalendarCredentials = jest.fn(async () => ({
  provider: 'native' as const,
  calendarId: 'primary',
  timezone: 'America/Chicago',
  tenantId: TENANT_ID,
  refreshToken: '',
}))
const isSlotAvailable = jest.fn(async () => true)
const getAvailableSlotsForDate = jest.fn(async () => ({
  slots: [{ start: '10:00', end: '10:30' }],
  closed: false,
}))
const logActivity = jest.fn(async () => undefined)
const chargeContactSavedMethod = jest.fn(async () => ({
  charged: false as const,
  reason: 'no_saved_method' as const,
}))
const createPaymentLink = jest.fn(async () => ({
  id: 'link-1',
  url: 'https://buy.stripe.com/cancel-fee-link',
  amount: 30,
  description: 'Late cancellation fee',
  processor: 'stripe' as const,
}))

jest.unstable_mockModule('@supabase/supabase-js', () => ({
  createClient: () => createMockSupabase(store),
}))
jest.unstable_mockModule('../lib/booking-availability.js', () => ({
  getTenantCalendarCredentials,
  isSlotAvailable,
  getAvailableSlotsForDate,
}))
jest.unstable_mockModule('../lib/activity.js', () => ({ logActivity }))
jest.unstable_mockModule('../lib/contact-payment-methods.js', () => ({ chargeContactSavedMethod }))
jest.unstable_mockModule('../lib/payment-link.js', () => ({ createPaymentLink }))

process.env['SUPABASE_URL'] = 'https://mock.supabase.co'
process.env['SUPABASE_SERVICE_ROLE_KEY'] = 'mock-service-key'

const TENANT_ID = 'aaaaaaaa-0000-0000-0000-00000bm00001'
const TOKEN = 'test-manage-token-1'

const { default: express } = await import('express')
const { default: request } = await import('supertest')
const { default: bookingManageRouter } = await import('./booking-manage.js')

function makeApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/booking-manage', bookingManageRouter)
  return app
}

function farFutureIso(hoursFromNow: number): string {
  return new Date(Date.now() + hoursFromNow * 3600_000).toISOString()
}

beforeEach(() => {
  store = createStore()
  store.tables['tenants'] = [{ id: TENANT_ID, name: 'Test Biz', booking_min_notice_hours: 2 }]
  store.tables['appointments'] = [
    {
      id: 'appt-1',
      tenant_id: TENANT_ID,
      contact_id: 'contact-1',
      title: 'Haircut',
      manage_token: TOKEN,
      start_time: farFutureIso(48),
      end_time: farFutureIso(48.5),
      status: 'scheduled',
      deleted_at: null,
    },
  ]
  getTenantCalendarCredentials.mockClear()
  isSlotAvailable.mockClear()
  isSlotAvailable.mockResolvedValue(true)
  getAvailableSlotsForDate.mockClear()
  logActivity.mockClear()
  chargeContactSavedMethod.mockClear()
  chargeContactSavedMethod.mockResolvedValue({ charged: false, reason: 'no_saved_method' })
  createPaymentLink.mockClear()
})

async function flush(): Promise<void> {
  await new Promise((r) => setTimeout(r, 20))
}

describe('GET /api/booking-manage/:token', () => {
  it('returns appointment details and can_modify=true when well outside the notice window', async () => {
    const res = await request(makeApp()).get(`/api/booking-manage/${TOKEN}`)
    expect(res.status).toBe(200)
    expect(res.body.title).toBe('Haircut')
    expect(res.body.can_modify).toBe(true)
  })

  it('404s for an unknown token', async () => {
    const res = await request(makeApp()).get('/api/booking-manage/nope')
    expect(res.status).toBe(404)
  })

  it('can_modify=false inside the notice window', async () => {
    store.tables['appointments']![0]!['start_time'] = farFutureIso(1) // starts in 1h, notice=2h
    const res = await request(makeApp()).get(`/api/booking-manage/${TOKEN}`)
    expect(res.status).toBe(200)
    expect(res.body.can_modify).toBe(false)
  })

  it('can_modify=false for an already-canceled appointment', async () => {
    store.tables['appointments']![0]!['status'] = 'canceled'
    const res = await request(makeApp()).get(`/api/booking-manage/${TOKEN}`)
    expect(res.body.can_modify).toBe(false)
  })
})

describe('POST /api/booking-manage/:token/reschedule', () => {
  it('reschedules to a new available slot', async () => {
    const res = await request(makeApp())
      .post(`/api/booking-manage/${TOKEN}/reschedule`)
      .send({ date: '2027-01-15', start_time: '10:00' })

    expect(res.status).toBe(200)
    expect(res.body.status).toBe('scheduled')
    expect(logActivity).toHaveBeenCalledTimes(1)
  })

  it('409s when inside the notice window', async () => {
    store.tables['appointments']![0]!['start_time'] = farFutureIso(1)
    const res = await request(makeApp())
      .post(`/api/booking-manage/${TOKEN}/reschedule`)
      .send({ date: '2027-01-15', start_time: '10:00' })
    expect(res.status).toBe(409)
  })

  it('409s when the requested slot is no longer available', async () => {
    isSlotAvailable.mockResolvedValueOnce(false)
    const res = await request(makeApp())
      .post(`/api/booking-manage/${TOKEN}/reschedule`)
      .send({ date: '2027-01-15', start_time: '10:00' })
    expect(res.status).toBe(409)
  })

  it('400s a malformed date', async () => {
    const res = await request(makeApp())
      .post(`/api/booking-manage/${TOKEN}/reschedule`)
      .send({ date: 'not-a-date', start_time: '10:00' })
    expect(res.status).toBe(400)
  })
})

describe('POST /api/booking-manage/:token/cancel', () => {
  it('cancels the appointment', async () => {
    const res = await request(makeApp()).post(`/api/booking-manage/${TOKEN}/cancel`)
    expect(res.status).toBe(200)
    expect(store.tables['appointments']?.[0]?.['status']).toBe('canceled')
  })

  it('409s when inside the notice window', async () => {
    store.tables['appointments']![0]!['start_time'] = farFutureIso(1)
    const res = await request(makeApp()).post(`/api/booking-manage/${TOKEN}/cancel`)
    expect(res.status).toBe(409)
  })

  it('charges the late-cancellation fee via a payment link — previously a silent bypass', async () => {
    store.tables['tenants']![0]!['no_show_fee_cents'] = 3000
    store.tables['tenants']![0]!['cancellation_fee_notice_hours'] = 72
    const res = await request(makeApp()).post(`/api/booking-manage/${TOKEN}/cancel`)
    expect(res.status).toBe(200)
    await flush()
    expect(createPaymentLink).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: TENANT_ID, contactId: 'contact-1', amount: 30 })
    )
    expect(store.tables['appointments']?.[0]?.['fee_status']).toBe('link_sent')
  })

  it('does not attempt a fee when the tenant has no fee policy configured', async () => {
    const res = await request(makeApp()).post(`/api/booking-manage/${TOKEN}/cancel`)
    expect(res.status).toBe(200)
    await flush()
    expect(createPaymentLink).not.toHaveBeenCalled()
    expect(chargeContactSavedMethod).not.toHaveBeenCalled()
  })
})
