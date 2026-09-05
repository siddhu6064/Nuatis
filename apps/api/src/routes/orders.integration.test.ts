import { jest, describe, it, expect, beforeEach } from '@jest/globals'
import { mintTestToken } from './__test-support__/jwt.js'
import {
  createStore,
  createMockSupabase,
  type MockStore,
  type Row,
} from './__test-support__/supabase-mock.js'

let store: MockStore = createStore()

const sendSms = jest.fn(async () => undefined)

jest.unstable_mockModule('@supabase/supabase-js', () => ({
  createClient: () => createMockSupabase(store),
}))
jest.unstable_mockModule('../lib/sms.js', () => ({ sendSms }))

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

// Sequential, not Promise.all — concurrent dynamic imports that share a
// newly-common dependency (lib/sms.js) can race in Jest's experimental
// VM-modules linker and throw "module ... is not linked".
const { default: express } = await import('express')
const { default: request } = await import('supertest')
const { default: ordersRouter } = await import('./orders.js')

// Fire-and-forget SMS blocks in orders.ts are not awaited by the route
// handler, so the response can return before the mocked sendSms promise
// chain settles. Flush the microtask/timer queue before asserting on it.
async function flush(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve))
}

function makeApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/orders', ordersRouter)
  return app
}

beforeEach(() => {
  store = createStore()
  store.tables['tenants'] = [
    {
      id: TENANT_ID,
      modules: { orders: true },
      order_counter: 1000,
      tax_rate: 0,
      settings: {},
      name: 'Test Cafe',
    },
  ]
  store.tables['orders'] = []
  store.tables['order_line_items'] = []
  store.tables['order_payments'] = []
  store.tables['inventory_items'] = []
  store.tables['locations'] = []
  store.tables['activity_log'] = []
  sendSms.mockClear()
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

describe('PUT /api/orders/:id — error flag', () => {
  it('clears an existing error via { error: null }', async () => {
    const token = await makeToken()
    const app = makeApp()
    const createRes = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${token}`)
      .send({
        customer_name: 'Errored Erin',
        line_items: [{ description: 'Bagel', quantity: 1, unit_price: 3 }],
      })
    const id = createRes.body.id as string
    ;(store.tables['orders'] as Row[]).find((o) => o['id'] === id)!['error'] =
      'Inventory deduction failed on completion — check stock levels manually.'

    const res = await request(app)
      .put(`/api/orders/${id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ error: null })

    expect(res.status).toBe(200)
    expect(res.body.error).toBeNull()
  })

  it('ignores an arbitrary client-supplied error string', async () => {
    const token = await makeToken()
    const app = makeApp()
    const createRes = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${token}`)
      .send({
        customer_name: 'Guarded Gary',
        line_items: [{ description: 'Bagel', quantity: 1, unit_price: 3 }],
      })
    const id = createRes.body.id as string

    const res = await request(app)
      .put(`/api/orders/${id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ error: 'client cannot set this' })

    // Not null and not undefined => the route drops the field entirely, so
    // with no other valid field in the body this is "no valid fields".
    expect(res.status).toBe(400)
  })
})

describe('PUT /api/orders/:id — delivery tracking', () => {
  it('sets tracking fields and fires the tracking SMS once on the null -> set transition', async () => {
    store.tables['locations'] = [
      { id: 'loc-1', tenant_id: TENANT_ID, is_primary: true, telnyx_number: '+15125550100' },
    ]
    const token = await makeToken()
    const app = makeApp()
    const createRes = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${token}`)
      .send({
        customer_name: 'Tracked Tina',
        customer_phone: '+15125550001',
        fulfillment_type: 'delivery',
        line_items: [{ description: 'Package', quantity: 1, unit_price: 20 }],
      })
    const id = createRes.body.id as string

    const res = await request(app)
      .put(`/api/orders/${id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ tracking_carrier: 'UPS', tracking_number: '1Z999AA1' })
    await flush()

    expect(res.status).toBe(200)
    expect(res.body.tracking_carrier).toBe('UPS')
    expect(res.body.tracking_number).toBe('1Z999AA1')
    expect(sendSms).toHaveBeenCalledTimes(1)
    const [, toNumber, text] = sendSms.mock.calls[0] as unknown as [string, string, string]
    expect(toNumber).toBe('+15125550001')
    expect(text).toContain('1Z999AA1')
  })

  it('does not re-fire the tracking SMS on a later update to an already-set tracking number', async () => {
    store.tables['locations'] = [
      { id: 'loc-1', tenant_id: TENANT_ID, is_primary: true, telnyx_number: '+15125550100' },
    ]
    const token = await makeToken()
    const app = makeApp()
    const createRes = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${token}`)
      .send({
        customer_name: 'Retracked Rae',
        customer_phone: '+15125550002',
        fulfillment_type: 'delivery',
        line_items: [{ description: 'Package', quantity: 1, unit_price: 20 }],
      })
    const id = createRes.body.id as string

    await request(app)
      .put(`/api/orders/${id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ tracking_carrier: 'UPS', tracking_number: '1Z999AA1' })
    await flush()
    expect(sendSms).toHaveBeenCalledTimes(1)

    const res = await request(app)
      .put(`/api/orders/${id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ tracking_number: '1Z999AA2' })
    await flush()

    expect(res.status).toBe(200)
    expect(res.body.tracking_number).toBe('1Z999AA2')
    expect(sendSms).toHaveBeenCalledTimes(1)
  })
})

describe('PUT /api/orders/:id — metadata', () => {
  it('shallow-merges metadata across successive updates without dropping prior keys', async () => {
    const token = await makeToken()
    const app = makeApp()
    const createRes = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${token}`)
      .send({
        customer_name: 'Meta Mia',
        line_items: [{ description: 'Bagel', quantity: 1, unit_price: 3 }],
        metadata: { source_channel: 'phone' },
      })
    const id = createRes.body.id as string
    expect(createRes.body.metadata).toEqual({ source_channel: 'phone' })

    const firstMerge = await request(app)
      .put(`/api/orders/${id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ metadata: { gift_wrap: true } })
    expect(firstMerge.status).toBe(200)
    expect(firstMerge.body.metadata).toEqual({ source_channel: 'phone', gift_wrap: true })

    const secondMerge = await request(app)
      .put(`/api/orders/${id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ metadata: { source_channel: 'web' } })
    expect(secondMerge.status).toBe(200)
    expect(secondMerge.body.metadata).toEqual({ source_channel: 'web', gift_wrap: true })
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

describe('Multi-location', () => {
  it('stores location_id on create and filters GET / by it', async () => {
    const app = makeApp()
    const token = await makeToken()

    await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${token}`)
      .send({
        customer_name: 'Location A',
        location_id: 'loc-a',
        line_items: [{ description: 'Coffee', quantity: 1, unit_price: 3 }],
      })
    await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${token}`)
      .send({
        customer_name: 'Location B',
        location_id: 'loc-b',
        line_items: [{ description: 'Tea', quantity: 1, unit_price: 3 }],
      })

    const filtered = await request(app)
      .get('/api/orders?location_id=loc-a')
      .set('Authorization', `Bearer ${token}`)

    expect(filtered.status).toBe(200)
    const names = (filtered.body.data as Row[]).map((o) => o['customer_name'] as string)
    expect(names).toEqual(['Location A'])
  })
})
