import { jest, describe, it, expect, beforeEach } from '@jest/globals'
import { mintTestToken } from './__test-support__/jwt.js'
import { randomUUID } from 'node:crypto'
import {
  createStore,
  createMockSupabase,
  type MockStore,
  type Row,
} from './__test-support__/supabase-mock.js'
import { seedEntitledTenant } from './__test-support__/tenant-fixture.js'

let store: MockStore = createStore()

jest.unstable_mockModule('@supabase/supabase-js', () => ({
  createClient: () => createMockSupabase(store),
}))
// No STRIPE_SECRET_KEY set — getStripe() returns null, so the Stripe-charges
// half of both routes is a no-op and only the quote_payments path is exercised.

const TENANT_ID = 'aaaaaaaa-0000-0000-0000-00000pl00001'
const USER_ID = 'user-pl-001'
const SECRET = process.env['AUTH_SECRET'] ?? 'test-secret-for-unit-tests-only-32ch'
process.env['AUTH_SECRET'] = SECRET
process.env['SUPABASE_URL'] = 'https://mock.supabase.co'
process.env['SUPABASE_SERVICE_ROLE_KEY'] = 'mock-service-key'

async function makeToken(): Promise<string> {
  return mintTestToken({ sub: USER_ID, tenantId: TENANT_ID, role: 'owner' }, { secret: SECRET })
}

const { default: express } = await import('express')
const { default: request } = await import('supertest')
const { default: paymentsRouter } = await import('./payments.js')

function makeApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/payments', paymentsRouter)
  return app
}

beforeEach(() => {
  store = createStore()
  seedEntitledTenant(store, TENANT_ID)
  store.tables['quote_payments'] = []
})

describe('GET /api/payments/ledger', () => {
  it('surfaces a square payment with source "square", not miscategorized as "other"', async () => {
    ;(store.tables['quote_payments'] as Row[]).push({
      id: randomUUID(),
      tenant_id: TENANT_ID,
      amount: 150,
      method: 'square',
      recorded_at: new Date().toISOString(),
      notes: null,
      quote_id: null,
    })

    const token = await makeToken()
    const res = await request(makeApp())
      .get('/api/payments/ledger')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.transactions).toHaveLength(1)
    expect(res.body.transactions[0].source).toBe('square')
    expect(res.body.manualVolume).toBe(150)
  })
})

describe('GET /api/payments/summary', () => {
  it('buckets a square payment under its own byMethod.square, not "other"', async () => {
    ;(store.tables['quote_payments'] as Row[]).push({
      id: randomUUID(),
      tenant_id: TENANT_ID,
      amount: 75,
      method: 'square',
      recorded_at: new Date().toISOString(),
    })

    const token = await makeToken()
    const res = await request(makeApp())
      .get('/api/payments/summary')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.byMethod.square).toEqual({ count: 1, amount: 75 })
    expect(res.body.byMethod.other).toEqual({ count: 0, amount: 0 })
  })
})
