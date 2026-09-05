import { jest, describe, it, expect, beforeEach } from '@jest/globals'
import {
  createStore,
  createMockSupabase,
  type MockStore,
  type Row,
} from './__test-support__/supabase-mock.js'

let store: MockStore = createStore()

const mockPricesCreate = jest.fn(async () => ({ id: 'price_test_1' }))
const mockPaymentLinksCreate = jest.fn(async () => ({
  id: 'plink_test_1',
  url: 'https://checkout.stripe.com/pay/plink_test_1',
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

process.env['SUPABASE_URL'] = 'https://mock.supabase.co'
process.env['SUPABASE_SERVICE_ROLE_KEY'] = 'mock-service-key'
process.env['STRIPE_SECRET_KEY'] = 'sk_test_mock'
process.env['STRIPE_WEBHOOK_SECRET'] = 'whsec_mock'

const { default: express } = await import('express')
const { default: request } = await import('supertest')
const { publicRouter: invoicesPublicRouter } = await import('./invoices.js')
const { default: stripeWebhooksRouter } = await import('./stripe-webhooks.js')

const TENANT_ID = 'aaaaaaaa-0000-0000-0000-00000inv0001'

function makeApp() {
  const app = express()
  app.use('/api/invoices/public', express.json(), invoicesPublicRouter)
  // Webhook route needs the raw body — mirrors how index.ts mounts it ahead of
  // the JSON body parser in the real app; the mocked constructEvent doesn't
  // care about raw-vs-parsed here, but express.raw() matches production shape.
  app.use('/api/webhooks/stripe', express.raw({ type: '*/*' }), stripeWebhooksRouter)
  return app
}

beforeEach(() => {
  store = createStore()
  store.tables['invoices'] = []
  mockPricesCreate.mockClear()
  mockPaymentLinksCreate.mockClear()
  mockConstructEvent.mockClear()
  webhookEvent = null
})

describe('POST /api/invoices/public/:token/pay', () => {
  it('creates a Stripe Payment Link scoped to the current balance_due', async () => {
    store.tables['invoices'] = [
      {
        id: 'inv-1',
        tenant_id: TENANT_ID,
        invoice_number: 'INV-1001',
        share_token: 'tok-1',
        status: 'sent',
        total: 250,
        amount_paid: 50,
      },
    ]

    const res = await request(makeApp()).post('/api/invoices/public/tok-1/pay')

    expect(res.status).toBe(200)
    expect(res.body.url).toBe('https://checkout.stripe.com/pay/plink_test_1')
    expect(mockPricesCreate).toHaveBeenCalledWith(
      expect.objectContaining({ unit_amount: 20000 }), // (250 - 50) * 100
      undefined
    )
    const linkArgs = mockPaymentLinksCreate.mock.calls[0]![0] as {
      metadata: Record<string, string>
    }
    expect(linkArgs.metadata).toEqual({
      kind: 'invoice_payment',
      tenantId: TENANT_ID,
      invoiceId: 'inv-1',
    })
  })

  it('returns 400 when the invoice has no balance due', async () => {
    store.tables['invoices'] = [
      {
        id: 'inv-1',
        tenant_id: TENANT_ID,
        invoice_number: 'INV-1002',
        share_token: 'tok-2',
        status: 'sent',
        total: 100,
        amount_paid: 100,
      },
    ]

    const res = await request(makeApp()).post('/api/invoices/public/tok-2/pay')
    expect(res.status).toBe(400)
    expect(mockPaymentLinksCreate).not.toHaveBeenCalled()
  })

  it('returns 400 for a void invoice', async () => {
    store.tables['invoices'] = [
      {
        id: 'inv-1',
        tenant_id: TENANT_ID,
        invoice_number: 'INV-1003',
        share_token: 'tok-3',
        status: 'void',
        total: 100,
        amount_paid: 0,
      },
    ]

    const res = await request(makeApp()).post('/api/invoices/public/tok-3/pay')
    expect(res.status).toBe(400)
  })

  it('returns 404 for an unknown token', async () => {
    const res = await request(makeApp()).post('/api/invoices/public/does-not-exist/pay')
    expect(res.status).toBe(404)
  })
})

describe('POST /api/webhooks/stripe — checkout.session.completed', () => {
  it('applies the payment to the invoice and marks it received when fully paid', async () => {
    store.tables['invoices'] = [
      {
        id: 'inv-1',
        tenant_id: TENANT_ID,
        invoice_number: 'INV-1001',
        status: 'sent',
        total: 200,
        amount_paid: 0,
      },
    ]
    webhookEvent = {
      type: 'checkout.session.completed',
      data: {
        object: {
          payment_status: 'paid',
          amount_total: 20000,
          metadata: { kind: 'invoice_payment', tenantId: TENANT_ID, invoiceId: 'inv-1' },
        },
      },
    }

    const res = await request(makeApp())
      .post('/api/webhooks/stripe')
      .set('stripe-signature', 'sig_test')
      .send(Buffer.from('{}'))

    expect(res.status).toBe(200)
    const invoice = (store.tables['invoices'] as Row[]).find((i) => i['id'] === 'inv-1')
    expect(invoice?.['status']).toBe('received')
    expect(invoice?.['amount_paid']).toBe(200)
  })

  it('does not double-credit a replayed event for an already-received invoice', async () => {
    store.tables['invoices'] = [
      {
        id: 'inv-1',
        tenant_id: TENANT_ID,
        invoice_number: 'INV-1001',
        status: 'received',
        total: 200,
        amount_paid: 200,
      },
    ]
    webhookEvent = {
      type: 'checkout.session.completed',
      data: {
        object: {
          payment_status: 'paid',
          amount_total: 20000,
          metadata: { kind: 'invoice_payment', tenantId: TENANT_ID, invoiceId: 'inv-1' },
        },
      },
    }

    const res = await request(makeApp())
      .post('/api/webhooks/stripe')
      .set('stripe-signature', 'sig_test')
      .send(Buffer.from('{}'))

    expect(res.status).toBe(200)
    const invoice = (store.tables['invoices'] as Row[]).find((i) => i['id'] === 'inv-1')
    expect(invoice?.['amount_paid']).toBe(200)
  })

  it('ignores checkout sessions with no invoice_payment metadata (e.g. other Payment Links)', async () => {
    store.tables['invoices'] = [
      {
        id: 'inv-1',
        tenant_id: TENANT_ID,
        invoice_number: 'INV-1001',
        status: 'sent',
        total: 200,
        amount_paid: 0,
      },
    ]
    webhookEvent = {
      type: 'checkout.session.completed',
      data: { object: { payment_status: 'paid', amount_total: 5000, metadata: {} } },
    }

    const res = await request(makeApp())
      .post('/api/webhooks/stripe')
      .set('stripe-signature', 'sig_test')
      .send(Buffer.from('{}'))

    expect(res.status).toBe(200)
    const invoice = (store.tables['invoices'] as Row[]).find((i) => i['id'] === 'inv-1')
    expect(invoice?.['amount_paid']).toBe(0)
  })
})
