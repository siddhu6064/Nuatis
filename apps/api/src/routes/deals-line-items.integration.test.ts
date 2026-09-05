import { jest, describe, it, expect, beforeEach } from '@jest/globals'
import { mintTestToken } from './__test-support__/jwt.js'
import {
  createStore,
  createMockSupabase,
  type MockStore,
  type Row,
} from './__test-support__/supabase-mock.js'

let store: MockStore = createStore()
const logActivity = jest.fn(async () => undefined)

jest.unstable_mockModule('@supabase/supabase-js', () => ({
  createClient: () => createMockSupabase(store),
}))
jest.unstable_mockModule('../lib/activity.js', () => ({ logActivity }))

const TENANT_ID = 'aaaaaaaa-0000-0000-0000-00000dli0001'
const USER_ID = 'user-dli-001'
const SECRET = process.env['AUTH_SECRET'] ?? 'test-secret-for-unit-tests-only-32ch'
process.env['AUTH_SECRET'] = SECRET
process.env['SUPABASE_URL'] = 'https://mock.supabase.co'
process.env['SUPABASE_SERVICE_ROLE_KEY'] = 'mock-service-key'

async function makeToken(): Promise<string> {
  return mintTestToken(
    { sub: USER_ID, tenantId: TENANT_ID, role: 'owner', vertical: 'dental' },
    { secret: SECRET }
  )
}

const { default: express } = await import('express')
const { default: request } = await import('supertest')
const { default: dealsRouter } = await import('./deals.js')

function makeApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/deals', dealsRouter)
  return app
}

beforeEach(() => {
  store = createStore()
  store.tables['tenants'] = [{ id: TENANT_ID, modules: { deals: true } }]
  store.tables['deals'] = []
  store.tables['deal_line_items'] = []
  store.tables['pipeline_stages'] = []
  store.tables['contacts'] = []
  store.tables['companies'] = []
  store.tables['users'] = []
  logActivity.mockClear()
})

describe('POST /api/deals with line_items', () => {
  it('inserts line items and derives value as their sum', async () => {
    const token = await makeToken()
    const res = await request(makeApp())
      .post('/api/deals')
      .set('Authorization', `Bearer ${token}`)
      .send({
        title: 'Website redesign',
        line_items: [
          { description: 'Design', quantity: 1, unit_price: 500 },
          { description: 'Development', quantity: 2, unit_price: 250 },
        ],
      })

    expect(res.status).toBe(201)
    expect(res.body.value).toBe(1000)
    expect(res.body.line_items).toHaveLength(2)

    const rows = store.tables['deal_line_items'] as Row[]
    expect(rows).toHaveLength(2)
    expect(rows.every((r) => r['tenant_id'] === TENANT_ID)).toBe(true)
  })

  it('a deal with no line_items keeps the manual value field, unaffected', async () => {
    const token = await makeToken()
    const res = await request(makeApp())
      .post('/api/deals')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Manual deal', value: 750 })

    expect(res.status).toBe(201)
    expect(res.body.value).toBe(750)
    expect(res.body.line_items).toEqual([])
  })
})

describe('GET /api/deals/:id', () => {
  it("returns the deal's line items ordered by sort_order", async () => {
    const token = await makeToken()
    const createRes = await request(makeApp())
      .post('/api/deals')
      .set('Authorization', `Bearer ${token}`)
      .send({
        title: 'Itemized deal',
        line_items: [
          { description: 'First', quantity: 1, unit_price: 100 },
          { description: 'Second', quantity: 1, unit_price: 200 },
        ],
      })

    const res = await request(makeApp())
      .get(`/api/deals/${createRes.body.id}`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.line_items.map((i: Row) => i['description'])).toEqual(['First', 'Second'])
  })
})

describe('PUT /api/deals/:id with line_items', () => {
  it('replaces line items and recomputes value', async () => {
    const token = await makeToken()
    const createRes = await request(makeApp())
      .post('/api/deals')
      .set('Authorization', `Bearer ${token}`)
      .send({
        title: 'Deal to edit',
        line_items: [{ description: 'Original', quantity: 1, unit_price: 100 }],
      })

    const res = await request(makeApp())
      .put(`/api/deals/${createRes.body.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        line_items: [
          { description: 'Replaced A', quantity: 2, unit_price: 50 },
          { description: 'Replaced B', quantity: 1, unit_price: 300 },
        ],
      })

    expect(res.status).toBe(200)
    expect(res.body.value).toBe(400)
    expect(res.body.line_items).toHaveLength(2)

    const rows = (store.tables['deal_line_items'] as Row[]).filter(
      (r) => r['deal_id'] === createRes.body.id
    )
    expect(rows).toHaveLength(2)
  })

  it('clearing line_items to an empty array zeroes the deal value', async () => {
    const token = await makeToken()
    const createRes = await request(makeApp())
      .post('/api/deals')
      .set('Authorization', `Bearer ${token}`)
      .send({
        title: 'Deal to clear',
        line_items: [{ description: 'Only item', quantity: 1, unit_price: 100 }],
      })

    const res = await request(makeApp())
      .put(`/api/deals/${createRes.body.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ line_items: [] })

    expect(res.status).toBe(200)
    expect(res.body.value).toBe(0)
    expect(res.body.line_items).toEqual([])
  })

  it('omitting line_items entirely leaves existing ones untouched', async () => {
    const token = await makeToken()
    const createRes = await request(makeApp())
      .post('/api/deals')
      .set('Authorization', `Bearer ${token}`)
      .send({
        title: 'Deal not touching items',
        line_items: [{ description: 'Stays', quantity: 1, unit_price: 100 }],
      })

    const res = await request(makeApp())
      .put(`/api/deals/${createRes.body.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Renamed only' })

    expect(res.status).toBe(200)
    expect(res.body.title).toBe('Renamed only')
    expect(res.body.value).toBe(100)
    expect(res.body.line_items).toBeUndefined()

    const rows = (store.tables['deal_line_items'] as Row[]).filter(
      (r) => r['deal_id'] === createRes.body.id
    )
    expect(rows).toHaveLength(1)
  })
})
