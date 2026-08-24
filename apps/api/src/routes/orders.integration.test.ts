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

const TENANT_ID = 'aaaaaaaa-0000-0000-0000-00000ord0001'
const USER_ID = 'user-ord-001'
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

const [{ default: express }, { default: request }, { default: ordersRouter }] = await Promise.all([
  import('express'),
  import('supertest'),
  import('./orders.js'),
])

function makeApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/orders', ordersRouter)
  return app
}

beforeEach(() => {
  store = createStore()
  store.tables['tenants'] = [
    { id: TENANT_ID, modules: { orders: true }, order_counter: 1000, tax_rate: 0, settings: {} },
  ]
  store.tables['orders'] = []
  store.tables['order_line_items'] = []
  store.tables['order_payments'] = []
  store.tables['inventory_items'] = []
  store.tables['locations'] = []
  store.tables['activity_log'] = []
})

describe('orders module gate', () => {
  it('returns 403 when the orders module is not enabled', async () => {
    store.tables['tenants'] = [{ id: TENANT_ID, modules: { orders: false } }]
    const token = await makeToken()
    const res = await request(makeApp()).get('/api/orders').set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(403)
  })
})

describe('POST /api/orders', () => {
  it('creates an order with line items and computed totals', async () => {
    const token = await makeToken()
    const res = await request(makeApp())
      .post('/api/orders')
      .set('Authorization', `Bearer ${token}`)
      .send({
        customer_name: 'Walk-in Wendy',
        line_items: [
          { description: 'Latte', quantity: 2, unit_price: 4.5 },
          { description: 'Muffin', quantity: 1, unit_price: 3.5 },
        ],
      })

    expect(res.status).toBe(201)
    expect(res.body.order_number).toBe('ORD-1001')
    expect(res.body.status).toBe('pending')
    expect(res.body.subtotal).toBe(12.5)
    expect(res.body.total).toBe(12.5)
    // Note: the shared supabase test mock (__test-support__/supabase-mock.ts)
    // collapses a single-row insert().select() result to a bare object
    // (mimicking .single() semantics) regardless of whether .single() was
    // called — a pre-existing mock quirk, not a route bug. Using 2 line
    // items here avoids tripping that collapse.
    expect(res.body.line_items).toHaveLength(2)
  })

  it('persists assigned_staff_id and deal_id when provided', async () => {
    const token = await makeToken()
    const res = await request(makeApp())
      .post('/api/orders')
      .set('Authorization', `Bearer ${token}`)
      .send({
        customer_name: 'Staffed Steve',
        line_items: [{ description: 'Latte', quantity: 1, unit_price: 4.5 }],
        assigned_staff_id: 'staff-1',
        deal_id: 'deal-1',
      })

    expect(res.status).toBe(201)
    expect(res.body.assigned_staff_id).toBe('staff-1')
    expect(res.body.deal_id).toBe('deal-1')
  })

  it('returns 400 when no line items are provided', async () => {
    const token = await makeToken()
    const res = await request(makeApp())
      .post('/api/orders')
      .set('Authorization', `Bearer ${token}`)
      .send({ customer_name: 'No Items Nancy', line_items: [] })

    expect(res.status).toBe(400)
  })

  it('returns 400 when neither contact_id nor customer_name is given', async () => {
    const token = await makeToken()
    const res = await request(makeApp())
      .post('/api/orders')
      .set('Authorization', `Bearer ${token}`)
      .send({ line_items: [{ description: 'Latte', quantity: 1, unit_price: 4.5 }] })

    expect(res.status).toBe(400)
  })
})

