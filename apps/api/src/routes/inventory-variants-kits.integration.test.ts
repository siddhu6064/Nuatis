import { jest, describe, it, expect, beforeEach } from '@jest/globals'
import { mintTestToken } from './__test-support__/jwt.js'
import { randomUUID } from 'node:crypto'
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

const TENANT_ID = 'aaaaaaaa-0000-0000-0000-00000ivk0001'
const USER_ID = 'user-ivk-001'
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

const [{ default: express }, { default: request }, { default: inventoryRouter }] =
  await Promise.all([import('express'), import('supertest'), import('./inventory.js')])

function makeApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/inventory', inventoryRouter)
  return app
}

beforeEach(() => {
  store = createStore()
  store.tables['tenants'] = [{ id: TENANT_ID, modules: { crm: true } }]
  store.tables['inventory_items'] = []
  store.tables['inventory_kit_components'] = []
  store.tables['activity_log'] = []
})

function seedItem(overrides: Row = {}): Row {
  const row: Row = {
    id: randomUUID(),
    tenant_id: TENANT_ID,
    name: 'Item',
    quantity: 10,
    reorder_threshold: 5,
    unit: 'each',
    deleted_at: null,
    parent_item_id: null,
    variant_label: null,
    ...overrides,
  }
  ;(store.tables['inventory_items'] as Row[]).push(row)
  return row
}

describe('Inventory variants — POST /api/inventory with parent_item_id', () => {
  it('creates a variant under an existing parent', async () => {
    const parent = seedItem({ name: 'T-Shirt' })
    const token = await makeToken()

    const res = await request(makeApp())
      .post('/api/inventory')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'T-Shirt — Large',
        quantity: 5,
        parent_item_id: parent.id,
        variant_label: 'Large',
      })

    expect(res.status).toBe(201)
    expect(res.body.parent_item_id).toBe(parent.id)
    expect(res.body.variant_label).toBe('Large')
  })

  it('rejects a variant with no variant_label', async () => {
    const parent = seedItem({ name: 'T-Shirt' })
    const token = await makeToken()

    const res = await request(makeApp())
      .post('/api/inventory')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'T-Shirt — Large', quantity: 5, parent_item_id: parent.id })

    expect(res.status).toBe(400)
    expect(res.body.error).toContain('variant_label')
  })

  it('rejects a nonexistent parent_item_id', async () => {
    const token = await makeToken()
    const res = await request(makeApp())
      .post('/api/inventory')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'X', quantity: 1, parent_item_id: randomUUID(), variant_label: 'Large' })

    expect(res.status).toBe(400)
    expect(res.body.error).toContain('does not reference')
  })

  it('rejects nested variants (parent already has a parent)', async () => {
    const grandparent = seedItem({ name: 'Base' })
    const parent = seedItem({
      name: 'Variant of Base',
      parent_item_id: grandparent.id,
      variant_label: 'Medium',
    })
    const token = await makeToken()

    const res = await request(makeApp())
      .post('/api/inventory')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Y', quantity: 1, parent_item_id: parent.id, variant_label: 'Small' })

    expect(res.status).toBe(400)
    expect(res.body.error).toContain('nested')
  })

  it('rejects a variant whose parent is a kit', async () => {
    const kit = seedItem({ name: 'Gift Basket' })
    ;(store.tables['inventory_kit_components'] as Row[]).push({
      id: randomUUID(),
      tenant_id: TENANT_ID,
      kit_item_id: kit.id,
      component_item_id: seedItem({ name: 'Candle' }).id,
      quantity: 1,
    })
    const token = await makeToken()

    const res = await request(makeApp())
      .post('/api/inventory')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Basket Variant', quantity: 1, parent_item_id: kit.id, variant_label: 'Small' })

    expect(res.status).toBe(400)
    expect(res.body.error).toContain('kit')
  })
})

describe('GET /api/inventory/:id/variants', () => {
  it('lists variants of a parent item', async () => {
    const parent = seedItem({ name: 'Mug' })
    seedItem({ name: 'Mug — Red', parent_item_id: parent.id, variant_label: 'Red' })
    seedItem({ name: 'Mug — Blue', parent_item_id: parent.id, variant_label: 'Blue' })
    seedItem({ name: 'Unrelated' })
    const token = await makeToken()

    const res = await request(makeApp())
      .get(`/api/inventory/${parent.id}/variants`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.variants).toHaveLength(2)
  })
})

