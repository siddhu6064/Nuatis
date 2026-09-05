import { jest, describe, it, expect, beforeEach } from '@jest/globals'
import {
  createStore,
  createMockSupabase,
  type MockStore,
} from './__test-support__/supabase-mock.js'

let store: MockStore = createStore()

let webhookEvent: unknown = null
const mockConstructEvent = jest.fn(() => webhookEvent)
const mockSubRetrieve = jest.fn()

jest.unstable_mockModule('@supabase/supabase-js', () => ({
  createClient: () => createMockSupabase(store),
}))
jest.unstable_mockModule('stripe', () => ({
  default: jest.fn().mockImplementation(() => ({
    webhooks: { constructEvent: mockConstructEvent },
    subscriptions: { retrieve: mockSubRetrieve },
  })),
}))

const TENANT_ID = 'aaaaaaaa-0000-0000-0000-00000dn00001'
process.env['SUPABASE_URL'] = 'https://mock.supabase.co'
process.env['SUPABASE_SERVICE_ROLE_KEY'] = 'mock-service-key'
process.env['STRIPE_SECRET_KEY'] = 'sk_test_mock'
process.env['STRIPE_WEBHOOK_SECRET'] = 'whsec_mock'
process.env['PLATFORM_TENANT_ID'] = 'platform-tenant'
process.env['STRIPE_PRICE_CORE_MONTHLY'] = 'price_core_m'
process.env['STRIPE_PRICE_PRO_MONTHLY'] = 'price_pro_m'
process.env['STRIPE_PRICE_SCALE_MONTHLY'] = 'price_scale_m'

const { default: express } = await import('express')
const { default: request } = await import('supertest')
const { default: webhooksRouter } = await import('./stripe-billing-webhooks.js')

function makeApp() {
  const app = express()
  app.use('/api/webhooks/stripe-billing', express.raw({ type: '*/*' }), webhooksRouter)
  return app
}

beforeEach(() => {
  store = createStore()
  store.tables['tenants'] = [
    {
      id: TENANT_ID,
      name: 'Dunning Co',
      stripe_customer_id: 'cus_dun',
      billing_email: 'owner@dunningco.example',
      payment_failure_count: 0,
    },
  ]
  mockConstructEvent.mockClear()
  webhookEvent = null
})

async function sendEvent(app: ReturnType<typeof makeApp>, type: string) {
  webhookEvent = { type, data: { object: { customer: 'cus_dun', period_end: 0 } } }
  return request(app)
    .post('/api/webhooks/stripe-billing')
    .set('stripe-signature', 'sig')
    .send(Buffer.from('{}'))
}

describe('invoice.payment_failed — dunning escalation', () => {
  it('increments payment_failure_count on each failure', async () => {
    const app = makeApp()

    const res1 = await sendEvent(app, 'invoice.payment_failed')
    expect(res1.status).toBe(200)
    let tenant = store.tables['tenants']?.[0]
    expect(tenant?.['payment_failure_count']).toBe(1)
    expect(tenant?.['subscription_status']).toBe('past_due')

    const res2 = await sendEvent(app, 'invoice.payment_failed')
    expect(res2.status).toBe(200)
    tenant = store.tables['tenants']?.[0]
    expect(tenant?.['payment_failure_count']).toBe(2)

    const res3 = await sendEvent(app, 'invoice.payment_failed')
    expect(res3.status).toBe(200)
    tenant = store.tables['tenants']?.[0]
    expect(tenant?.['payment_failure_count']).toBe(3)
  })

  it('resets payment_failure_count to 0 once a payment succeeds', async () => {
    store.tables['tenants'] = [
      {
        id: TENANT_ID,
        name: 'Dunning Co',
        stripe_customer_id: 'cus_dun',
        billing_email: 'owner@dunningco.example',
        payment_failure_count: 2,
      },
    ]
    const app = makeApp()

    const res = await sendEvent(app, 'invoice.payment_succeeded')
    expect(res.status).toBe(200)
    const tenant = store.tables['tenants']?.[0]
    expect(tenant?.['payment_failure_count']).toBe(0)
    expect(tenant?.['subscription_status']).toBe('active')
  })
})
