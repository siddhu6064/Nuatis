import { jest, describe, it, expect, beforeEach } from '@jest/globals'
import { mintTestToken } from './__test-support__/jwt.js'
import {
  createStore,
  createMockSupabase,
  type MockStore,
  type Row,
} from './__test-support__/supabase-mock.js'
import { entitledTenantRow } from './__test-support__/tenant-fixture.js'

let store: MockStore = createStore()

const mockPricesCreate = jest.fn(async () => ({ id: 'price_gc_1' }))
const mockPaymentLinksCreate = jest.fn(async () => ({
  id: 'plink_gc_1',
  url: 'https://checkout.stripe.com/pay/plink_gc_1',
}))
let webhookEvent: unknown = null
const mockConstructEvent = jest.fn(() => webhookEvent)

jest.unstable_mockModule('@supabase/supabase-js', () => ({
  createClient: () => createMockSupabase(store),
}))
jest.unstable_mockModule('stripe', () => ({
  default: jest.fn().mockImplementation(() => ({
    prices: { create: mockPricesCreate },
    paymentLinks: { create: mockPaymentLinksCreate },
    webhooks: { constructEvent: mockConstructEvent },
  })),
}))

const TENANT_ID = 'aaaaaaaa-0000-0000-0000-00000gc00001'
const SECRET = process.env['AUTH_SECRET'] ?? 'test-secret-for-unit-tests-only-32ch'
process.env['AUTH_SECRET'] = SECRET
process.env['SUPABASE_URL'] = 'https://mock.supabase.co'
process.env['SUPABASE_SERVICE_ROLE_KEY'] = 'mock-service-key'
process.env['STRIPE_SECRET_KEY'] = 'sk_test_mock'
process.env['STRIPE_WEBHOOK_SECRET'] = 'whsec_mock'

async function makeToken(): Promise<string> {
  return mintTestToken({ sub: 'user-1', tenantId: TENANT_ID, role: 'owner' }, { secret: SECRET })
}

const { default: express } = await import('express')
const { default: request } = await import('supertest')
const { default: giftCardsRouter } = await import('./gift-cards.js')
const { default: stripeWebhooksRouter } = await import('./stripe-webhooks.js')

function makeApp() {
  const app = express()
  app.use('/api/gift-cards', express.json(), giftCardsRouter)
  app.use('/api/webhooks/stripe', express.raw({ type: '*/*' }), stripeWebhooksRouter)
  return app
}

beforeEach(() => {
  store = createStore()
  store.tables['tenants'] = [entitledTenantRow(TENANT_ID)]
  store.tables['gift_cards'] = []
  mockPricesCreate.mockClear()
  mockPaymentLinksCreate.mockClear()
  mockConstructEvent.mockClear()
  webhookEvent = null
})

