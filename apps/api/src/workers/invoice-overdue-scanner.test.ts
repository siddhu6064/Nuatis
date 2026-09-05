import { jest, describe, it, expect, beforeEach } from '@jest/globals'
import { randomUUID } from 'node:crypto'
import {
  createStore,
  createMockSupabase,
  type MockStore,
  type Row,
} from '../routes/__test-support__/supabase-mock.js'

let store: MockStore = createStore()
const notifyOwner = jest.fn(async () => undefined)

jest.unstable_mockModule('@supabase/supabase-js', () => ({
  createClient: () => createMockSupabase(store),
}))
jest.unstable_mockModule('../lib/notifications.js', () => ({ notifyOwner }))
jest.unstable_mockModule('../lib/scanner-pause.js', () => ({
  getPausedTenants: async () => new Set<string>(),
}))

process.env['SUPABASE_URL'] = 'https://mock.supabase.co'
process.env['SUPABASE_SERVICE_ROLE_KEY'] = 'mock-service-key'

const TENANT_ID = 'aaaaaaaa-0000-0000-0000-000000io0001'
const { scan } = await import('./invoice-overdue-scanner.js')

beforeEach(() => {
  store = createStore()
  store.tables['invoices'] = []
  notifyOwner.mockClear()
})

describe('invoice-overdue-scanner', () => {
  it('marks past-due invoices overdue and notifies the owner with count + total', async () => {
    store.tables['invoices']!.push(
      {
        id: randomUUID(),
        tenant_id: TENANT_ID,
        invoice_number: 'INV-0001',
        status: 'sent',
        due_date: '2020-01-01',
        total: 150,
      },
      {
        id: randomUUID(),
        tenant_id: TENANT_ID,
        invoice_number: 'INV-0002',
        status: 'due',
        due_date: '2020-01-02',
        total: 50,
      }
    )

    await scan()

    const rows = store.tables['invoices'] as Row[]
    expect(rows.every((r) => r['status'] === 'overdue')).toBe(true)

    expect(notifyOwner).toHaveBeenCalledTimes(1)
    const [tenantId, eventKey, payload] = notifyOwner.mock.calls[0]!
    expect(tenantId).toBe(TENANT_ID)
    expect(eventKey).toBe('invoice_overdue')
    expect((payload as { pushBody: string }).pushBody).toContain('2 invoices')
    expect((payload as { pushBody: string }).pushBody).toContain('200.00')
  })

  it('does not touch or notify for an invoice not yet due', async () => {
    store.tables['invoices']!.push({
      id: randomUUID(),
      tenant_id: TENANT_ID,
      invoice_number: 'INV-0003',
      status: 'sent',
      due_date: '2099-01-01',
      total: 100,
    })

    await scan()

    expect(notifyOwner).not.toHaveBeenCalled()
    const row = (store.tables['invoices'] as Row[])[0]!
    expect(row['status']).toBe('sent')
  })

  it('ignores an already-paid invoice past its due date', async () => {
    store.tables['invoices']!.push({
      id: randomUUID(),
      tenant_id: TENANT_ID,
      invoice_number: 'INV-0004',
      status: 'paid',
      due_date: '2020-01-01',
      total: 100,
    })

    await scan()

    expect(notifyOwner).not.toHaveBeenCalled()
  })
})
