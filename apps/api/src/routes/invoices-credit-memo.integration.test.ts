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

const TENANT_ID = 'aaaaaaaa-0000-0000-0000-00000cm00001'
const OTHER_TENANT_ID = 'aaaaaaaa-0000-0000-0000-00000cm00099'
const SECRET = process.env['AUTH_SECRET'] ?? 'test-secret-for-unit-tests-only-32ch'
process.env['AUTH_SECRET'] = SECRET
process.env['SUPABASE_URL'] = 'https://mock.supabase.co'
process.env['SUPABASE_SERVICE_ROLE_KEY'] = 'mock-service-key'

async function makeToken(): Promise<string> {
  return mintTestToken(
    { sub: 'user-1', appUserId: 'user-1', tenantId: TENANT_ID, role: 'owner' },
    { secret: SECRET }
  )
}

const { default: express } = await import('express')
const { default: request } = await import('supertest')
const { default: invoicesRouter } = await import('./invoices.js')

function makeApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/invoices', invoicesRouter)
  return app
}

function seedInvoice(overrides: Row = {}): Row {
  return {
    id: 'inv-1',
    tenant_id: TENANT_ID,
    invoice_number: 'INV-1001',
    contact_id: 'contact-1',
    status: 'sent',
    total: 200,
    amount_paid: 0,
    balance_due: 200,
    ...overrides,
  }
}

beforeEach(() => {
  store = createStore()
  store.tables['invoices'] = [seedInvoice()]
  store.tables['credit_memos'] = []
  store.tables['activity_log'] = []
})

describe('POST /api/invoices/:id/credit-memo', () => {
  it('reduces the balance and records a credit_memos row', async () => {
    const token = await makeToken()
    const res = await request(makeApp())
      .post('/api/invoices/inv-1/credit-memo')
      .set('Authorization', `Bearer ${token}`)
      .send({ amount: 50, reason: 'Overcharged' })

    expect(res.status).toBe(201)
    expect(res.body.credit_memo.amount).toBe(50)
    expect(res.body.credit_memo.reason).toBe('Overcharged')
    expect(res.body.invoice.amount_paid).toBe(50)

    const memos = store.tables['credit_memos'] as Row[]
    expect(memos).toHaveLength(1)
    expect(memos[0]?.['invoice_id']).toBe('inv-1')
  })

  it('flips the invoice to received when the credit clears the full balance', async () => {
    store.tables['invoices'] = [seedInvoice({ total: 200, amount_paid: 0, balance_due: 200 })]
    const token = await makeToken()
    const res = await request(makeApp())
      .post('/api/invoices/inv-1/credit-memo')
      .set('Authorization', `Bearer ${token}`)
      .send({ amount: 200 })

    expect(res.status).toBe(201)
    expect(res.body.invoice.status).toBe('received')
  })

  it('400s a credit amount greater than the outstanding balance', async () => {
    store.tables['invoices'] = [seedInvoice({ total: 200, amount_paid: 150, balance_due: 50 })]
    const token = await makeToken()
    const res = await request(makeApp())
      .post('/api/invoices/inv-1/credit-memo')
      .set('Authorization', `Bearer ${token}`)
      .send({ amount: 100 })

    expect(res.status).toBe(400)
  })

  it('400s a non-positive amount', async () => {
    const token = await makeToken()
    const res = await request(makeApp())
      .post('/api/invoices/inv-1/credit-memo')
      .set('Authorization', `Bearer ${token}`)
      .send({ amount: 0 })

    expect(res.status).toBe(400)
  })

  it('400s a void invoice', async () => {
    store.tables['invoices'] = [seedInvoice({ status: 'void' })]
    const token = await makeToken()
    const res = await request(makeApp())
      .post('/api/invoices/inv-1/credit-memo')
      .set('Authorization', `Bearer ${token}`)
      .send({ amount: 10 })

    expect(res.status).toBe(400)
  })

  it('404s an invoice in another tenant', async () => {
    store.tables['invoices'] = [seedInvoice({ tenant_id: OTHER_TENANT_ID })]
    const token = await makeToken()
    const res = await request(makeApp())
      .post('/api/invoices/inv-1/credit-memo')
      .set('Authorization', `Bearer ${token}`)
      .send({ amount: 10 })

    expect(res.status).toBe(404)
  })
})

describe('GET /api/invoices/:id/credit-memos', () => {
  it('lists memos for this invoice, tenant-scoped', async () => {
    store.tables['credit_memos'] = [
      { id: 'cm-1', tenant_id: TENANT_ID, invoice_id: 'inv-1', amount: 20, reason: null },
      { id: 'cm-2', tenant_id: OTHER_TENANT_ID, invoice_id: 'inv-1', amount: 5, reason: null },
    ]
    const token = await makeToken()
    const res = await request(makeApp())
      .get('/api/invoices/inv-1/credit-memos')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.data).toHaveLength(1)
    expect(res.body.data[0].id).toBe('cm-1')
  })
})
