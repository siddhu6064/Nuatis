import { jest, describe, it, expect, beforeEach } from '@jest/globals'
import {
  createStore,
  createMockSupabase,
  type MockStore,
} from './__test-support__/supabase-mock.js'

let store: MockStore = createStore()

jest.unstable_mockModule('@supabase/supabase-js', () => ({
  createClient: () => createMockSupabase(store),
}))

process.env['SUPABASE_URL'] = 'https://mock.supabase.co'
process.env['SUPABASE_SERVICE_ROLE_KEY'] = 'mock-service-key'
process.env['STRIPE_SECRET_KEY'] = 'sk_test_mock'
process.env['STRIPE_WEBHOOK_SECRET'] = 'whsec_mock'

const mockEvent = {
  type: 'setup_intent.succeeded',
  data: {
    object: {
      payment_method: 'pm_1',
      metadata: { tenant_id: 'tenant-1', contact_id: 'contact-1' },
    },
  },
}

const mockConstructEvent = jest.fn(() => mockEvent)
jest.unstable_mockModule('stripe', () => ({
  default: jest.fn().mockImplementation(() => ({
    webhooks: { constructEvent: mockConstructEvent },
  })),
}))

const attachSetupIntentPaymentMethod = jest.fn(async () => undefined)
jest.unstable_mockModule('../lib/contact-payment-methods.js', () => ({
  attachSetupIntentPaymentMethod,
}))

const { default: express } = await import('express')
const { default: request } = await import('supertest')
const { default: stripeWebhooksRouter } = await import('./stripe-webhooks.js')

function makeApp() {
  const app = express()
  app.use(express.raw({ type: '*/*' }))
  app.use('/api/webhooks/stripe', stripeWebhooksRouter)
  return app
}

beforeEach(() => {
  store = createStore()
  attachSetupIntentPaymentMethod.mockClear()
  mockConstructEvent.mockClear()
  mockConstructEvent.mockImplementation(() => mockEvent)
})

describe('POST /api/webhooks/stripe — setup_intent.succeeded', () => {
  it('calls attachSetupIntentPaymentMethod with the SetupIntent object', async () => {
    const res = await request(makeApp())
      .post('/api/webhooks/stripe')
      .set('stripe-signature', 'sig')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify(mockEvent))

    expect(res.status).toBe(200)
    expect(attachSetupIntentPaymentMethod).toHaveBeenCalledTimes(1)
    expect(attachSetupIntentPaymentMethod).toHaveBeenCalledWith(
      expect.anything(),
      mockEvent.data.object
    )
  })
})
