import { jest, describe, it, expect, beforeEach } from '@jest/globals'
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

process.env['SUPABASE_URL'] = 'https://mock.supabase.co'
process.env['SUPABASE_SERVICE_ROLE_KEY'] = 'mock-service-key'
process.env['STRIPE_SECRET_KEY'] = 'sk_test_mock'
process.env['STRIPE_WEBHOOK_SECRET'] = 'whsec_mock'

const applyInvoicePayment = jest.fn(async () => ({ kind: 'ok' }) as { kind: string })
jest.unstable_mockModule('../lib/invoice-payment.js', () => ({ applyInvoicePayment }))

const notifyOwner = jest.fn(async () => undefined)
jest.unstable_mockModule('../lib/notifications.js', () => ({ notifyOwner }))

let mockEvent: { type: string; data: { object: Record<string, unknown> } }
const mockConstructEvent = jest.fn(() => mockEvent)
jest.unstable_mockModule('stripe', () => ({
  default: jest.fn().mockImplementation(() => ({
    webhooks: { constructEvent: mockConstructEvent },
  })),
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

async function fireEvent(event: typeof mockEvent) {
  mockEvent = event
  return request(makeApp())
    .post('/api/webhooks/stripe')
    .set('stripe-signature', 'sig')
    .set('Content-Type', 'application/json')
    .send(JSON.stringify(event))
}

beforeEach(() => {
  store = createStore()
  store.tables['gift_cards'] = [{ id: 'gc-1', tenant_id: 'tenant-1', status: 'pending_payment' }]
  applyInvoicePayment.mockClear()
  applyInvoicePayment.mockResolvedValue({ kind: 'ok' })
  notifyOwner.mockClear()
  mockConstructEvent.mockClear()
})

describe('checkout.session.completed', () => {
  it('activates a gift card when payment_status is paid', async () => {
    const res = await fireEvent({
      type: 'checkout.session.completed',
      data: {
        object: {
          payment_status: 'paid',
          amount_total: 5000,
          metadata: { kind: 'gift_card_purchase', giftCardId: 'gc-1', tenantId: 'tenant-1' },
        },
      },
    })
    expect(res.status).toBe(200)
    const card = (store.tables['gift_cards'] as Row[])[0]
    expect(card?.['status']).toBe('active')
  })

  it('does NOT activate a gift card when payment_status is unpaid (ACH still processing)', async () => {
    const res = await fireEvent({
      type: 'checkout.session.completed',
      data: {
        object: {
          payment_status: 'unpaid',
          amount_total: 5000,
          metadata: { kind: 'gift_card_purchase', giftCardId: 'gc-1', tenantId: 'tenant-1' },
        },
      },
    })
    expect(res.status).toBe(200)
    const card = (store.tables['gift_cards'] as Row[])[0]
    expect(card?.['status']).toBe('pending_payment')
  })

  it('applies an invoice payment when payment_status is paid', async () => {
    const res = await fireEvent({
      type: 'checkout.session.completed',
      data: {
        object: {
          payment_status: 'paid',
          amount_total: 10000,
          metadata: { kind: 'invoice_payment', invoiceId: 'inv-1', tenantId: 'tenant-1' },
        },
      },
    })
    expect(res.status).toBe(200)
    expect(applyInvoicePayment).toHaveBeenCalledWith(expect.anything(), 'inv-1', 'tenant-1', 100)
  })

  it('does NOT apply an invoice payment when payment_status is unpaid', async () => {
    const res = await fireEvent({
      type: 'checkout.session.completed',
      data: {
        object: {
          payment_status: 'unpaid',
          amount_total: 10000,
          metadata: { kind: 'invoice_payment', invoiceId: 'inv-1', tenantId: 'tenant-1' },
        },
      },
    })
    expect(res.status).toBe(200)
    expect(applyInvoicePayment).not.toHaveBeenCalled()
  })
})

describe('checkout.session.async_payment_succeeded', () => {
  it('activates a gift card once the ACH debit clears', async () => {
    const res = await fireEvent({
      type: 'checkout.session.async_payment_succeeded',
      data: {
        object: {
          amount_total: 5000,
          metadata: { kind: 'gift_card_purchase', giftCardId: 'gc-1', tenantId: 'tenant-1' },
        },
      },
    })
    expect(res.status).toBe(200)
    const card = (store.tables['gift_cards'] as Row[])[0]
    expect(card?.['status']).toBe('active')
  })

  it('applies an invoice payment once the ACH debit clears', async () => {
    const res = await fireEvent({
      type: 'checkout.session.async_payment_succeeded',
      data: {
        object: {
          amount_total: 10000,
          metadata: { kind: 'invoice_payment', invoiceId: 'inv-1', tenantId: 'tenant-1' },
        },
      },
    })
    expect(res.status).toBe(200)
    expect(applyInvoicePayment).toHaveBeenCalledWith(expect.anything(), 'inv-1', 'tenant-1', 100)
  })
})

describe('checkout.session.async_payment_failed', () => {
  it('reverts a gift card out of pending_payment and notifies the owner', async () => {
    const res = await fireEvent({
      type: 'checkout.session.async_payment_failed',
      data: {
        object: {
          metadata: { kind: 'gift_card_purchase', giftCardId: 'gc-1', tenantId: 'tenant-1' },
        },
      },
    })
    expect(res.status).toBe(200)
    const card = (store.tables['gift_cards'] as Row[])[0]
    expect(card?.['status']).toBe('cancelled')
    expect(notifyOwner).toHaveBeenCalledWith(
      'tenant-1',
      'payment_failed',
      expect.objectContaining({ pushTitle: expect.any(String) })
    )
  })

  it('does not revert an already-active gift card (replay guard)', async () => {
    store.tables['gift_cards'] = [{ id: 'gc-1', tenant_id: 'tenant-1', status: 'active' }]
    const res = await fireEvent({
      type: 'checkout.session.async_payment_failed',
      data: {
        object: {
          metadata: { kind: 'gift_card_purchase', giftCardId: 'gc-1', tenantId: 'tenant-1' },
        },
      },
    })
    expect(res.status).toBe(200)
    const card = (store.tables['gift_cards'] as Row[])[0]
    expect(card?.['status']).toBe('active')
    expect(notifyOwner).not.toHaveBeenCalled()
  })

  it('notifies the owner for a failed invoice payment without mutating the invoice', async () => {
    const res = await fireEvent({
      type: 'checkout.session.async_payment_failed',
      data: {
        object: {
          metadata: { kind: 'invoice_payment', invoiceId: 'inv-1', tenantId: 'tenant-1' },
        },
      },
    })
    expect(res.status).toBe(200)
    expect(applyInvoicePayment).not.toHaveBeenCalled()
    expect(notifyOwner).toHaveBeenCalledWith(
      'tenant-1',
      'payment_failed',
      expect.objectContaining({ pushUrl: '/invoices/inv-1' })
    )
  })
})
