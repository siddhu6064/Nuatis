import { jest, describe, it, expect, beforeEach } from '@jest/globals'
import { mintTestToken } from './__test-support__/jwt.js'
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

const TENANT_ID = 'aaaaaaaa-0000-0000-0000-00000exp0001'
const USER_ID = 'user-exp-001'
const SECRET = process.env['AUTH_SECRET'] ?? 'test-secret-for-unit-tests-only-32ch'
process.env['AUTH_SECRET'] = SECRET
process.env['SUPABASE_URL'] = 'https://mock.supabase.co'
process.env['SUPABASE_SERVICE_ROLE_KEY'] = 'mock-service-key'

async function makeToken(): Promise<string> {
  return mintTestToken(
    { sub: USER_ID, tenantId: TENANT_ID, role: 'owner', vertical: 'restaurant' },
    { secret: SECRET }
  )
}

const { default: express } = await import('express')
const { default: request } = await import('supertest')
const { default: expensesRouter } = await import('./expenses.js')
const { default: expenseCategoriesRouter } = await import('./expense-categories.js')
const { default: recurringExpensesRouter } = await import('./recurring-expenses.js')
const { scanRecurringExpenses } = await import('../workers/recurring-expense-scanner.js')

function makeApp() {
  const app = express()
  app.use(express.json({ limit: '15mb' }))
  app.use('/api/expenses', expensesRouter)
  app.use('/api/expense-categories', expenseCategoriesRouter)
  app.use('/api/recurring-expenses', recurringExpensesRouter)
  return app
}

function entitledTenant(overrides: Row = {}): Row {
  return {
    id: TENANT_ID,
    modules: { expenses: true },
    subscription_status: 'active',
    subscription_plan: 'pro',
    expense_counter: 1000,
    ...overrides,
  }
}

beforeEach(() => {
  store = createStore()
  store.tables['tenants'] = [entitledTenant()]
  store.tables['expenses'] = []
  store.tables['expense_categories'] = []
  store.tables['recurring_expenses'] = []
  store.tables['activity_log'] = []
})

describe('expenses module gate', () => {
  it('returns 402 when the tenant is not entitled to the expenses module', async () => {
    store.tables['tenants'] = [
      { id: TENANT_ID, modules: {}, subscription_status: 'active', subscription_plan: 'core' },
    ]
    const token = await makeToken()
    const res = await request(makeApp())
      .get('/api/expenses')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(402)
    expect(res.body.missing_modules).toContain('expenses')
  })

  it('returns 402 when the subscription is not active/trialing', async () => {
    store.tables['tenants'] = [entitledTenant({ subscription_status: 'past_due' })]
    const token = await makeToken()
    const res = await request(makeApp())
      .get('/api/expenses')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(402)
  })
})

describe('GET /api/expense-categories — lazy seeding', () => {
  it('seeds the 8 standard categories on first access', async () => {
    const token = await makeToken()
    const res = await request(makeApp())
      .get('/api/expense-categories')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.data).toHaveLength(8)
    const names = (res.body.data as Array<{ name: string }>).map((c) => c.name)
    expect(names).toContain('Rent')
    expect(names).toContain('Other')
  })

  it('does not re-seed on a second call', async () => {
    const token = await makeToken()
    const app = makeApp()
    await request(app).get('/api/expense-categories').set('Authorization', `Bearer ${token}`)
    const second = await request(app)
      .get('/api/expense-categories')
      .set('Authorization', `Bearer ${token}`)

    expect(second.body.data).toHaveLength(8)
  })

  it('excludes archived categories by default, includes them with include_archived=true', async () => {
    const token = await makeToken()
    const app = makeApp()
    const seeded = await request(app)
      .get('/api/expense-categories')
      .set('Authorization', `Bearer ${token}`)
    const firstId = (seeded.body.data as Array<{ id: string }>)[0]!.id

    await request(app)
      .put(`/api/expense-categories/${firstId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ is_archived: true })

    const activeOnly = await request(app)
      .get('/api/expense-categories')
      .set('Authorization', `Bearer ${token}`)
    expect(activeOnly.body.data).toHaveLength(7)

    const withArchived = await request(app)
      .get('/api/expense-categories?include_archived=true')
      .set('Authorization', `Bearer ${token}`)
    expect(withArchived.body.data).toHaveLength(8)
  })
})

describe('POST /api/expenses', () => {
  it('creates an expense with a generated expense_number', async () => {
    const token = await makeToken()
    const res = await request(makeApp())
      .post('/api/expenses')
      .set('Authorization', `Bearer ${token}`)
      .send({ amount: 150.5, vendor: 'Verizon', expense_date: '2026-08-01' })

    expect(res.status).toBe(201)
    expect(res.body.expense_number).toBe('EXP-1001')
    expect(res.body.amount).toBe(150.5)
    expect(res.body.vendor).toBe('Verizon')
  })

  it('returns 400 when amount is missing or not positive', async () => {
    const token = await makeToken()
    const res = await request(makeApp())
      .post('/api/expenses')
      .set('Authorization', `Bearer ${token}`)
      .send({ vendor: 'No Amount Inc' })

    expect(res.status).toBe(400)
  })

  it('rejects a disallowed receipt file type', async () => {
    const token = await makeToken()
    const res = await request(makeApp())
      .post('/api/expenses')
      .set('Authorization', `Bearer ${token}`)
      .send({
        amount: 20,
        receipt_data: Buffer.from('fake').toString('base64'),
        receipt_filename: 'malware.exe',
        receipt_file_type: 'application/x-msdownload',
      })

    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/not allowed/)
  })

  it('rejects a receipt over the 10MB limit', async () => {
    const token = await makeToken()
    const oversized = Buffer.alloc(11 * 1024 * 1024, 'a').toString('base64')
    const res = await request(makeApp())
      .post('/api/expenses')
      .set('Authorization', `Bearer ${token}`)
      .send({
        amount: 20,
        receipt_data: oversized,
        receipt_filename: 'receipt.pdf',
        receipt_file_type: 'application/pdf',
      })

    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/10MB/)
  })

  it('accepts a valid receipt upload inline on create', async () => {
    const token = await makeToken()
    const res = await request(makeApp())
      .post('/api/expenses')
      .set('Authorization', `Bearer ${token}`)
      .send({
        amount: 20,
        receipt_data: Buffer.from('valid receipt bytes').toString('base64'),
        receipt_filename: 'receipt.pdf',
        receipt_file_type: 'application/pdf',
      })

    expect(res.status).toBe(201)
    expect(res.body.receipt_filename).toBe('receipt.pdf')
    expect(res.body.receipt_signed_url).toBe('https://signed.url/test')
  })
})

describe('PUT /api/expenses/:id', () => {
  it('edits amount, vendor, and notes', async () => {
    const token = await makeToken()
    const app = makeApp()
    const createRes = await request(app)
      .post('/api/expenses')
      .set('Authorization', `Bearer ${token}`)
      .send({ amount: 50, vendor: 'Original Vendor' })
    const id = createRes.body.id as string

    const res = await request(app)
      .put(`/api/expenses/${id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ amount: 75, vendor: 'Updated Vendor', notes: 'corrected amount' })

    expect(res.status).toBe(200)
    expect(res.body.amount).toBe(75)
    expect(res.body.vendor).toBe('Updated Vendor')
    expect(res.body.notes).toBe('corrected amount')
  })
})

