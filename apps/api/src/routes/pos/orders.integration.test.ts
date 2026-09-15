import { jest, describe, it, expect, beforeEach } from '@jest/globals'
import { mintTestToken } from '../__test-support__/jwt.js'
import {
  createStore,
  createMockSupabase,
  type MockStore,
} from '../__test-support__/supabase-mock.js'
import { seedEntitledTenant } from '../__test-support__/tenant-fixture.js'

let store: MockStore = createStore()

jest.unstable_mockModule('@supabase/supabase-js', () => ({
  createClient: () => createMockSupabase(store),
}))

const TENANT_ID = 'aaaaaaaa-0000-0000-0000-00000ord0001'
const OTHER_TENANT_ID = 'aaaaaaaa-0000-0000-0000-00000ord0002'
const LOCATION_ID = 'bbbbbbbb-0000-0000-0000-00000loc0001'
const USER_ID = 'user-ord-001'
const SECRET = process.env['AUTH_SECRET'] ?? 'test-secret-for-unit-tests-only-32ch'
process.env['AUTH_SECRET'] = SECRET
process.env['SUPABASE_URL'] = 'https://mock.supabase.co'
process.env['SUPABASE_SERVICE_ROLE_KEY'] = 'mock-service-key'

async function makeToken(extra: Record<string, unknown> = {}): Promise<string> {
  return mintTestToken(
    { sub: USER_ID, tenantId: TENANT_ID, role: 'owner', vertical: 'restaurant', ...extra },
    { secret: SECRET }
  )
}

const { default: express } = await import('express')
const { default: request } = await import('supertest')
const { default: ordersRouter } = await import('./orders.js')

function makeApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/pos/orders', ordersRouter)
  return app
}

function post(body: unknown, token: string) {
  return request(makeApp())
    .post('/api/pos/orders')
    .set('Authorization', `Bearer ${token}`)
    .send(body as object)
}

beforeEach(() => {
  store = createStore()
  // 8.75% tax, so a rounding mistake shows up rather than cancelling out.
  seedEntitledTenant(store, TENANT_ID, {
    modules: { pos: true },
    tax_rate: '8.75',
    order_counter: 1000,
  })
  store.tables['locations'] = [{ id: LOCATION_ID, tenant_id: TENANT_ID, name: 'Demo Location' }]
  store.tables['menu_items'] = [
    {
      id: 'item-burger',
      tenant_id: TENANT_ID,
      category_id: 'cat-1',
      name: 'Burger',
      price: '12.00',
      taxable: true,
      kitchen_station: 'grill',
      deleted_at: null,
    },
    {
      id: 'item-water',
      tenant_id: TENANT_ID,
      category_id: 'cat-1',
      name: 'Bottled Water',
      price: '2.00',
      taxable: false,
      kitchen_station: null,
      deleted_at: null,
    },
  ]
  store.tables['modifier_groups'] = [
    { id: 'grp-cheese', tenant_id: TENANT_ID, name: 'Cheese', deleted_at: null },
  ]
  store.tables['modifier_options'] = [
    {
      id: 'opt-cheddar',
      tenant_id: TENANT_ID,
      group_id: 'grp-cheese',
      name: 'Cheddar',
      price_delta: '1.50',
      deleted_at: null,
    },
  ]
  store.tables['menu_item_modifier_groups'] = [
    { tenant_id: TENANT_ID, item_id: 'item-burger', group_id: 'grp-cheese', sort_order: 0 },
  ]
  store.tables['orders'] = []
  store.tables['order_line_items'] = []
  store.tables['order_payments'] = []
})