describe('PUT /api/orders/:id — reassign staff', () => {
  it('sets and clears assigned_staff_id', async () => {
    const token = await makeToken()
    const app = makeApp()
    const createRes = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${token}`)
      .send({
        customer_name: 'Reassign Rita',
        line_items: [{ description: 'Bagel', quantity: 1, unit_price: 3 }],
      })
    const id = createRes.body.id as string

    const assignRes = await request(app)
      .put(`/api/orders/${id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ assigned_staff_id: 'staff-2' })
    expect(assignRes.status).toBe(200)
    expect(assignRes.body.assigned_staff_id).toBe('staff-2')

    const clearRes = await request(app)
      .put(`/api/orders/${id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ assigned_staff_id: null })
    expect(clearRes.status).toBe(200)
    expect(clearRes.body.assigned_staff_id).toBeNull()
  })
})

describe('GET /api/orders', () => {
  it('filters by status', async () => {
    store.tables['orders'] = [
      {
        id: 'ord-1',
        tenant_id: TENANT_ID,
        order_number: 'ORD-1001',
        status: 'pending',
        deleted_at: null,
        created_at: new Date().toISOString(),
      },
      {
        id: 'ord-2',
        tenant_id: TENANT_ID,
        order_number: 'ORD-1002',
        status: 'completed',
        deleted_at: null,
        created_at: new Date().toISOString(),
      },
    ]
    const token = await makeToken()
    const res = await request(makeApp())
      .get('/api/orders?status=completed')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    const ids = (res.body.data as Array<{ id: string }>).map((r) => r.id)
    expect(ids).toEqual(['ord-2'])
  })
})

describe('PUT /api/orders/:id/status', () => {
  it('allows pending -> confirmed and stamps confirmed_at', async () => {
    const token = await makeToken()
    const app = makeApp()
    const createRes = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${token}`)
      .send({
        customer_name: 'Status Sam',
        line_items: [{ description: 'Bagel', quantity: 1, unit_price: 3 }],
      })
    const id = createRes.body.id as string

    const res = await request(app)
      .put(`/api/orders/${id}/status`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'confirmed' })

    expect(res.status).toBe(200)
    expect(res.body.status).toBe('confirmed')
    expect(res.body.confirmed_at).toBeDefined()
  })

  it('rejects an invalid transition (pending -> completed)', async () => {
    const token = await makeToken()
    const app = makeApp()
    const createRes = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${token}`)
      .send({
        customer_name: 'Invalid Ivan',
        line_items: [{ description: 'Bagel', quantity: 1, unit_price: 3 }],
      })
    const id = createRes.body.id as string

    const res = await request(app)
      .put(`/api/orders/${id}/status`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'completed' })

    expect(res.status).toBe(400)
    expect(res.body.allowed_transitions).toEqual(['confirmed', 'cancelled'])
  })

  it('adds the order total to a linked deal value and marks it won on completion', async () => {
    store.tables['deals'] = [
      {
        id: 'deal-1',
        tenant_id: TENANT_ID,
        title: 'Catering Co',
        value: 500,
        is_closed_won: false,
      },
    ]

    const token = await makeToken()
    const app = makeApp()
    const createRes = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${token}`)
      .send({
        customer_name: 'Deal Dana',
        line_items: [{ description: 'Catering', quantity: 1, unit_price: 200 }],
        deal_id: 'deal-1',
      })
    const id = createRes.body.id as string

    for (const status of ['confirmed', 'in_progress', 'ready', 'completed']) {
      const res = await request(app)
        .put(`/api/orders/${id}/status`)
        .set('Authorization', `Bearer ${token}`)
        .send({ status })
      expect(res.status).toBe(200)
    }

    const deal = (store.tables['deals'] as Row[]).find((d) => d['id'] === 'deal-1')
    expect(deal?.['value']).toBe(700) // 500 existing + 200 order total, not overwritten
    expect(deal?.['is_closed_won']).toBe(true)
  })

  it('does not re-fire the won transition for a deal already closed won', async () => {
    store.tables['deals'] = [
      { id: 'deal-2', tenant_id: TENANT_ID, title: 'Repeat Co', value: 1000, is_closed_won: true },
    ]

    const token = await makeToken()
    const app = makeApp()
    const createRes = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${token}`)
      .send({
        customer_name: 'Repeat Rita',
        line_items: [{ description: 'Second order', quantity: 1, unit_price: 50 }],
        deal_id: 'deal-2',
      })
    const id = createRes.body.id as string

    for (const status of ['confirmed', 'in_progress', 'ready', 'completed']) {
      await request(app)
        .put(`/api/orders/${id}/status`)
        .set('Authorization', `Bearer ${token}`)
        .send({ status })
    }

    const deal = (store.tables['deals'] as Row[]).find((d) => d['id'] === 'deal-2')
    expect(deal?.['value']).toBe(1050) // value still rolls up
    expect(deal?.['is_closed_won']).toBe(true) // stays true, no crash/duplicate flip
  })

  it('deducts linked inventory on completion when auto-deduct is enabled', async () => {
    store.tables['tenants'] = [
      {
        id: TENANT_ID,
        modules: { orders: true },
        order_counter: 1000,
        tax_rate: 0,
        settings: { orders_auto_deduct_inventory: true },
      },
    ]
    store.tables['inventory_items'] = [
      {
        id: 'inv-1',
        tenant_id: TENANT_ID,
        name: 'Coffee Beans',
        quantity: 10,
        deleted_at: null,
      },
    ]

    const token = await makeToken()
    const app = makeApp()
    const createRes = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${token}`)
      .send({
        customer_name: 'Deduct Dana',
        line_items: [
          { description: 'Latte', quantity: 3, unit_price: 4.5, inventory_item_id: 'inv-1' },
        ],
      })
    const id = createRes.body.id as string

    const app2 = app
    await request(app2)
      .put(`/api/orders/${id}/status`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'confirmed' })
    await request(app2)
      .put(`/api/orders/${id}/status`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'in_progress' })
    await request(app2)
      .put(`/api/orders/${id}/status`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'ready' })
    const finalRes = await request(app2)
      .put(`/api/orders/${id}/status`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'completed' })

    expect(finalRes.status).toBe(200)
    const item = (store.tables['inventory_items'] as Row[]).find((r) => r['id'] === 'inv-1')
    expect(item?.['quantity']).toBe(7)
  })
})

