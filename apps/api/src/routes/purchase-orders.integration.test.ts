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

const TENANT_ID = 'aaaaaaaa-0000-0000-0000-00000po00001'
const SECRET = process.env['AUTH_SECRET'] ?? 'test-secret-for-unit-tests-only-32ch'
process.env['AUTH_SECRET'] = SECRET
process.env['SUPABASE_URL'] = 'https://mock.supabase.co'
process.env['SUPABASE_SERVICE_ROLE_KEY'] = 'mock-service-key'

async function makeToken(): Promise<string> {
  return mintTestToken({ sub: 'user-1', tenantId: TENANT_ID, role: 'owner' }, { secret: SECRET })
}

const { default: express } = await import('express')
const { default: request } = await import('supertest')
const { default: purchaseOrdersRouter } = await import('./purchase-orders.js')

function makeApp() {
  const app = express()
  app.use('/api/purchase-orders', express.json(), purchaseOrdersRouter)
  return app
}

const VENDOR_ID = 'vendor-1'

beforeEach(() => {
  store = createStore()
  store.tables['tenants'] = [{ id: TENANT_ID, modules: { crm: true }, po_counter: 1000 }]
  store.tables['vendors'] = [
    { id: VENDOR_ID, tenant_id: TENANT_ID, name: 'Acme Supply', is_active: true },
  ]
  store.tables['purchase_orders'] = []
  store.tables['purchase_order_items'] = []
  store.tables['inventory_items'] = []
})

async function createPo(app: import('express').Express, token: string) {
  return request(app)
    .post('/api/purchase-orders')
    .set('Authorization', `Bearer ${token}`)
    .send({
      vendor_id: VENDOR_ID,
      items: [{ description: 'Widget', quantity_ordered: 10, unit_cost: 2.5 }],
    })
}

describe('POST /api/purchase-orders', () => {
  it('creates a draft PO with a generated po_number and computed subtotal', async () => {
    const token = await makeToken()
    const res = await createPo(makeApp(), token)

    expect(res.status).toBe(201)
    expect(res.body.po_number).toBe('PO-1001')
    expect(res.body.status).toBe('draft')
    expect(res.body.subtotal).toBe(25)
    expect(res.body.items).toHaveLength(1)
  })

  it('404s for a vendor in another tenant', async () => {
    const token = await makeToken()
    const res = await request(makeApp())
      .post('/api/purchase-orders')
      .set('Authorization', `Bearer ${token}`)
      .send({
        vendor_id: 'someone-elses-vendor',
        items: [{ description: 'X', quantity_ordered: 1, unit_cost: 1 }],
      })
    expect(res.status).toBe(404)
  })

  it('400s with no items', async () => {
    const token = await makeToken()
    const res = await request(makeApp())
      .post('/api/purchase-orders')
      .set('Authorization', `Bearer ${token}`)
      .send({ vendor_id: VENDOR_ID, items: [] })
    expect(res.status).toBe(400)
  })
})

describe('PO lifecycle', () => {
  it('draft -> sent -> receive fully -> received, and bumps linked inventory', async () => {
    store.tables['inventory_items'] = [
      { id: 'inv-1', tenant_id: TENANT_ID, name: 'Widget', quantity: 5, deleted_at: null },
    ]
    const app = makeApp()
    const token = await makeToken()

    const createRes = await request(app)
      .post('/api/purchase-orders')
      .set('Authorization', `Bearer ${token}`)
      .send({
        vendor_id: VENDOR_ID,
        items: [
          { inventory_item_id: 'inv-1', description: 'Widget', quantity_ordered: 10, unit_cost: 3 },
        ],
      })
    const poId = createRes.body.id as string
    const itemId = createRes.body.items[0].id as string

    const sendRes = await request(app)
      .post(`/api/purchase-orders/${poId}/send`)
      .set('Authorization', `Bearer ${token}`)
    expect(sendRes.status).toBe(200)
    expect(sendRes.body.status).toBe('sent')

    const receiveRes = await request(app)
      .post(`/api/purchase-orders/${poId}/receive`)
      .set('Authorization', `Bearer ${token}`)
      .send({ items: [{ item_id: itemId, quantity_received_now: 10 }] })

    expect(receiveRes.status).toBe(200)
    expect(receiveRes.body.status).toBe('received')

    const invRow = store.tables['inventory_items']?.find((r) => r['id'] === 'inv-1')
    expect(invRow?.['quantity']).toBe(15) // 5 + 10
    expect(invRow?.['unit_cost']).toBe(3)
  })

  it('partial receive leaves status = partial', async () => {
    const app = makeApp()
    const token = await makeToken()
    const createRes = await createPo(app, token)
    const poId = createRes.body.id as string
    const itemId = createRes.body.items[0].id as string

    await request(app)
      .post(`/api/purchase-orders/${poId}/send`)
      .set('Authorization', `Bearer ${token}`)
    const res = await request(app)
      .post(`/api/purchase-orders/${poId}/receive`)
      .set('Authorization', `Bearer ${token}`)
      .send({ items: [{ item_id: itemId, quantity_received_now: 4 }] }) // ordered 10

    expect(res.status).toBe(200)
    expect(res.body.status).toBe('partial')
  })

  it('409s receiving against a draft PO', async () => {
    const app = makeApp()
    const token = await makeToken()
    const createRes = await createPo(app, token)
    const poId = createRes.body.id as string
    const itemId = createRes.body.items[0].id as string

    const res = await request(app)
      .post(`/api/purchase-orders/${poId}/receive`)
      .set('Authorization', `Bearer ${token}`)
      .send({ items: [{ item_id: itemId, quantity_received_now: 1 }] })
    expect(res.status).toBe(409)
  })

  it('cancel blocks further receiving', async () => {
    const app = makeApp()
    const token = await makeToken()
    const createRes = await createPo(app, token)
    const poId = createRes.body.id as string

    await request(app)
      .post(`/api/purchase-orders/${poId}/send`)
      .set('Authorization', `Bearer ${token}`)
    const cancelRes = await request(app)
      .post(`/api/purchase-orders/${poId}/cancel`)
      .set('Authorization', `Bearer ${token}`)
    expect(cancelRes.status).toBe(200)
    expect(cancelRes.body.status).toBe('cancelled')

    const recancel = await request(app)
      .post(`/api/purchase-orders/${poId}/cancel`)
      .set('Authorization', `Bearer ${token}`)
    expect(recancel.status).toBe(409)
  })

  it('DELETE only works while draft', async () => {
    const app = makeApp()
    const token = await makeToken()
    const createRes = await createPo(app, token)
    const poId = createRes.body.id as string

    await request(app)
      .post(`/api/purchase-orders/${poId}/send`)
      .set('Authorization', `Bearer ${token}`)
    const deleteRes = await request(app)
      .delete(`/api/purchase-orders/${poId}`)
      .set('Authorization', `Bearer ${token}`)
    expect(deleteRes.status).toBe(409)
  })
})
