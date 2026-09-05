import { jest, describe, it, expect, beforeEach } from '@jest/globals'
import {
  createStore,
  createMockSupabase,
  type MockStore,
} from './__test-support__/supabase-mock.js'

process.env['SUPABASE_URL'] = 'https://mock.supabase.co'
process.env['SUPABASE_SERVICE_ROLE_KEY'] = 'mock-service-key'
process.env['STRIPE_SECRET_KEY'] = 'sk_test_mock'

let store: MockStore = createStore()

jest.unstable_mockModule('@supabase/supabase-js', () => ({
  createClient: () => createMockSupabase(store),
}))

jest.unstable_mockModule('../lib/auth.js', () => ({
  requireAuth: (
    req: { tenantId: string; userId: string; role: string },
    _res: unknown,
    next: () => void
  ) => {
    req.tenantId = 'tenant-1'
    req.userId = 'user-1'
    req.role = 'admin'
    next()
  },
}))

const mockPricesCreate = jest.fn(async () => ({ id: 'price_1' }))
const mockLinksCreate = jest.fn(async () => ({ id: 'plink_1', url: 'https://buy.stripe.com/xyz' }))
const mockLinksUpdate = jest.fn(async () => ({}))

jest.unstable_mockModule('stripe', () => ({
  default: jest.fn().mockImplementation(() => ({
    prices: { create: mockPricesCreate },
    paymentLinks: { create: mockLinksCreate, update: mockLinksUpdate },
  })),
}))

const mockDeactivateSquareCheckoutLink = jest.fn(async () => undefined)
jest.unstable_mockModule('../lib/square-client.js', () => ({
  createSquareCheckoutLink: jest.fn(async () => ({ id: 'sqlink_1', url: 'https://square.link/x' })),
  deactivateSquareCheckoutLink: mockDeactivateSquareCheckoutLink,
}))

const [{ default: express }, { default: request }, { default: paymentLinksRouter }] =
  await Promise.all([import('express'), import('supertest'), import('./payment-links.js')])

function makeApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/payment-links', paymentLinksRouter)
  return app
}

beforeEach(() => {
  store = createStore()
  store.tables['payment_links'] = []
  mockPricesCreate.mockClear()
  mockLinksCreate.mockClear()
  mockLinksUpdate.mockClear()
  mockDeactivateSquareCheckoutLink.mockClear()
})

describe('POST /api/payment-links', () => {
  it('accepts an optional tipAmount and returns the created link', async () => {
    const res = await request(makeApp())
      .post('/api/payment-links')
      .send({ amount: 20, tipAmount: 5, description: 'Deposit' })

    expect(res.status).toBe(201)
    expect(res.body.amount).toBe(25)
  })

  it('400s on a negative tipAmount', async () => {
    const res = await request(makeApp())
      .post('/api/payment-links')
      .send({ amount: 20, tipAmount: -5, description: 'Deposit' })

    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/tipAmount/)
  })
})

describe('DELETE /api/payment-links/:id', () => {
  it('deactivates via Square when the link was created through the Square fallback', async () => {
    store.tables['payment_links'] = [
      {
        id: 'link-1',
        tenant_id: 'tenant-1',
        stripe_link_id: null,
        square_payment_link_id: 'sqlink-1',
        processor: 'square',
        active: true,
      },
    ]

    const res = await request(makeApp()).delete('/api/payment-links/link-1')

    expect(res.status).toBe(200)
    expect(mockDeactivateSquareCheckoutLink).toHaveBeenCalledWith('tenant-1', 'sqlink-1')
    expect(mockLinksUpdate).not.toHaveBeenCalled()
  })

  it('deactivates via Stripe when the link is a Stripe link', async () => {
    store.tables['payment_links'] = [
      {
        id: 'link-2',
        tenant_id: 'tenant-1',
        stripe_link_id: 'plink_1',
        square_payment_link_id: null,
        processor: 'stripe',
        active: true,
      },
    ]

    const res = await request(makeApp()).delete('/api/payment-links/link-2')

    expect(res.status).toBe(200)
    expect(mockLinksUpdate).toHaveBeenCalledWith('plink_1', { active: false }, undefined)
    expect(mockDeactivateSquareCheckoutLink).not.toHaveBeenCalled()
  })
})
