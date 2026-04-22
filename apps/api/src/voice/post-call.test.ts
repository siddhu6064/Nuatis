import { jest, describe, it, expect, beforeEach } from '@jest/globals'
import { randomUUID } from 'node:crypto'
import {
  createStore,
  createMockSupabase,
  type MockStore,
  type Row,
} from '../routes/__test-support__/supabase-mock.js'

let store: MockStore = createStore()

jest.unstable_mockModule('@supabase/supabase-js', () => ({
  createClient: () => createMockSupabase(store),
}))

const TENANT_ID = 'aaaaaaaa-0000-0000-0000-0000000pc001'
const CONTACT_ID = 'cccccccc-0000-0000-0000-0000000pc001'

process.env['SUPABASE_URL'] = 'https://mock.supabase.co'
process.env['SUPABASE_SERVICE_ROLE_KEY'] = 'mock-service-key'

const { generateAutoQuote } = await import('./post-call.js')

beforeEach(() => {
  store = createStore()
  store.tables['tenants'] = [{ id: TENANT_ID, name: 'Clinic' }]
  store.tables['services'] = []
  store.tables['quotes'] = []
  store.tables['quote_line_items'] = []
})

describe('generateAutoQuote', () => {
  it('inserts a draft quote row with correct tenant and contact', async () => {
    store.tables['services']!.push({
      id: randomUUID(),
      tenant_id: TENANT_ID,
      name: 'Consultation',
      unit_price: 150,
      is_active: true,
      sort_order: 0,
    })

    await generateAutoQuote(TENANT_ID, CONTACT_ID, 'dental')

    const quotes = store.tables['quotes'] as Row[]
    expect(quotes.length).toBe(1)
    const q = quotes[0]!
    expect(q['tenant_id']).toBe(TENANT_ID)
    expect(q['contact_id']).toBe(CONTACT_ID)
    expect(q['status']).toBe('draft')
    expect(q['created_by']).toBe('ai')
  })

  it('does not throw when no services found for vertical', async () => {
    // No services seeded → generateAutoQuote early-returns without inserting.
    await expect(generateAutoQuote(TENANT_ID, CONTACT_ID, 'dental')).resolves.toBeUndefined()
    expect((store.tables['quotes'] as Row[]).length).toBe(0)
  })
})
