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

const createSquarePayment = jest.fn()
const createSquareRefund = jest.fn(async () => ({ refundId: 'refund_1', status: 'COMPLETED' }))
const createSquareCheckoutLink = jest.fn()
jest.unstable_mockModule('../lib/square-client.js', () => ({
  createSquarePayment,
  createSquareRefund,
  createSquareCheckoutLink,
}))

process.env['STRIPE_SECRET_KEY'] = 'sk_test_mock'
const mockRefundsCreate = jest.fn(async () => ({ id: 're_1', status: 'succeeded' }))
jest.unstable_mockModule('stripe', () => ({
  default: jest.fn().mockImplementation(() => ({
    refunds: { create: mockRefundsCreate },
  })),
}))

const TENANT_ID = 'aaaaaaaa-0000-0000-0000-00000000rf01'
const OWNER_ID = 'owner-1'
const SECRET = process.env['AUTH_SECRET'] ?? 'test-secret-for-unit-tests-only-32ch'
process.env['AUTH_SECRET'] = SECRET
process.env['SUPABASE_URL'] = 'https://mock.supabase.co'
process.env['SUPABASE_SERVICE_ROLE_KEY'] = 'mock-service-key'
delete process.env['TELNYX_API_KEY']
delete process.env['REDIS_URL']

async function makeToken(role = 'owner'): Promise<string> {
  return mintTestToken(
    { sub: OWNER_ID, appUserId: OWNER_ID, tenantId: TENANT_ID, role, vertical: 'dental' },
    { secret: SECRET }
  )
}

const [
  { default: express },
  { default: request },
  { default: quotesRouter },
  { default: appointmentsRouter },
] = await Promise.all([
  import('express'),
  import('supertest'),
  import('./quotes.js'),
  import('./appointments.js'),
])

function makeApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/quotes', quotesRouter)
  app.use('/api/appointments', appointmentsRouter)
  return app
}

function seedTenant(overrides: Record<string, unknown> = {}) {
  store.tables['tenants'] = [
    {
      id: TENANT_ID,
      name: 'Test Biz',
      modules: { crm: true, cpq: true },
      settings: {},
      cpq_settings: { max_discount_pct: 20, require_approval_above: 15, deposit_pct: 0 },
      ...overrides,
    },
  ]
}

beforeEach(() => {
  store = createStore()
  seedTenant()
  store.tables['quotes'] = [{ id: 'quote-1', tenant_id: TENANT_ID, total: 200, status: 'accepted' }]
  store.tables['quote_payments'] = []
  store.tables['appointments'] = []
  createSquarePayment.mockClear()
  createSquareRefund.mockClear()
  createSquareRefund.mockResolvedValue({ refundId: 'refund_1', status: 'COMPLETED' })
  mockRefundsCreate.mockClear()
})

