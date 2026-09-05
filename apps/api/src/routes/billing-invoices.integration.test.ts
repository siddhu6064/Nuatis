import { jest, describe, it, expect, beforeEach } from '@jest/globals'
import { mintTestToken } from './__test-support__/jwt.js'
import {
  createStore,
  createMockSupabase,
  type MockStore,
} from './__test-support__/supabase-mock.js'
import { entitledTenantRow } from './__test-support__/tenant-fixture.js'

let store: MockStore = createStore()

const mockInvoicesList = jest.fn(async () => ({
  data: [
    {
      id: 'in_1',
      number: 'INV-001',
      status: 'paid',
      amount_paid: 29900,
      currency: 'usd',
      created: 1_700_000_000,
      hosted_invoice_url: 'https://stripe.example/invoice/in_1',
      invoice_pdf: 'https://stripe.example/invoice/in_1.pdf',
    },
  ],
}))

jest.unstable_mockModule('@supabase/supabase-js', () => ({
  createClient: () => createMockSupabase(store),
}))
jest.unstable_mockModule('stripe', () => ({
  default: jest.fn().mockImplementation(() => ({
    invoices: { list: mockInvoicesList },
  })),
}))

const TENANT_ID = 'aaaaaaaa-0000-0000-0000-00000bi00001'
const SECRET = process.env['AUTH_SECRET'] ?? 'test-secret-for-unit-tests-only-32ch'
process.env['AUTH_SECRET'] = SECRET
process.env['SUPABASE_URL'] = 'https://mock.supabase.co'
process.env['SUPABASE_SERVICE_ROLE_KEY'] = 'mock-service-key'
process.env['STRIPE_SECRET_KEY'] = 'sk_test_mock'
process.env['STRIPE_PRICE_CORE_MONTHLY'] = 'price_core_m'
process.env['STRIPE_PRICE_PRO_MONTHLY'] = 'price_pro_m'
process.env['STRIPE_PRICE_SCALE_MONTHLY'] = 'price_scale_m'

async function makeToken(): Promise<string> {
  return mintTestToken({ sub: 'user-1', tenantId: TENANT_ID, role: 'owner' }, { secret: SECRET })
}

const { default: express } = await import('express')
const { default: request } = await import('supertest')
const { default: billingRouter } = await import('./billing.js')

function makeApp() {
  const app = express()
  app.use('/api/billing', express.json(), billingRouter)
  return app
}

beforeEach(() => {
  store = createStore()
  mockInvoicesList.mockClear()
})

describe('GET /api/billing/invoices', () => {
  it('lists Stripe invoices for the tenant customer', async () => {
    store.tables['tenants'] = [entitledTenantRow(TENANT_ID, { stripe_customer_id: 'cus_123' })]
    const token = await makeToken()
    const res = await request(makeApp())
      .get('/api/billing/invoices')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.invoices).toHaveLength(1)
    expect(res.body.invoices[0]).toMatchObject({
      id: 'in_1',
      number: 'INV-001',
      amount_paid_cents: 29900,
    })
    expect(mockInvoicesList).toHaveBeenCalledWith({ customer: 'cus_123', limit: 24 })
  })

  it('returns an empty list when the tenant has no Stripe customer yet', async () => {
    store.tables['tenants'] = [entitledTenantRow(TENANT_ID, { stripe_customer_id: null })]
    const token = await makeToken()
    const res = await request(makeApp())
      .get('/api/billing/invoices')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.invoices).toEqual([])
    expect(mockInvoicesList).not.toHaveBeenCalled()
  })
})
