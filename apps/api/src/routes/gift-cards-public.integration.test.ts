import { jest, describe, it, expect, beforeEach } from '@jest/globals'
import { randomUUID } from 'node:crypto'
import {
  createStore,
  createMockSupabase,
  type MockStore,
  type Row,
} from './__test-support__/supabase-mock.js'

let store: MockStore = createStore()

const mockPricesCreate = jest.fn(async () => ({ id: 'price_gcp_1' }))
const mockPaymentLinksCreate = jest.fn(async () => ({
  id: 'plink_gcp_1',
  url: 'https://checkout.stripe.com/pay/plink_gcp_1',
}))

jest.unstable_mockModule('@supabase/supabase-js', () => ({
  createClient: () => createMockSupabase(store),
}))
jest.unstable_mockModule('stripe', () => ({
  default: jest.fn().mockImplementation(() => ({
    prices: { create: mockPricesCreate },
    paymentLinks: { create: mockPaymentLinksCreate },
  })),
}))

const TENANT_ID = 'aaaaaaaa-0000-0000-0000-00000gp00001'
process.env['SUPABASE_URL'] = 'https://mock.supabase.co'
process.env['SUPABASE_SERVICE_ROLE_KEY'] = 'mock-service-key'
process.env['STRIPE_SECRET_KEY'] = 'sk_test_mock'

const { default: express } = await import('express')
const { default: request } = await import('supertest')
const { default: giftCardsPublicRouter } = await import('./gift-cards-public.js')

function makeApp() {
  const app = express()
  app.use('/api/gift-cards-public', express.json(), giftCardsPublicRouter)
  return app
}

beforeEach(() => {
  store = createStore()
  store.tables['tenants'] = [
    { id: TENANT_ID, name: 'Test Biz', booking_page_slug: 'test-biz', booking_page_enabled: true },
  ]
  store.tables['contacts'] = []
  store.tables['gift_cards'] = []
  mockPricesCreate.mockClear()
  mockPaymentLinksCreate.mockClear()
})

describe('POST /api/gift-cards-public/:slug', () => {
  it('creates a pending_payment gift card, a buyer contact, and returns a payment_url', async () => {
    const res = await request(makeApp()).post('/api/gift-cards-public/test-biz').send({
      amount_cents: 5000,
      buyer_name: 'Jane Buyer',
      buyer_phone: '+15125550001',
      buyer_email: 'jane@example.com',
    })

    expect(res.status).toBe(201)
    expect(res.body.status).toBe('pending_payment')
    expect(res.body.payment_url).toBe('https://checkout.stripe.com/pay/plink_gcp_1')

    const cards = store.tables['gift_cards'] as Row[]
    expect(cards).toHaveLength(1)
    expect(cards[0]?.['payment_method']).toBe('stripe')
    expect(cards[0]?.['recipient_name']).toBe('Jane Buyer')

    const contacts = store.tables['contacts'] as Row[]
    expect(contacts).toHaveLength(1)
    expect(contacts[0]?.['source']).toBe('web_form')
    expect(cards[0]?.['purchased_by_contact_id']).toBe(contacts[0]?.['id'])
  })

  it('reuses an existing contact by phone instead of creating a duplicate', async () => {
    ;(store.tables['contacts'] as Row[]).push({
      id: 'existing-buyer',
      tenant_id: TENANT_ID,
      full_name: 'Jane Buyer',
      phone: '+15125550001',
      email: null,
    })

    const res = await request(makeApp()).post('/api/gift-cards-public/test-biz').send({
      amount_cents: 5000,
      buyer_name: 'Jane Buyer',
      buyer_phone: '+15125550001',
    })

    expect(res.status).toBe(201)
    expect(store.tables['contacts']).toHaveLength(1)
    const cards = store.tables['gift_cards'] as Row[]
    expect(cards[0]?.['purchased_by_contact_id']).toBe('existing-buyer')
  })

  it('400s on an amount below the minimum', async () => {
    const res = await request(makeApp()).post('/api/gift-cards-public/test-biz').send({
      amount_cents: 100,
      buyer_name: 'Jane Buyer',
      buyer_phone: '+15125550001',
    })
    expect(res.status).toBe(400)
    expect(mockPaymentLinksCreate).not.toHaveBeenCalled()
  })

  it('400s on an amount above the cap', async () => {
    const res = await request(makeApp()).post('/api/gift-cards-public/test-biz').send({
      amount_cents: 200000,
      buyer_name: 'Jane Buyer',
      buyer_phone: '+15125550001',
    })
    expect(res.status).toBe(400)
  })

  it('400s without a name or without phone/email', async () => {
    const res = await request(makeApp())
      .post('/api/gift-cards-public/test-biz')
      .send({ amount_cents: 5000, buyer_name: 'Jane Buyer' })
    expect(res.status).toBe(400)
  })

  it('404s for an unknown slug', async () => {
    const res = await request(makeApp()).post('/api/gift-cards-public/no-such-biz').send({
      amount_cents: 5000,
      buyer_name: 'Jane Buyer',
      buyer_phone: '+15125550001',
    })
    expect(res.status).toBe(404)
  })

  it('404s when the tenant has booking_page_enabled false', async () => {
    store.tables['tenants'] = [
      {
        id: TENANT_ID,
        name: 'Test Biz',
        booking_page_slug: 'test-biz',
        booking_page_enabled: false,
      },
    ]
    const res = await request(makeApp()).post('/api/gift-cards-public/test-biz').send({
      amount_cents: 5000,
      buyer_name: 'Jane Buyer',
      buyer_phone: '+15125550001',
    })
    expect(res.status).toBe(404)
  })
})

describe('GET /api/gift-cards-public/:slug/balance/:code', () => {
  it('returns balance/status for a valid code, tenant-scoped', async () => {
    ;(store.tables['gift_cards'] as Row[]).push({
      id: randomUUID(),
      tenant_id: TENANT_ID,
      code: 'GIFTPUB1',
      balance_cents: 2500,
      status: 'active',
      expires_at: null,
    })

    const res = await request(makeApp()).get('/api/gift-cards-public/test-biz/balance/giftpub1')

    expect(res.status).toBe(200)
    expect(res.body.balance_cents).toBe(2500)
    expect(res.body.status).toBe('active')
  })

  it('404s for a code belonging to a different tenant', async () => {
    ;(store.tables['gift_cards'] as Row[]).push({
      id: randomUUID(),
      tenant_id: 'other-tenant',
      code: 'GIFTOTHER',
      balance_cents: 2500,
      status: 'active',
    })

    const res = await request(makeApp()).get('/api/gift-cards-public/test-biz/balance/GIFTOTHER')
    expect(res.status).toBe(404)
  })

  it('404s for an unknown code', async () => {
    const res = await request(makeApp()).get('/api/gift-cards-public/test-biz/balance/NOPE0000')
    expect(res.status).toBe(404)
  })
})
