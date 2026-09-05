import { jest, describe, it, expect, beforeEach } from '@jest/globals'
import { mintTestToken } from './__test-support__/jwt.js'
import {
  createStore,
  createMockSupabase,
  type MockStore,
} from './__test-support__/supabase-mock.js'

let store: MockStore = createStore()

jest.unstable_mockModule('@supabase/supabase-js', () => ({
  createClient: () => createMockSupabase(store),
}))

const TENANT_ID = 'aaaaaaaa-0000-0000-0000-00000ae00001'
const SECRET = process.env['AUTH_SECRET'] ?? 'test-secret-for-unit-tests-only-32ch'
process.env['AUTH_SECRET'] = SECRET
process.env['SUPABASE_URL'] = 'https://mock.supabase.co'
process.env['SUPABASE_SERVICE_ROLE_KEY'] = 'mock-service-key'

async function makeToken(role = 'owner'): Promise<string> {
  return mintTestToken({ sub: 'user-1', tenantId: TENANT_ID, role }, { secret: SECRET })
}

const { default: express } = await import('express')
const { default: request } = await import('supertest')
const { default: accountingExportRouter } = await import('./accounting-export.js')

function makeApp() {
  const app = express()
  app.use('/api/accounting-export', express.json(), accountingExportRouter)
  return app
}

const QUOTE_ID = 'quote-1'
const CATEGORY_ID = 'cat-1'

beforeEach(() => {
  store = createStore()
  store.tables['quotes'] = [{ id: QUOTE_ID, tenant_id: TENANT_ID, quote_number: 'Q-1001' }]
  store.tables['quote_payments'] = []
  store.tables['expense_categories'] = [
    { id: CATEGORY_ID, tenant_id: TENANT_ID, name: 'Office Supplies', gl_code: '6100' },
  ]
  store.tables['expenses'] = []
})

describe('GET /api/accounting-export', () => {
  it('400s without a date range', async () => {
    const token = await makeToken()
    const res = await request(makeApp())
      .get('/api/accounting-export')
      .set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(400)
  })

  it('produces a journal CSV with payments as credits and expenses as debits', async () => {
    store.tables['quote_payments'] = [
      {
        id: 'p1',
        tenant_id: TENANT_ID,
        quote_id: QUOTE_ID,
        amount: 500,
        method: 'stripe',
        reference: 'ch_123',
        recorded_at: '2026-06-15T10:00:00.000Z',
      },
    ]
    store.tables['expenses'] = [
      {
        id: 'e1',
        tenant_id: TENANT_ID,
        category_id: CATEGORY_ID,
        amount: 42.5,
        vendor: 'Staples',
        expense_date: '2026-06-10',
        deleted_at: null,
      },
    ]

    const token = await makeToken()
    const res = await request(makeApp())
      .get('/api/accounting-export?start_date=2026-06-01&end_date=2026-06-30')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toMatch(/text\/csv/)
    const lines = (res.text as string).trim().split('\n')
    expect(lines[0]).toBe('Date,Description,Account,Debit,Credit')
    // Sorted by date — the expense (06-10) comes before the payment (06-15)
    expect(lines[1]).toContain('2026-06-10')
    expect(lines[1]).toContain('6100') // uses the category's gl_code, not its name
    expect(lines[1]).toContain('42.50')
    expect(lines[2]).toContain('2026-06-15')
    expect(lines[2]).toContain('Q-1001')
    expect(lines[2]).toContain('500.00')
  })

  it('falls back to the category name when no gl_code is set', async () => {
    store.tables['expense_categories'] = [
      { id: CATEGORY_ID, tenant_id: TENANT_ID, name: 'Travel', gl_code: null },
    ]
    store.tables['expenses'] = [
      {
        id: 'e1',
        tenant_id: TENANT_ID,
        category_id: CATEGORY_ID,
        amount: 100,
        expense_date: '2026-06-05',
        deleted_at: null,
      },
    ]
    const token = await makeToken()
    const res = await request(makeApp())
      .get('/api/accounting-export?start_date=2026-06-01&end_date=2026-06-30')
      .set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(200)
    expect(res.text).toContain('Travel')
  })

  it('403s a non-owner/admin role', async () => {
    const token = await makeToken('staff')
    const res = await request(makeApp())
      .get('/api/accounting-export?start_date=2026-06-01&end_date=2026-06-30')
      .set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(403)
  })
})
