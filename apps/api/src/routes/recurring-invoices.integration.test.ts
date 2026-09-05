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

const TENANT_ID = 'aaaaaaaa-0000-0000-0000-00000rin0001'
const OTHER_TENANT_ID = 'aaaaaaaa-0000-0000-0000-00000rin0099'
const CONTACT_ID = 'bbbbbbbb-0000-0000-0000-00000rin0002'
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
const { default: recurringInvoicesRouter } = await import('./recurring-invoices.js')

function makeApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/recurring-invoices', recurringInvoicesRouter)
  return app
}

beforeEach(() => {
  store = createStore()
  store.tables['contacts'] = [{ id: CONTACT_ID, tenant_id: TENANT_ID, full_name: 'Jane Client' }]
  store.tables['recurring_invoices'] = []
})

describe('POST /api/recurring-invoices', () => {
  it('creates a monthly recurring invoice rule', async () => {
    const token = await makeToken()
    const res = await request(makeApp())
      .post('/api/recurring-invoices')
      .set('Authorization', `Bearer ${token}`)
      .send({
        contact_id: CONTACT_ID,
        description: 'Monthly retainer',
        amount: 500,
        frequency: 'monthly',
        day_of_month: 1,
      })

    expect(res.status).toBe(201)
    expect(res.body.amount).toBe(500)
    expect(res.body.frequency).toBe('monthly')
  })

  it('404s a contact from another tenant', async () => {
    store.tables['contacts'] = [
      { id: CONTACT_ID, tenant_id: OTHER_TENANT_ID, full_name: 'Foreign' },
    ]
    const token = await makeToken()
    const res = await request(makeApp())
      .post('/api/recurring-invoices')
      .set('Authorization', `Bearer ${token}`)
      .send({
        contact_id: CONTACT_ID,
        description: 'x',
        amount: 100,
        frequency: 'monthly',
        day_of_month: 1,
      })

    expect(res.status).toBe(404)
  })

  it('400s a weekly rule missing day_of_week', async () => {
    const token = await makeToken()
    const res = await request(makeApp())
      .post('/api/recurring-invoices')
      .set('Authorization', `Bearer ${token}`)
      .send({ contact_id: CONTACT_ID, description: 'x', amount: 100, frequency: 'weekly' })

    expect(res.status).toBe(400)
  })

  it('400s a non-positive amount', async () => {
    const token = await makeToken()
    const res = await request(makeApp())
      .post('/api/recurring-invoices')
      .set('Authorization', `Bearer ${token}`)
      .send({
        contact_id: CONTACT_ID,
        description: 'x',
        amount: 0,
        frequency: 'monthly',
        day_of_month: 1,
      })

    expect(res.status).toBe(400)
  })
})

describe('GET /api/recurring-invoices', () => {
  it('lists tenant-scoped, non-deleted rules', async () => {
    store.tables['recurring_invoices'] = [
      {
        id: 'r-1',
        tenant_id: TENANT_ID,
        contact_id: CONTACT_ID,
        description: 'Mine',
        amount: 100,
        frequency: 'monthly',
        day_of_month: 1,
        deleted_at: null,
      },
      {
        id: 'r-2',
        tenant_id: OTHER_TENANT_ID,
        contact_id: CONTACT_ID,
        description: 'Not mine',
        amount: 200,
        frequency: 'monthly',
        day_of_month: 1,
        deleted_at: null,
      },
    ]
    const token = await makeToken()
    const res = await request(makeApp())
      .get('/api/recurring-invoices')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.data).toHaveLength(1)
    expect(res.body.data[0].id).toBe('r-1')
  })
})

describe('PUT /api/recurring-invoices/:id', () => {
  it('updates the amount', async () => {
    store.tables['recurring_invoices'] = [
      {
        id: 'r-1',
        tenant_id: TENANT_ID,
        contact_id: CONTACT_ID,
        description: 'x',
        amount: 100,
        frequency: 'monthly',
        day_of_month: 1,
        deleted_at: null,
      },
    ]
    const token = await makeToken()
    const res = await request(makeApp())
      .put('/api/recurring-invoices/r-1')
      .set('Authorization', `Bearer ${token}`)
      .send({ amount: 250 })

    expect(res.status).toBe(200)
    expect(res.body.amount).toBe(250)
  })

  it('404s a rule in another tenant', async () => {
    store.tables['recurring_invoices'] = [
      {
        id: 'r-1',
        tenant_id: OTHER_TENANT_ID,
        contact_id: CONTACT_ID,
        description: 'x',
        amount: 100,
        frequency: 'monthly',
        day_of_month: 1,
        deleted_at: null,
      },
    ]
    const token = await makeToken()
    const res = await request(makeApp())
      .put('/api/recurring-invoices/r-1')
      .set('Authorization', `Bearer ${token}`)
      .send({ amount: 250 })

    expect(res.status).toBe(404)
  })
})

describe('DELETE /api/recurring-invoices/:id', () => {
  it('soft-deletes the rule', async () => {
    store.tables['recurring_invoices'] = [
      {
        id: 'r-1',
        tenant_id: TENANT_ID,
        contact_id: CONTACT_ID,
        description: 'x',
        amount: 100,
        frequency: 'monthly',
        day_of_month: 1,
        deleted_at: null,
      },
    ]
    const token = await makeToken()
    const res = await request(makeApp())
      .delete('/api/recurring-invoices/r-1')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    const rows = store.tables['recurring_invoices'] as Row[]
    expect(rows[0]?.['deleted_at']).toBeTruthy()
  })
})
