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

const TENANT_ID = 'aaaaaaaa-0000-0000-0000-00000ot00001'
const SECRET = process.env['AUTH_SECRET'] ?? 'test-secret-for-unit-tests-only-32ch'
process.env['AUTH_SECRET'] = SECRET
process.env['SUPABASE_URL'] = 'https://mock.supabase.co'
process.env['SUPABASE_SERVICE_ROLE_KEY'] = 'mock-service-key'

async function makeToken(): Promise<string> {
  return mintTestToken({ sub: 'user-1', tenantId: TENANT_ID, role: 'owner' }, { secret: SECRET })
}

const { default: express } = await import('express')
const { default: request } = await import('supertest')
const { default: orderTemplatesRouter } = await import('./order-templates.js')

function makeApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/order-templates', orderTemplatesRouter)
  return app
}

beforeEach(() => {
  store = createStore()
  store.tables['tenants'] = [{ id: TENANT_ID, modules: { orders: true } }]
  store.tables['order_templates'] = []
})

describe('orders module gate', () => {
  it('403s when the orders module is not enabled', async () => {
    store.tables['tenants'] = [{ id: TENANT_ID, modules: {} }]
    const token = await makeToken()
    const res = await request(makeApp())
      .get('/api/order-templates')
      .set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(403)
  })
})

describe('POST /api/order-templates', () => {
  it('creates a template', async () => {
    const token = await makeToken()
    const res = await request(makeApp())
      .post('/api/order-templates')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Regular Coffee Order',
        line_items: [{ description: 'Large coffee', quantity: 2, unit_price: 3.5 }],
        fulfillment_type: 'pickup',
      })

    expect(res.status).toBe(201)
    expect(res.body.name).toBe('Regular Coffee Order')
    expect(res.body.line_items).toHaveLength(1)
  })

  it('400s with no name', async () => {
    const token = await makeToken()
    const res = await request(makeApp())
      .post('/api/order-templates')
      .set('Authorization', `Bearer ${token}`)
      .send({ line_items: [{ description: 'X', quantity: 1, unit_price: 1 }] })
    expect(res.status).toBe(400)
  })

  it('400s with no line items', async () => {
    const token = await makeToken()
    const res = await request(makeApp())
      .post('/api/order-templates')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Empty' })
    expect(res.status).toBe(400)
  })
})

describe('GET /api/order-templates', () => {
  it('lists tenant templates only', async () => {
    store.tables['order_templates'] = [
      { id: 't-1', tenant_id: TENANT_ID, name: 'Mine', line_items: [] },
      { id: 't-2', tenant_id: 'other-tenant', name: 'Not mine', line_items: [] },
    ]
    const token = await makeToken()
    const res = await request(makeApp())
      .get('/api/order-templates')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.data).toHaveLength(1)
    expect(res.body.data[0].name).toBe('Mine')
  })
})

describe('DELETE /api/order-templates/:id', () => {
  it('deletes a template', async () => {
    store.tables['order_templates'] = [
      { id: 't-1', tenant_id: TENANT_ID, name: 'Mine', line_items: [] },
    ]
    const token = await makeToken()
    const res = await request(makeApp())
      .delete('/api/order-templates/t-1')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(store.tables['order_templates']).toHaveLength(0)
  })
})
