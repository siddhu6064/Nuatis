import { jest, describe, it, expect, beforeEach } from '@jest/globals'
import { mintTestToken } from './__test-support__/jwt.js'
import {
  createStore,
  createMockSupabase,
  type MockStore,
} from './__test-support__/supabase-mock.js'

let store: MockStore = createStore()

const createSquarePayment = jest.fn(async () => ({
  paymentId: 'sq-pay-1',
  receiptUrl: 'https://example.com/receipt',
}))

jest.unstable_mockModule('@supabase/supabase-js', () => ({
  createClient: () => createMockSupabase(store),
}))
jest.unstable_mockModule('../lib/square-client.js', () => ({
  createSquarePayment,
  createSquareRefund: jest.fn(),
}))

const TENANT_ID = 'aaaaaaaa-0000-0000-0000-00000000cur1'
const USER_ID = 'user-cur-001'
const SECRET = process.env['AUTH_SECRET'] ?? 'test-secret-for-unit-tests-only-32ch'
process.env['AUTH_SECRET'] = SECRET
process.env['SUPABASE_URL'] = 'https://mock.supabase.co'
process.env['SUPABASE_SERVICE_ROLE_KEY'] = 'mock-service-key'

async function makeToken(): Promise<string> {
  return mintTestToken(
    { sub: USER_ID, tenantId: TENANT_ID, role: 'owner', vertical: 'dental' },
    { secret: SECRET }
  )
}

const { default: express } = await import('express')
const { default: request } = await import('supertest')
const { default: quotesRouter } = await import('./quotes.js')

function makeApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/quotes', quotesRouter)
  return app
}

beforeEach(() => {
  store = createStore()
  createSquarePayment.mockClear()
  store.tables['tenants'] = [
    {
      id: TENANT_ID,
      name: 'Euro Clinic',
      modules: { crm: true, cpq: true },
      settings: {},
      cpq_settings: { max_discount_pct: 20, require_approval_above: 15, deposit_pct: 0 },
      currency: 'EUR',
    },
  ]
  store.tables['quotes'] = [
    {
      id: 'quote-1',
      tenant_id: TENANT_ID,
      quote_number: 'Q-1001',
      status: 'accepted',
      total: 100,
      deposit_amount: 0,
      share_token: 'share-tok-1',
    },
  ]
  store.tables['quote_payments'] = []
})

describe('quote payments use the tenant currency, not a hardcoded USD', () => {
  it('POST /api/quotes/:id/payments passes the tenant currency to Square', async () => {
    const token = await makeToken()
    const res = await request(makeApp())
      .post('/api/quotes/quote-1/payments')
      .set('Authorization', `Bearer ${token}`)
      .send({ amount: 50, method: 'square', sourceId: 'src-1' })

    expect(res.status).toBe(201)
    expect(createSquarePayment).toHaveBeenCalledTimes(1)
    expect(createSquarePayment.mock.calls[0]?.[0]).toMatchObject({ currency: 'EUR' })
  })

  it('POST /api/quotes/view/:token/pay-square passes the tenant currency to Square', async () => {
    const res = await request(makeApp())
      .post('/api/quotes/view/share-tok-1/pay-square')
      .send({ sourceId: 'src-1', paymentType: 'full' })

    expect(res.status).toBe(200)
    expect(createSquarePayment).toHaveBeenCalledTimes(1)
    expect(createSquarePayment.mock.calls[0]?.[0]).toMatchObject({ currency: 'EUR' })
  })

  it('falls back to USD when the tenant has no currency row set', async () => {
    store.tables['tenants'] = [
      { id: TENANT_ID, name: 'No Currency Set', modules: { crm: true, cpq: true }, settings: {} },
    ]
    const res = await request(makeApp())
      .post('/api/quotes/view/share-tok-1/pay-square')
      .send({ sourceId: 'src-1', paymentType: 'full' })

    expect(res.status).toBe(200)
    expect(createSquarePayment.mock.calls[0]?.[0]).toMatchObject({ currency: 'USD' })
  })
})