describe('PUT /api/inventory/:id/kit-components', () => {
  it('saves a kit recipe', async () => {
    const kit = seedItem({ name: 'Gift Basket', quantity: 0 })
    const candle = seedItem({ name: 'Candle', quantity: 20 })
    const soap = seedItem({ name: 'Soap', quantity: 15 })
    const token = await makeToken()

    const res = await request(makeApp())
      .put(`/api/inventory/${kit.id}/kit-components`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        components: [
          { component_item_id: candle.id, quantity: 2 },
          { component_item_id: soap.id, quantity: 1 },
        ],
      })

    expect(res.status).toBe(200)
    expect(res.body.components).toHaveLength(2)
  })

  it('rejects a component that does not exist', async () => {
    const kit = seedItem({ name: 'Gift Basket' })
    const token = await makeToken()

    const res = await request(makeApp())
      .put(`/api/inventory/${kit.id}/kit-components`)
      .set('Authorization', `Bearer ${token}`)
      .send({ components: [{ component_item_id: randomUUID(), quantity: 1 }] })

    expect(res.status).toBe(400)
    expect(res.body.error).toContain('Unknown component')
  })

  it('rejects a kit containing itself as a component', async () => {
    const kit = seedItem({ name: 'Gift Basket' })
    const token = await makeToken()

    const res = await request(makeApp())
      .put(`/api/inventory/${kit.id}/kit-components`)
      .set('Authorization', `Bearer ${token}`)
      .send({ components: [{ component_item_id: kit.id, quantity: 1 }] })

    expect(res.status).toBe(400)
    expect(res.body.error).toContain('cannot contain itself')
  })

  it('rejects setting kit components on a variant', async () => {
    const parent = seedItem({ name: 'Base' })
    const variant = seedItem({ name: 'Variant', parent_item_id: parent.id, variant_label: 'A' })
    const other = seedItem({ name: 'Other' })
    const token = await makeToken()

    const res = await request(makeApp())
      .put(`/api/inventory/${variant.id}/kit-components`)
      .set('Authorization', `Bearer ${token}`)
      .send({ components: [{ component_item_id: other.id, quantity: 1 }] })

    expect(res.status).toBe(400)
    expect(res.body.error).toContain('variant')
  })
})

describe('POST /api/inventory/:id/build', () => {
  it('builds N kits, decrements components, increments kit quantity', async () => {
    const kit = seedItem({ name: 'Gift Basket', quantity: 0 })
    const candle = seedItem({ name: 'Candle', quantity: 20 })
    const soap = seedItem({ name: 'Soap', quantity: 15 })
    ;(store.tables['inventory_kit_components'] as Row[]).push(
      {
        id: randomUUID(),
        tenant_id: TENANT_ID,
        kit_item_id: kit.id,
        component_item_id: candle.id,
        quantity: 2,
      },
      {
        id: randomUUID(),
        tenant_id: TENANT_ID,
        kit_item_id: kit.id,
        component_item_id: soap.id,
        quantity: 1,
      }
    )
    const token = await makeToken()

    const res = await request(makeApp())
      .post(`/api/inventory/${kit.id}/build`)
      .set('Authorization', `Bearer ${token}`)
      .send({ quantity: 3 })

    expect(res.status).toBe(200)
    expect(res.body.quantity).toBe(3)

    const items = store.tables['inventory_items'] as Row[]
    expect(items.find((i) => i['id'] === candle.id)?.['quantity']).toBe(14) // 20 - 2*3
    expect(items.find((i) => i['id'] === soap.id)?.['quantity']).toBe(12) // 15 - 1*3

    const logs = (store.tables['activity_log'] as Row[]).filter(
      (a) => a['type'] === 'inventory_adjust'
    )
    expect(logs).toHaveLength(3) // candle + soap + kit itself
  })

  it('rejects the build all-or-nothing when a component is short', async () => {
    const kit = seedItem({ name: 'Gift Basket', quantity: 0 })
    const candle = seedItem({ name: 'Candle', quantity: 1 })
    ;(store.tables['inventory_kit_components'] as Row[]).push({
      id: randomUUID(),
      tenant_id: TENANT_ID,
      kit_item_id: kit.id,
      component_item_id: candle.id,
      quantity: 2,
    })
    const token = await makeToken()

    const res = await request(makeApp())
      .post(`/api/inventory/${kit.id}/build`)
      .set('Authorization', `Bearer ${token}`)
      .send({ quantity: 1 })

    expect(res.status).toBe(400)
    expect(res.body.error).toContain('Not enough stock')

    const items = store.tables['inventory_items'] as Row[]
    expect(items.find((i) => i['id'] === candle.id)?.['quantity']).toBe(1) // untouched
  })

  it('rejects building an item with no kit components defined', async () => {
    const item = seedItem({ name: 'Plain Item' })
    const token = await makeToken()

    const res = await request(makeApp())
      .post(`/api/inventory/${item.id}/build`)
      .set('Authorization', `Bearer ${token}`)
      .send({ quantity: 1 })

    expect(res.status).toBe(400)
    expect(res.body.error).toContain('no kit components')
  })
})