describe('DELETE /api/expenses/:id', () => {
  it('soft-deletes an expense', async () => {
    const token = await makeToken()
    const app = makeApp()
    const createRes = await request(app)
      .post('/api/expenses')
      .set('Authorization', `Bearer ${token}`)
      .send({ amount: 10 })
    const id = createRes.body.id as string

    const res = await request(app)
      .delete(`/api/expenses/${id}`)
      .set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(200)

    const getRes = await request(app)
      .get(`/api/expenses/${id}`)
      .set('Authorization', `Bearer ${token}`)
    expect(getRes.status).toBe(404)
  })
})

describe('tenant isolation', () => {
  it("does not return another tenant's expense", async () => {
    const OTHER_TENANT_ID = 'aaaaaaaa-0000-0000-0000-00000exp0002'
    ;(store.tables['tenants'] as Row[]).push(entitledTenant({ id: OTHER_TENANT_ID }))
    store.tables['expenses'] = [
      {
        id: 'exp-other',
        tenant_id: OTHER_TENANT_ID,
        expense_number: 'EXP-9001',
        amount: 999,
        expense_date: '2026-08-01',
        deleted_at: null,
        created_at: new Date().toISOString(),
      },
    ]

    const token = await makeToken()
    const res = await request(makeApp())
      .get('/api/expenses/exp-other')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(404)
  })
})

describe('recurring expense generation', () => {
  it('generates a due monthly rule into a new expense and stamps last_generated_at', async () => {
    const today = new Date()
    store.tables['recurring_expenses'] = [
      {
        id: 'rec-1',
        tenant_id: TENANT_ID,
        category_id: null,
        amount: 2400,
        vendor: 'Landlord LLC',
        notes: 'Monthly rent',
        frequency: 'monthly',
        day_of_week: null,
        day_of_month: today.getDate(),
        month_of_year: null,
        enabled: true,
        last_generated_at: null,
        deleted_at: null,
      },
    ]

    await scanRecurringExpenses()

    const expenses = store.tables['expenses'] as Row[]
    expect(expenses).toHaveLength(1)
    expect(expenses[0]!['recurring_expense_id']).toBe('rec-1')
    expect(expenses[0]!['amount']).toBe(2400)
    expect(expenses[0]!['vendor']).toBe('Landlord LLC')

    const rule = (store.tables['recurring_expenses'] as Row[]).find((r) => r['id'] === 'rec-1')
    expect(rule?.['last_generated_at']).toBeTruthy()
  })

  it('does not generate for a rule whose scheduled day has not arrived', async () => {
    const today = new Date()
    const notToday = today.getDate() === 1 ? 2 : 1
    store.tables['recurring_expenses'] = [
      {
        id: 'rec-2',
        tenant_id: TENANT_ID,
        category_id: null,
        amount: 100,
        vendor: 'Not Due Co',
        notes: null,
        frequency: 'monthly',
        day_of_week: null,
        day_of_month: notToday,
        month_of_year: null,
        enabled: true,
        last_generated_at: null,
        deleted_at: null,
      },
    ]

    await scanRecurringExpenses()

    expect(store.tables['expenses']).toHaveLength(0)
  })

  it('does not re-generate a rule already generated this month', async () => {
    const today = new Date()
    store.tables['recurring_expenses'] = [
      {
        id: 'rec-3',
        tenant_id: TENANT_ID,
        category_id: null,
        amount: 100,
        vendor: 'Already Generated Co',
        notes: null,
        frequency: 'monthly',
        day_of_week: null,
        day_of_month: today.getDate(),
        month_of_year: null,
        enabled: true,
        last_generated_at: new Date().toISOString(),
        deleted_at: null,
      },
    ]

    await scanRecurringExpenses()

    expect(store.tables['expenses']).toHaveLength(0)
  })
})