describe('POST /api/gift-cards — requires payment_method', () => {
  it('returns 400 without a payment_method', async () => {
    const token = await makeToken()
    const res = await request(makeApp())
      .post('/api/gift-cards')
      .set('Authorization', `Bearer ${token}`)
      .send({ amount_cents: 5000 })

    expect(res.status).toBe(400)
    expect(mockPaymentLinksCreate).not.toHaveBeenCalled()
  })

  it('issues an active card immediately for an offline payment_method (cash)', async () => {
    const token = await makeToken()
    const res = await request(makeApp())
      .post('/api/gift-cards')
      .set('Authorization', `Bearer ${token}`)
      .send({ amount_cents: 5000, payment_method: 'cash' })

    expect(res.status).toBe(201)
    expect(res.body.status).toBe('active')
    expect(res.body.balance_cents).toBe(5000)
    expect(res.body.payment_url).toBeNull()
    expect(mockPaymentLinksCreate).not.toHaveBeenCalled()
  })

  it('issues a pending_payment card with a Stripe Payment Link for payment_method "stripe"', async () => {
    const token = await makeToken()
    const res = await request(makeApp())
      .post('/api/gift-cards')
      .set('Authorization', `Bearer ${token}`)
      .send({ amount_cents: 5000, payment_method: 'stripe' })

    expect(res.status).toBe(201)
    expect(res.body.status).toBe('pending_payment')
    expect(res.body.payment_url).toBe('https://checkout.stripe.com/pay/plink_gc_1')
    expect(mockPricesCreate).toHaveBeenCalledWith(
      expect.objectContaining({ unit_amount: 5000 }),
      undefined
    )
    const linkArgs = mockPaymentLinksCreate.mock.calls[0]![0] as {
      metadata: Record<string, string>
    }
    expect(linkArgs.metadata['kind']).toBe('gift_card_purchase')
    expect(linkArgs.metadata['giftCardId']).toBe(res.body.id)
  })

  it('a pending_payment card cannot be redeemed', async () => {
    // Seeded directly rather than via POST / — the mock store doesn't
    // evaluate gift_cards.code's DB-side DEFAULT expression, so a
    // create-then-redeem round trip can't resolve a code to look up.
    store.tables['gift_cards'] = [
      {
        id: 'gc-pending',
        tenant_id: TENANT_ID,
        code: 'GIFTPENDING',
        amount_cents: 5000,
        balance_cents: 5000,
        status: 'pending_payment',
      },
    ]
    const token = await makeToken()

    const redeemRes = await request(makeApp())
      .post('/api/gift-cards/redeem')
      .set('Authorization', `Bearer ${token}`)
      .send({ code: 'GIFTPENDING', amount_cents: 1000 })

    expect(redeemRes.status).toBe(400)
    expect(redeemRes.body.error).toMatch(/pending_payment/)
  })
})

describe('POST /api/webhooks/stripe — checkout.session.completed (gift_card_purchase)', () => {
  it('activates a pending_payment gift card on payment', async () => {
    store.tables['gift_cards'] = [
      {
        id: 'gc-1',
        tenant_id: TENANT_ID,
        code: 'GIFTX',
        amount_cents: 5000,
        balance_cents: 5000,
        status: 'pending_payment',
      },
    ]
    webhookEvent = {
      type: 'checkout.session.completed',
      data: {
        object: {
          payment_status: 'paid',
          amount_total: 5000,
          metadata: { kind: 'gift_card_purchase', tenantId: TENANT_ID, giftCardId: 'gc-1' },
        },
      },
    }

    const res = await request(makeApp())
      .post('/api/webhooks/stripe')
      .set('stripe-signature', 'sig_test')
      .send(Buffer.from('{}'))

    expect(res.status).toBe(200)
    const card = (store.tables['gift_cards'] as Row[]).find((c) => c['id'] === 'gc-1')
    expect(card?.['status']).toBe('active')
  })

  it('does not reactivate an already-redeemed card on a replayed event', async () => {
    store.tables['gift_cards'] = [
      {
        id: 'gc-1',
        tenant_id: TENANT_ID,
        code: 'GIFTX',
        amount_cents: 5000,
        balance_cents: 0,
        status: 'redeemed',
      },
    ]
    webhookEvent = {
      type: 'checkout.session.completed',
      data: {
        object: {
          payment_status: 'paid',
          amount_total: 5000,
          metadata: { kind: 'gift_card_purchase', tenantId: TENANT_ID, giftCardId: 'gc-1' },
        },
      },
    }

    const res = await request(makeApp())
      .post('/api/webhooks/stripe')
      .set('stripe-signature', 'sig_test')
      .send(Buffer.from('{}'))

    expect(res.status).toBe(200)
    const card = (store.tables['gift_cards'] as Row[]).find((c) => c['id'] === 'gc-1')
    // The webhook's .eq('status', 'pending_payment') guard means a card that's
    // moved on (e.g. already redeemed) is untouched by a stale/replayed event.
    expect(card?.['status']).toBe('redeemed')
  })
})