describe('POST /api/orders/:id/payments', () => {
  it('records a payment and updates payment_status to partial then paid', async () => {
    const token = await makeToken()
    const app = makeApp()
    const createRes = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${token}`)
      .send({
        customer_name: 'Payer Pat',
        line_items: [{ description: 'Meal', quantity: 1, unit_price: 20 }],
      })
    const id = createRes.body.id as string

    const partialRes = await request(app)
      .post(`/api/orders/${id}/payments`)
      .set('Authorization', `Bearer ${token}`)
      .send({ amount: 10, method: 'cash' })
    expect(partialRes.status).toBe(201)
    expect(partialRes.body.order.payment_status).toBe('partial')

    const fullRes = await request(app)
      .post(`/api/orders/${id}/payments`)
      .set('Authorization', `Bearer ${token}`)
      .send({ amount: 10, method: 'card' })
    expect(fullRes.status).toBe(201)
    expect(fullRes.body.order.payment_status).toBe('paid')
    expect(fullRes.body.order.amount_paid).toBe(20)
  })
})

describe('DELETE /api/orders/:id', () => {
  it('soft-deletes a pending order', async () => {
    const token = await makeToken()
    const app = makeApp()
    const createRes = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${token}`)
      .send({
        customer_name: 'Delete Dave',
        line_items: [{ description: 'Muffin', quantity: 1, unit_price: 3 }],
      })
    const id = createRes.body.id as string

    const res = await request(app)
      .delete(`/api/orders/${id}`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
  })

  it('rejects deleting an in-progress order', async () => {
    const token = await makeToken()
    const app = makeApp()
    const createRes = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${token}`)
      .send({
        customer_name: 'Busy Bob',
        line_items: [{ description: 'Muffin', quantity: 1, unit_price: 3 }],
      })
    const id = createRes.body.id as string

    await request(app)
      .put(`/api/orders/${id}/status`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'confirmed' })

    const res = await request(app)
      .delete(`/api/orders/${id}`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(400)
  })
})