describe('POST /api/quotes/:id/payments/:paymentId/refund', () => {
  function seedPayment(overrides: Record<string, unknown> = {}) {
    const row = {
      id: 'qp-1',
      quote_id: 'quote-1',
      tenant_id: TENANT_ID,
      amount: 100,
      method: 'square',
      provider: 'square',
      square_payment_id: 'sq_pay_1',
      refunded_amount: 0,
      refund_status: 'none',
      ...overrides,
    }
    ;(store.tables['quote_payments'] as Row[]).push(row)
    return row
  }

  it('refunds the full remaining amount when no amount is given', async () => {
    seedPayment()
    const token = await makeToken()
    const res = await request(makeApp())
      .post('/api/quotes/quote-1/payments/qp-1/refund')
      .set('Authorization', `Bearer ${token}`)
      .send({})

    expect(res.status).toBe(200)
    expect(res.body.refund_status).toBe('full')
    expect(res.body.refunded_amount).toBe(100)
    expect(createSquareRefund).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: TENANT_ID, paymentId: 'sq_pay_1', amountCents: 10000 })
    )
  })

  it('supports a partial refund and leaves refund_status as partial', async () => {
    seedPayment()
    const token = await makeToken()
    const res = await request(makeApp())
      .post('/api/quotes/quote-1/payments/qp-1/refund')
      .set('Authorization', `Bearer ${token}`)
      .send({ amount: 40 })

    expect(res.status).toBe(200)
    expect(res.body.refund_status).toBe('partial')
    expect(res.body.refunded_amount).toBe(40)
  })

  it('rejects a refund larger than the remaining refundable amount', async () => {
    seedPayment({ refunded_amount: 60 })
    const token = await makeToken()
    const res = await request(makeApp())
      .post('/api/quotes/quote-1/payments/qp-1/refund')
      .set('Authorization', `Bearer ${token}`)
      .send({ amount: 50 })

    expect(res.status).toBe(400)
    expect(createSquareRefund).not.toHaveBeenCalled()
  })

  it('400s a payment with no processor id (e.g. a manually-recorded "stripe" row)', async () => {
    seedPayment({ provider: 'stripe', square_payment_id: null, method: 'stripe' })
    const token = await makeToken()
    const res = await request(makeApp())
      .post('/api/quotes/quote-1/payments/qp-1/refund')
      .set('Authorization', `Bearer ${token}`)
      .send({})

    expect(res.status).toBe(400)
    expect(createSquareRefund).not.toHaveBeenCalled()
  })

  it('404s a payment belonging to another tenant', async () => {
    seedPayment({ tenant_id: 'other-tenant' })
    const token = await makeToken()
    const res = await request(makeApp())
      .post('/api/quotes/quote-1/payments/qp-1/refund')
      .set('Authorization', `Bearer ${token}`)
      .send({})

    expect(res.status).toBe(404)
  })

  it('403s a staff role', async () => {
    seedPayment()
    const token = await makeToken('staff')
    const res = await request(makeApp())
      .post('/api/quotes/quote-1/payments/qp-1/refund')
      .set('Authorization', `Bearer ${token}`)
      .send({})

    expect(res.status).toBe(403)
  })
})

describe('POST /api/appointments/:id/refund-fee', () => {
  function seedAppt(overrides: Record<string, unknown> = {}) {
    const row = {
      id: 'appt-1',
      tenant_id: TENANT_ID,
      contact_id: 'contact-1',
      title: 'Cleanup',
      start_time: new Date().toISOString(),
      end_time: new Date().toISOString(),
      status: 'canceled',
      fee_amount_cents: 3000,
      fee_status: 'charged',
      fee_payment_intent_id: 'pi_1',
      ...overrides,
    }
    ;(store.tables['appointments'] as Row[]).push(row)
    return row
  }

  it('refunds a charged fee via Stripe', async () => {
    seedAppt()
    const token = await makeToken()
    const res = await request(makeApp())
      .post('/api/appointments/appt-1/refund-fee')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.fee_status).toBe('refunded')
    expect(mockRefundsCreate).toHaveBeenCalledWith({ payment_intent: 'pi_1' }, undefined)
  })

  it('400s when the fee was only ever a payment link (no PaymentIntent id)', async () => {
    seedAppt({ fee_status: 'link_sent', fee_payment_intent_id: null })
    const token = await makeToken()
    const res = await request(makeApp())
      .post('/api/appointments/appt-1/refund-fee')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(400)
    expect(mockRefundsCreate).not.toHaveBeenCalled()
  })

  it('404s an appointment in another tenant', async () => {
    seedAppt({ tenant_id: 'other-tenant' })
    const token = await makeToken()
    const res = await request(makeApp())
      .post('/api/appointments/appt-1/refund-fee')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(404)
  })

  it('403s a staff role', async () => {
    seedAppt()
    const token = await makeToken('staff')
    const res = await request(makeApp())
      .post('/api/appointments/appt-1/refund-fee')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(403)
  })
})