describe('POST /api/pos/orders', () => {
  it("stamps source 'pos' — the value migration 0195 widened the constraint for", async () => {
    const res = await post(
      { location_id: LOCATION_ID, lines: [{ menu_item_id: 'item-burger', quantity: 1 }] },
      await makeToken()
    )

    expect(res.status).toBe(201)
    expect(res.body.source).toBe('pos')
    expect(store.tables['orders']![0]!['source']).toBe('pos')
  })

  it('carries a location_id, without which the ticket router cannot fire it', async () => {
    const res = await post(
      { location_id: LOCATION_ID, lines: [{ menu_item_id: 'item-burger', quantity: 1 }] },
      await makeToken()
    )

    expect(res.status).toBe(201)
    expect(res.body.location_id).toBe(LOCATION_ID)
  })

  it('writes menu_item_id and a modifiers snapshot on every line', async () => {
    const res = await post(
      {
        location_id: LOCATION_ID,
        lines: [{ menu_item_id: 'item-burger', quantity: 1, option_ids: ['opt-cheddar'] }],
      },
      await makeToken()
    )

    expect(res.status).toBe(201)
    const line = store.tables['order_line_items']![0]!
    expect(line['menu_item_id']).toBe('item-burger')
    expect(line['modifiers']).toEqual([
      { option_id: 'opt-cheddar', option_name: 'Cheddar', price_delta: '1.50' },
    ])
  })

  it('folds modifier deltas into unit_price, because line total is a generated column', async () => {
    await post(
      {
        location_id: LOCATION_ID,
        lines: [{ menu_item_id: 'item-burger', quantity: 2, option_ids: ['opt-cheddar'] }],
      },
      await makeToken()
    )

    // 12.00 + 1.50 = 13.50, so the generated quantity * unit_price is 27.00.
    expect(store.tables['order_line_items']![0]!['unit_price']).toBe(13.5)
    expect(store.tables['orders']![0]!['subtotal']).toBe(27)
  })

  it('prices from the menu, ignoring any price in the request body', async () => {
    await post(
      {
        location_id: LOCATION_ID,
        lines: [{ menu_item_id: 'item-burger', quantity: 1, unit_price: 0.01, price: 0.01 }],
      },
      await makeToken()
    )

    expect(store.tables['order_line_items']![0]!['unit_price']).toBe(12)
    expect(store.tables['orders']![0]!['total']).toBe(13.05)
  })

  it('taxes only the taxable base, rounding once on the sum', async () => {
    await post(
      {
        location_id: LOCATION_ID,
        lines: [
          { menu_item_id: 'item-burger', quantity: 1 },
          { menu_item_id: 'item-water', quantity: 1 },
        ],
      },
      await makeToken()
    )

    const order = store.tables['orders']![0]!
    expect(order['subtotal']).toBe(14)
    // 8.75% of the burger alone: 1200 * 875 / 10000 = 105 cents. The water is
    // not taxable, and taxing the full 14.00 would give 1.23.
    expect(order['tax_amount']).toBe(1.05)
    expect(order['total']).toBe(15.05)
  })

  it('adds the tip to the total but never to the tax base', async () => {
    await post(
      {
        location_id: LOCATION_ID,
        lines: [{ menu_item_id: 'item-burger', quantity: 1 }],
        tip_amount: 3,
      },
      await makeToken()
    )

    const order = store.tables['orders']![0]!
    expect(order['tax_amount']).toBe(1.05)
    expect(order['tip_amount']).toBe(3)
    expect(order['total']).toBe(16.05)
  })

  it('records one payment row per tender leg', async () => {
    await post(
      {
        location_id: LOCATION_ID,
        lines: [{ menu_item_id: 'item-burger', quantity: 1 }],
        payments: [
          { method: 'card', amount: 10 },
          { method: 'cash', amount: 3.05 },
        ],
      },
      await makeToken()
    )

    const payments = store.tables['order_payments'] ?? []
    expect(payments).toHaveLength(2)
    expect(payments.map((p) => p['method']).sort()).toEqual(['card', 'cash'])
    expect(store.tables['orders']![0]!['payment_status']).toBe('paid')
  })

  it('caps amount_paid at the total, so change given is not booked as revenue', async () => {
    await post(
      {
        location_id: LOCATION_ID,
        lines: [{ menu_item_id: 'item-burger', quantity: 1 }],
        payments: [{ method: 'cash', amount: 20 }],
      },
      await makeToken()
    )

    const order = store.tables['orders']![0]!
    // A $20 note against a $13.05 ticket pays $13.05; the rest is change.
    expect(order['total']).toBe(13.05)
    expect(order['amount_paid']).toBe(13.05)
    expect(order['payment_status']).toBe('paid')
  })

  it('marks a part-paid order partial rather than paid', async () => {
    await post(
      {
        location_id: LOCATION_ID,
        lines: [{ menu_item_id: 'item-burger', quantity: 1 }],
        payments: [{ method: 'card', amount: 5 }],
      },
      await makeToken()
    )

    expect(store.tables['orders']![0]!['payment_status']).toBe('partial')
  })

  it('rejects a location belonging to another tenant', async () => {
    store.tables['locations'] = [{ id: LOCATION_ID, tenant_id: OTHER_TENANT_ID, name: 'Theirs' }]

    const res = await post(
      { location_id: LOCATION_ID, lines: [{ menu_item_id: 'item-burger', quantity: 1 }] },
      await makeToken()
    )

    expect(res.status).toBe(404)
    expect(store.tables['orders']).toHaveLength(0)
  })

  it('rejects a menu item belonging to another tenant', async () => {
    store.tables['menu_items']!.push({
      id: 'item-foreign',
      tenant_id: OTHER_TENANT_ID,
      category_id: 'cat-x',
      name: 'Their Steak',
      price: '40.00',
      taxable: true,
      kitchen_station: 'grill',
      deleted_at: null,
    })

    const res = await post(
      { location_id: LOCATION_ID, lines: [{ menu_item_id: 'item-foreign', quantity: 1 }] },
      await makeToken()
    )

    expect(res.status).toBe(400)
    expect(store.tables['orders']).toHaveLength(0)
  })

  it('rejects an option that the item does not offer', async () => {
    store.tables['modifier_groups']!.push({
      id: 'grp-syrup',
      tenant_id: TENANT_ID,
      name: 'Syrup',
      deleted_at: null,
    })
    store.tables['modifier_options']!.push({
      id: 'opt-vanilla',
      tenant_id: TENANT_ID,
      group_id: 'grp-syrup',
      name: 'Vanilla',
      price_delta: '0.00',
      deleted_at: null,
    })

    const res = await post(
      {
        location_id: LOCATION_ID,
        lines: [{ menu_item_id: 'item-burger', quantity: 1, option_ids: ['opt-vanilla'] }],
      },
      await makeToken()
    )

    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/not offered/)
    expect(store.tables['orders']).toHaveLength(0)
  })

  it('requires a location_id', async () => {
    const res = await post(
      { lines: [{ menu_item_id: 'item-burger', quantity: 1 }] },
      await makeToken()
    )
    expect(res.status).toBe(400)
  })

  it('rejects an empty or fractional-quantity order', async () => {
    const token = await makeToken()
    expect((await post({ location_id: LOCATION_ID, lines: [] }, token)).status).toBe(400)
    expect(
      (
        await post(
          { location_id: LOCATION_ID, lines: [{ menu_item_id: 'item-burger', quantity: 1.5 }] },
          token
        )
      ).status
    ).toBe(400)
    expect(
      (
        await post(
          { location_id: LOCATION_ID, lines: [{ menu_item_id: 'item-burger', quantity: -1 }] },
          token
        )
      ).status
    ).toBe(400)
  })

  it('rejects an unknown tender method', async () => {
    const res = await post(
      {
        location_id: LOCATION_ID,
        lines: [{ menu_item_id: 'item-burger', quantity: 1 }],
        payments: [{ method: 'crypto', amount: 13.05 }],
      },
      await makeToken()
    )
    expect(res.status).toBe(400)
  })

  it('is reachable by a pos-scoped token', async () => {
    const res = await post(
      { location_id: LOCATION_ID, lines: [{ menu_item_id: 'item-burger', quantity: 1 }] },
      await makeToken({ portalScope: 'pos' })
    )
    expect(res.status).toBe(201)
  })

  it('refuses a tenant without the POS module', async () => {
    seedEntitledTenant(store, TENANT_ID, { modules: { pos: false }, tax_rate: '8.75' })

    const res = await post(
      { location_id: LOCATION_ID, lines: [{ menu_item_id: 'item-burger', quantity: 1 }] },
      await makeToken()
    )
    expect(res.status).toBe(403)
  })
})
