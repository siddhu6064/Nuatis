import { jest, describe, it, expect, beforeEach } from '@jest/globals'
import {
  createStore,
  createMockSupabase,
  type MockStore,
} from '../routes/__test-support__/supabase-mock.js'

// ── Env ───────────────────────────────────────────────────────────────────────
process.env['SUPABASE_URL'] = 'https://mock.supabase.co'
process.env['SUPABASE_SERVICE_ROLE_KEY'] = 'mock-service-key'

// ── Mocks ─────────────────────────────────────────────────────────────────────
let store: MockStore = createStore()

jest.unstable_mockModule('@supabase/supabase-js', () => ({
  createClient: () => createMockSupabase(store),
}))

// ── Dynamic imports ───────────────────────────────────────────────────────────
const { generateInvoiceNumber } = await import('../lib/invoice-number.js')
const { calcInvoiceTotals, processVoidInvoice } = await import('../routes/invoices.js')
const { applyInvoicePayment } = await import('../lib/invoice-payment.js')
const { getServiceClient } = await import('../lib/supabase.js')

// ── Tests ─────────────────────────────────────────────────────────────────────
describe('invoices', () => {
  beforeEach(() => {
    store = createStore()
  })

  // ── Test 1: generateInvoiceNumber increments counter and returns 'INV-{n}' ──

  it('generateInvoiceNumber increments counter and returns INV-{n}', async () => {
    store.tables['tenants'] = [{ id: 'tenant-1', invoice_counter: 1005 }]

    const result = await generateInvoiceNumber('tenant-1')

    expect(result).toBe('INV-1006')
    expect(store.tables['tenants']?.[0]?.['invoice_counter']).toBe(1006)
  })

  // ── Test 2: calcInvoiceTotals computes subtotal, taxAmount, total correctly ──

  it('calcInvoiceTotals calculates subtotal + tax + total correctly', () => {
    const result = calcInvoiceTotals(
      [
        { description: 'Service A', quantity: 2, unit_price: 100 },
        { description: 'Service B', quantity: 1, unit_price: 50 },
      ],
      10 // 10% tax
    )

    // subtotal = 250, taxAmount = 25, total = 275
    expect(result.subtotal).toBe(250)
    expect(result.taxAmount).toBe(25)
    expect(result.total).toBe(275)
  })

  // ── Test 3: record-payment sets status='received' when fully paid ────────────
  // Exercises applyInvoicePayment directly — the same function both the
  // authenticated record-payment route and the Stripe webhook call, so this
  // test covers the real shared code path, not a parallel copy of it.

  it('applyInvoicePayment sets status=received when fully paid', async () => {
    store.tables['invoices'] = [
      {
        id: 'inv-1',
        tenant_id: 'tenant-1',
        amount_paid: 90,
        total: 100,
        status: 'sent',
        balance_due: 10,
      },
    ]

    const result = await applyInvoicePayment(getServiceClient(), 'inv-1', 'tenant-1', 10)

    expect(result.kind).toBe('ok')
    const row = store.tables['invoices']?.[0]
    expect(row?.['status']).toBe('received')
    expect(row?.['amount_paid']).toBe(100)
  })

  it('applyInvoicePayment is a no-op guard (invalid_status) for an already-received invoice', async () => {
    store.tables['invoices'] = [
      { id: 'inv-1', tenant_id: 'tenant-1', amount_paid: 100, total: 100, status: 'received' },
    ]

    const result = await applyInvoicePayment(getServiceClient(), 'inv-1', 'tenant-1', 10)

    expect(result.kind).toBe('invalid_status')
    // Confirms a Stripe webhook replay can't double-credit the invoice.
    expect(store.tables['invoices']?.[0]?.['amount_paid']).toBe(100)
  })

  // ── Test 4: void returns 400 when status='received' ──────────────────────────

  it('processVoidInvoice returns 400 when invoice is already received', async () => {
    store.tables['invoices'] = [{ id: 'inv-1', tenant_id: 'tenant-1', status: 'received' }]

    const result = await processVoidInvoice('inv-1', 'tenant-1')

    expect(result.status).toBe(400)
    expect(result.error).toMatch(/cannot void/i)
  })

  // ── Test 5: generateInvoiceNumber throws when tenant not found ───────────────

  it('generateInvoiceNumber throws when tenant not found', async () => {
    store.tables['tenants'] = []

    await expect(generateInvoiceNumber('tenant-missing')).rejects.toThrow()
  })
})
