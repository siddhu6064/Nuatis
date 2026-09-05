import { jest, describe, it, expect, beforeEach } from '@jest/globals'
import {
  createStore,
  createMockSupabase,
  type MockStore,
  type Row,
} from '../routes/__test-support__/supabase-mock.js'

let store: MockStore = createStore()
const sendEmail = jest.fn(async () => true)
const logActivity = jest.fn(async () => undefined)

jest.unstable_mockModule('@supabase/supabase-js', () => ({
  createClient: () => createMockSupabase(store),
}))
jest.unstable_mockModule('../lib/email-client.js', () => ({ sendEmail }))
jest.unstable_mockModule('../lib/activity.js', () => ({ logActivity }))

process.env['SUPABASE_URL'] = 'https://mock.supabase.co'
process.env['SUPABASE_SERVICE_ROLE_KEY'] = 'mock-service-key'

const TENANT_ID = 'aaaaaaaa-0000-0000-0000-00000ri00001'
const CONTACT_ID = 'bbbbbbbb-0000-0000-0000-00000ri00002'

const { scanRecurringInvoices } = await import('./recurring-invoice-scanner.js')

function seedRule(overrides: Row = {}): void {
  store.tables['recurring_invoices'] = [
    {
      id: 'rule-1',
      tenant_id: TENANT_ID,
      contact_id: CONTACT_ID,
      deal_id: null,
      description: 'Monthly retainer',
      amount: 500,
      tax_rate: 0,
      due_days: 14,
      frequency: 'monthly',
      day_of_week: null,
      day_of_month: new Date().getDate(),
      month_of_year: null,
      enabled: true,
      last_generated_at: null,
      deleted_at: null,
      ...overrides,
    },
  ]
}

beforeEach(() => {
  store = createStore()
  store.tables['tenants'] = [{ id: TENANT_ID, invoice_counter: 1000, name: 'Retainer Co' }]
  store.tables['contacts'] = [
    { id: CONTACT_ID, tenant_id: TENANT_ID, full_name: 'Jane Client', email: 'jane@example.com' },
  ]
  store.tables['invoices'] = []
  store.tables['invoice_line_items'] = []
  seedRule()
  sendEmail.mockClear()
  logActivity.mockClear()
})

describe('scanRecurringInvoices', () => {
  it('generates an invoice + line item on a due monthly rule, and marks last_generated_at', async () => {
    await scanRecurringInvoices()

    const invoices = store.tables['invoices'] as Row[]
    expect(invoices).toHaveLength(1)
    expect(invoices[0]?.['contact_id']).toBe(CONTACT_ID)
    expect(invoices[0]?.['status']).toBe('sent')
    expect(invoices[0]?.['total']).toBe(500)
    expect(invoices[0]?.['recurring_invoice_id']).toBe('rule-1')

    const items = store.tables['invoice_line_items'] as Row[]
    expect(items).toHaveLength(1)
    expect(items[0]?.['unit_price']).toBe(500)

    const rules = store.tables['recurring_invoices'] as Row[]
    expect(rules[0]?.['last_generated_at']).toBeTruthy()

    expect(sendEmail).toHaveBeenCalledTimes(1)
    expect(sendEmail.mock.calls[0]?.[0]).toMatchObject({ to: 'jane@example.com' })
  })

  it('applies tax_rate to compute total', async () => {
    seedRule({ tax_rate: 10 })
    await scanRecurringInvoices()

    const invoices = store.tables['invoices'] as Row[]
    expect(invoices[0]?.['tax_amount']).toBe(50)
    expect(invoices[0]?.['total']).toBe(550)
  })

  it('skips a rule not due today (wrong day_of_month)', async () => {
    const wrongDay = new Date().getDate() === 1 ? 2 : 1
    seedRule({ day_of_month: wrongDay })
    await scanRecurringInvoices()

    expect((store.tables['invoices'] as Row[]).length).toBe(0)
  })

  it('skips a rule already generated recently (within the monthly cooldown)', async () => {
    seedRule({ last_generated_at: new Date().toISOString() })
    await scanRecurringInvoices()

    expect((store.tables['invoices'] as Row[]).length).toBe(0)
  })

  it('skips a disabled rule', async () => {
    seedRule({ enabled: false })
    await scanRecurringInvoices()

    expect((store.tables['invoices'] as Row[]).length).toBe(0)
  })

  it('does not send email when the contact has no email on file', async () => {
    store.tables['contacts'] = [{ id: CONTACT_ID, tenant_id: TENANT_ID, full_name: 'No Email Ned' }]
    await scanRecurringInvoices()

    expect((store.tables['invoices'] as Row[]).length).toBe(1)
    expect(sendEmail).not.toHaveBeenCalled()
  })
})
