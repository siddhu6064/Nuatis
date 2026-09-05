import { jest, describe, it, expect, beforeEach } from '@jest/globals'
import { mintTestToken } from './__test-support__/jwt.js'
import {
  createStore,
  createMockSupabase,
  type MockStore,
  type Row,
} from './__test-support__/supabase-mock.js'

let store: MockStore = createStore()

jest.unstable_mockModule('@supabase/supabase-js', () => ({
  createClient: () => createMockSupabase(store),
}))

const createPaymentLink = jest.fn(async () => ({
  id: 'link-1',
  url: 'https://buy.stripe.com/cancel-fee-link',
  amount: 30,
  description: 'Late cancellation fee',
  processor: 'stripe',
}))
const mockStripeRefundsCreate = jest.fn(async () => ({ id: 're_1', status: 'succeeded' }))
jest.unstable_mockModule('../lib/payment-link.js', () => ({
  createPaymentLink,
  getStripe: () => ({ refunds: { create: mockStripeRefundsCreate } }),
}))

const chargeContactSavedMethod = jest.fn(async () => ({
  charged: false as const,
  reason: 'no_saved_method' as const,
}))
jest.unstable_mockModule('../lib/contact-payment-methods.js', () => ({ chargeContactSavedMethod }))

const TENANT_ID = 'aaaaaaaa-0000-0000-0000-00000cf00001'
const CONTACT_ID = 'contact-1'
const SECRET = process.env['AUTH_SECRET'] ?? 'test-secret-for-unit-tests-only-32ch'
process.env['AUTH_SECRET'] = SECRET
process.env['SUPABASE_URL'] = 'https://mock.supabase.co'
process.env['SUPABASE_SERVICE_ROLE_KEY'] = 'mock-service-key'

async function makeToken(): Promise<string> {
  return mintTestToken({ sub: 'user-1', tenantId: TENANT_ID, role: 'owner' }, { secret: SECRET })
}

const { default: express } = await import('express')
const { default: request } = await import('supertest')
const { default: appointmentsRouter } = await import('./appointments.js')

function makeApp() {
  const app = express()
  app.use('/api/appointments', express.json(), appointmentsRouter)
  return app
}

async function flush(): Promise<void> {
  await new Promise((r) => setTimeout(r, 20))
}

beforeEach(() => {
  store = createStore()
  store.tables['tenants'] = [{ id: TENANT_ID, modules: { scheduling: true } }]
  store.tables['locations'] = []
  store.tables['resource_bookings'] = []
  createPaymentLink.mockClear()
  chargeContactSavedMethod.mockClear()
  chargeContactSavedMethod.mockImplementation(async () => ({
    charged: false as const,
    reason: 'no_saved_method' as const,
  }))
})

describe('PATCH /api/appointments/:id — cancellation fee', () => {
  it('creates a fee link when cancelled inside the notice window', async () => {
    ;(store.tables['tenants'] as Row[])[0]!['no_show_fee_cents'] = 3000
    ;(store.tables['tenants'] as Row[])[0]!['cancellation_fee_notice_hours'] = 48
    store.tables['appointments'] = [
      {
        id: 'appt-1',
        tenant_id: TENANT_ID,
        contact_id: CONTACT_ID,
        status: 'scheduled',
        start_time: new Date(Date.now() + 5 * 3_600_000).toISOString(), // 5h away
        end_time: new Date(Date.now() + 6 * 3_600_000).toISOString(),
      },
    ]

    const token = await makeToken()
    const res = await request(makeApp())
      .patch('/api/appointments/appt-1')
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'canceled' })

    expect(res.status).toBe(200)
    await flush()

    expect(createPaymentLink).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: TENANT_ID, amount: 30, contactId: CONTACT_ID })
    )
    const row = (store.tables['appointments'] as Row[]).find((r) => r['id'] === 'appt-1')
    expect(row?.['fee_amount_cents']).toBe(3000)
    expect(row?.['fee_payment_link_url']).toBe('https://buy.stripe.com/cancel-fee-link')
    expect(row?.['fee_status']).toBe('link_sent')
  })

  it('charges the saved payment method instead of sending a link when one exists', async () => {
    chargeContactSavedMethod.mockImplementation(async () => ({
      charged: true as const,
      paymentIntentId: 'pi_1',
    }))
    ;(store.tables['tenants'] as Row[])[0]!['no_show_fee_cents'] = 3000
    ;(store.tables['tenants'] as Row[])[0]!['cancellation_fee_notice_hours'] = 48
    store.tables['appointments'] = [
      {
        id: 'appt-charge',
        tenant_id: TENANT_ID,
        contact_id: CONTACT_ID,
        status: 'scheduled',
        start_time: new Date(Date.now() + 5 * 3_600_000).toISOString(),
        end_time: new Date(Date.now() + 6 * 3_600_000).toISOString(),
      },
    ]

    const token = await makeToken()
    const res = await request(makeApp())
      .patch('/api/appointments/appt-charge')
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'canceled' })

    expect(res.status).toBe(200)
    await flush()

    expect(createPaymentLink).not.toHaveBeenCalled()
    const row = (store.tables['appointments'] as Row[]).find((r) => r['id'] === 'appt-charge')
    expect(row?.['fee_amount_cents']).toBe(3000)
    expect(row?.['fee_status']).toBe('charged')
  })

  it('does not create a fee link when cancelled outside the notice window', async () => {
    ;(store.tables['tenants'] as Row[])[0]!['no_show_fee_cents'] = 3000
    ;(store.tables['tenants'] as Row[])[0]!['cancellation_fee_notice_hours'] = 24
    store.tables['appointments'] = [
      {
        id: 'appt-2',
        tenant_id: TENANT_ID,
        contact_id: CONTACT_ID,
        status: 'scheduled',
        start_time: new Date(Date.now() + 72 * 3_600_000).toISOString(), // 72h away
        end_time: new Date(Date.now() + 73 * 3_600_000).toISOString(),
      },
    ]

    const token = await makeToken()
    const res = await request(makeApp())
      .patch('/api/appointments/appt-2')
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'canceled' })

    expect(res.status).toBe(200)
    await flush()

    expect(createPaymentLink).not.toHaveBeenCalled()
  })

  it('does not create a fee link when no notice window is configured', async () => {
    ;(store.tables['tenants'] as Row[])[0]!['no_show_fee_cents'] = 3000
    ;(store.tables['tenants'] as Row[])[0]!['cancellation_fee_notice_hours'] = null
    store.tables['appointments'] = [
      {
        id: 'appt-3',
        tenant_id: TENANT_ID,
        contact_id: CONTACT_ID,
        status: 'scheduled',
        start_time: new Date(Date.now() + 1 * 3_600_000).toISOString(),
        end_time: new Date(Date.now() + 2 * 3_600_000).toISOString(),
      },
    ]

    const token = await makeToken()
    const res = await request(makeApp())
      .patch('/api/appointments/appt-3')
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'canceled' })

    expect(res.status).toBe(200)
    await flush()

    expect(createPaymentLink).not.toHaveBeenCalled()
  })
})
