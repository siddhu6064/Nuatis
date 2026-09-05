import { jest, describe, it, expect, beforeEach } from '@jest/globals'
import {
  createStore,
  createMockSupabase,
  type MockStore,
  type Row,
} from '../routes/__test-support__/supabase-mock.js'

process.env['SUPABASE_URL'] = 'https://mock.supabase.co'
process.env['SUPABASE_SERVICE_ROLE_KEY'] = 'mock-service-key'
process.env['STRIPE_SECRET_KEY'] = 'sk_test_mock'

let store: MockStore = createStore()

jest.unstable_mockModule('@supabase/supabase-js', () => ({
  createClient: () => createMockSupabase(store),
}))

const mockPricesCreate = jest.fn(async () => ({ id: 'price_1' }))
const mockLinksCreate = jest.fn(async () => ({ id: 'plink_1', url: 'https://buy.stripe.com/xyz' }))

jest.unstable_mockModule('stripe', () => ({
  default: jest.fn().mockImplementation(() => ({
    prices: { create: mockPricesCreate },
    paymentLinks: { create: mockLinksCreate },
  })),
}))

const mockCreateSquareCheckoutLink = jest.fn(async () => ({
  id: 'sqlink_1',
  url: 'https://square.link/xyz',
}))
jest.unstable_mockModule('./square-client.js', () => ({
  createSquareCheckoutLink: mockCreateSquareCheckoutLink,
}))

const { createPaymentLink } = await import('./payment-link.js')

const TENANT_ID = 'aaaaaaaa-0000-0000-0000-00000pl00001'

beforeEach(() => {
  store = createStore()
  store.tables['payment_links'] = []
  mockPricesCreate.mockClear()
  mockLinksCreate.mockClear()
  mockCreateSquareCheckoutLink.mockClear()
})

describe('createPaymentLink', () => {
  it('creates a Stripe price + payment link and persists a payment_links row', async () => {
    const result = await createPaymentLink({
      tenantId: TENANT_ID,
      amount: 25.5,
      description: 'Order ORD-1001',
      contactId: 'contact-1',
    })

    expect(result.url).toBe('https://buy.stripe.com/xyz')
    expect(result.amount).toBe(25.5)
    expect(mockPricesCreate).toHaveBeenCalledWith(
      expect.objectContaining({ unit_amount: 2550, currency: 'usd' }),
      undefined
    )

    const rows = store.tables['payment_links'] as Row[]
    expect(rows).toHaveLength(1)
    expect(rows[0]?.['tenant_id']).toBe(TENANT_ID)
    expect(rows[0]?.['contact_id']).toBe('contact-1')
  })

  it('defaults currency to usd, and passes through an explicit override', async () => {
    await createPaymentLink({
      tenantId: TENANT_ID,
      amount: 10,
      description: 'Test',
      currency: 'EUR',
    })
    expect(mockPricesCreate).toHaveBeenCalledWith(
      expect.objectContaining({ currency: 'EUR' }),
      undefined
    )
  })

  it('adds tipAmount on top of amount for the charged total, and records it separately', async () => {
    const result = await createPaymentLink({
      tenantId: TENANT_ID,
      amount: 20,
      tipAmount: 5,
      description: 'Test',
    })
    expect(result.amount).toBe(25)
    expect(mockPricesCreate).toHaveBeenCalledWith(
      expect.objectContaining({ unit_amount: 2500 }),
      undefined
    )

    const rows = store.tables['payment_links'] as Row[]
    expect(rows[0]?.['tip_amount']).toBe(5)
  })

  it('falls back to Square when STRIPE_SECRET_KEY is not configured', async () => {
    const prev = process.env['STRIPE_SECRET_KEY']
    delete process.env['STRIPE_SECRET_KEY']

    const result = await createPaymentLink({ tenantId: TENANT_ID, amount: 10, description: 'Test' })

    expect(result.url).toBe('https://square.link/xyz')
    expect(result.processor).toBe('square')
    expect(mockCreateSquareCheckoutLink).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: TENANT_ID, amountCents: 1000, currency: 'USD' })
    )

    const rows = store.tables['payment_links'] as Row[]
    expect(rows[0]?.['processor']).toBe('square')
    expect(rows[0]?.['stripe_link_id']).toBeNull()
    expect(rows[0]?.['square_payment_link_id']).toBe('sqlink_1')

    process.env['STRIPE_SECRET_KEY'] = prev
  })

  it('throws when neither Stripe nor Square is configured', async () => {
    const prev = process.env['STRIPE_SECRET_KEY']
    delete process.env['STRIPE_SECRET_KEY']
    mockCreateSquareCheckoutLink.mockRejectedValueOnce(
      new Error(`No Square connection found for tenant ${TENANT_ID}`)
    )

    await expect(
      createPaymentLink({ tenantId: TENANT_ID, amount: 10, description: 'Test' })
    ).rejects.toThrow('No Square connection found')

    process.env['STRIPE_SECRET_KEY'] = prev
  })
})
