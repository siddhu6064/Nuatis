import { jest, describe, it, expect, beforeEach } from '@jest/globals'
import { mintTestToken } from './__test-support__/jwt.js'
import {
  createStore,
  createMockSupabase,
  type MockStore,
} from './__test-support__/supabase-mock.js'

// Shared mock store — reset before each test for isolation.
let store: MockStore = createStore()

jest.unstable_mockModule('@supabase/supabase-js', () => ({
  createClient: () => createMockSupabase(store),
}))

const TENANT_ID = 'aaaaaaaa-0000-0000-0000-000000000001'
const USER_ID = 'user-inv-001'
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

// Dynamic imports — must happen AFTER jest.unstable_mockModule above.
const [{ default: express }, { default: request }, { default: inventoryRouter }] =
  await Promise.all([import('express'), import('supertest'), import('./inventory.js')])

function makeApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/inventory', inventoryRouter)
  return app
}

beforeEach(() => {
  // Reset the in-memory store; seed tenant with crm module enabled so
  // requireCrm middleware passes.
  store = createStore()
  store.tables['tenants'] = [{ id: TENANT_ID, modules: { crm: true } }]
  store.tables['inventory_items'] = []
  store.tables['activity_log'] = []
  // Also patch the mockClient factory so subsequent createClient() calls
  // return a client bound to the NEW store. (unstable_mockModule closes over
  // the `store` let-binding which we reassigned above.)
})

describe('POST /api/inventory', () => {
  it('creates an item and returns 201 with id', async () => {
    const token = await makeToken()
    const res = await request(makeApp())
      .post('/api/inventory')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Test Gloves', quantity: 10 })

    expect(res.status).toBe(201)
    expect(res.body.id).toBeDefined()
    expect(res.body.name).toBe('Test Gloves')
  })

  it('returns 400 when name is missing', async () => {
    const token = await makeToken()
    const res = await request(makeApp())
      .post('/api/inventory')
      .set('Authorization', `Bearer ${token}`)
      .send({ quantity: 10 })

    expect(res.status).toBe(400)
    expect(res.body.error).toBeDefined()
  })
})

describe('GET /api/inventory — vertical filtering', () => {
  it('returns only items matching the tenant vertical or items with no vertical set', async () => {
    const token = await makeToken()
    // Tenant vertical drives the filter, not the JWT
    store.tables['tenants'] = [{ id: TENANT_ID, modules: { crm: true }, vertical: 'dental' }]
    store.tables['inventory_items'] = [
      {
        id: 'inv-dental',
        tenant_id: TENANT_ID,
        name: 'Dental Gloves',
        vertical: 'dental',
        deleted_at: null,
        quantity: 10,
        reorder_threshold: 5,
      },
      {
        id: 'inv-salon',
        tenant_id: TENANT_ID,
        name: 'Hair Color',
        vertical: 'salon',
        deleted_at: null,
        quantity: 5,
        reorder_threshold: 2,
      },
      {
        id: 'inv-legacy',
        tenant_id: TENANT_ID,
        name: 'Copy Paper',
        vertical: null,
        deleted_at: null,
        quantity: 20,
        reorder_threshold: 5,
      },
    ]

    const res = await request(makeApp())
      .get('/api/inventory')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    const ids = (res.body.data as Array<{ id: string }>).map((r) => r.id)
    expect(ids).toContain('inv-dental')
    expect(ids).toContain('inv-legacy')
    expect(ids).not.toContain('inv-salon')
  })

  it('returns all items when tenant has no vertical set', async () => {
    const noVerticalToken = await mintTestToken(
      { sub: USER_ID, tenantId: TENANT_ID, role: 'owner' },
      { secret: SECRET }
    )
    // tenant row has no vertical — beforeEach seeds it without one

    store.tables['inventory_items'] = [
      {
        id: 'inv-dental',
        tenant_id: TENANT_ID,
        name: 'Dental Gloves',
        vertical: 'dental',
        deleted_at: null,
        quantity: 10,
        reorder_threshold: 5,
      },
      {
        id: 'inv-salon',
        tenant_id: TENANT_ID,
        name: 'Hair Color',
        vertical: 'salon',
        deleted_at: null,
        quantity: 5,
        reorder_threshold: 2,
      },
    ]

    const res = await request(makeApp())
      .get('/api/inventory')
      .set('Authorization', `Bearer ${noVerticalToken}`)

    expect(res.status).toBe(200)
    const ids = (res.body.data as Array<{ id: string }>).map((r) => r.id)
    expect(ids).toContain('inv-dental')
    expect(ids).toContain('inv-salon')
  })
})

describe('POST /api/inventory/:id/adjust', () => {
  it('positive delta increases quantity', async () => {
    const token = await makeToken()
    const app = makeApp()

    const createRes = await request(app)
      .post('/api/inventory')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Bandages', quantity: 10 })
    expect(createRes.status).toBe(201)
    const id = createRes.body.id as string

    const adjustRes = await request(app)
      .post(`/api/inventory/${id}/adjust`)
      .set('Authorization', `Bearer ${token}`)
      .send({ delta: 5, reason: 'restock' })

    expect(adjustRes.status).toBe(200)
    expect(adjustRes.body.quantity).toBe(15)
  })

  it('negative delta larger than stock clamps at 0', async () => {
    const token = await makeToken()
    const app = makeApp()

    const createRes = await request(app)
      .post('/api/inventory')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Syringes', quantity: 3 })
    const id = createRes.body.id as string

    const adjustRes = await request(app)
      .post(`/api/inventory/${id}/adjust`)
      .set('Authorization', `Bearer ${token}`)
      .send({ delta: -10, reason: 'used' })

    expect(adjustRes.status).toBe(200)
    expect(adjustRes.body.quantity).toBe(0)
  })
})

describe('GET /api/inventory — location_id filter', () => {
  it('filters to items tagged with the given location', async () => {
    store.tables['inventory_items'] = [
      {
        id: 'i1',
        tenant_id: TENANT_ID,
        name: 'Downtown Widget',
        location_id: 'loc-1',
        is_active: true,
      },
      {
        id: 'i2',
        tenant_id: TENANT_ID,
        name: 'Uptown Widget',
        location_id: 'loc-2',
        is_active: true,
      },
      { id: 'i3', tenant_id: TENANT_ID, name: 'Shared Widget', location_id: null, is_active: true },
    ]
    const token = await makeToken()
    const res = await request(makeApp())
      .get('/api/inventory?location_id=loc-1')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    const ids = (res.body.data as Array<{ id: string }>).map((r) => r.id)
    expect(ids).toEqual(['i1'])
  })

  it('omitting location_id returns items across all locations', async () => {
    store.tables['inventory_items'] = [
      { id: 'i1', tenant_id: TENANT_ID, name: 'A', location_id: 'loc-1' },
      { id: 'i2', tenant_id: TENANT_ID, name: 'B', location_id: 'loc-2' },
    ]
    const token = await makeToken()
    const res = await request(makeApp())
      .get('/api/inventory')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.data).toHaveLength(2)
  })
})

describe('POST /api/inventory — location_id', () => {
  it('stores an optional location_id', async () => {
    const token = await makeToken()
    const res = await request(makeApp())
      .post('/api/inventory')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Location Widget', quantity: 5, location_id: 'loc-1' })

    expect(res.status).toBe(201)
    expect(res.body.location_id).toBe('loc-1')
  })
})

describe('POST /api/inventory — barcode', () => {
  it('stores an optional barcode', async () => {
    const token = await makeToken()
    const res = await request(makeApp())
      .post('/api/inventory')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Barcoded Widget', quantity: 5, barcode: '012345678905' })

    expect(res.status).toBe(201)
    expect(res.body.barcode).toBe('012345678905')
  })
})

describe('GET /api/inventory/barcode/:code', () => {
  it('resolves an item by its barcode', async () => {
    store.tables['inventory_items'] = [
      {
        id: 'i1',
        tenant_id: TENANT_ID,
        name: 'Scanner Widget',
        barcode: 'BC-100',
        deleted_at: null,
      },
    ]
    const token = await makeToken()
    const res = await request(makeApp())
      .get('/api/inventory/barcode/BC-100')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.id).toBe('i1')
  })

  it('404s when no item has that barcode', async () => {
    const token = await makeToken()
    const res = await request(makeApp())
      .get('/api/inventory/barcode/NOPE')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(404)
  })

  it('does not resolve a barcode belonging to another tenant', async () => {
    store.tables['inventory_items'] = [
      {
        id: 'i-other',
        tenant_id: 'other-tenant',
        name: 'Other Tenant Widget',
        barcode: 'BC-200',
        deleted_at: null,
      },
    ]
    const token = await makeToken()
    const res = await request(makeApp())
      .get('/api/inventory/barcode/BC-200')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(404)
  })
})

describe('GET /api/inventory/:id/movements', () => {
  it('returns the item’s adjustment history, newest first', async () => {
    const token = await makeToken()
    const app = makeApp()

    const createRes = await request(app)
      .post('/api/inventory')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Ledger Widget', quantity: 10 })
    const id = createRes.body.id as string

    await request(app)
      .post(`/api/inventory/${id}/adjust`)
      .set('Authorization', `Bearer ${token}`)
      .send({ delta: 5, reason: 'restock' })
    await request(app)
      .post(`/api/inventory/${id}/adjust`)
      .set('Authorization', `Bearer ${token}`)
      .send({ delta: -2, reason: 'used' })

    const res = await request(app)
      .get(`/api/inventory/${id}/movements`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.movements).toHaveLength(2)
    expect(res.body.movements[0].metadata.delta).toBe(-2)
    expect(res.body.movements[0].metadata.reason).toBe('used')
    expect(res.body.movements[1].metadata.delta).toBe(5)
  })

  it('404s for an item that does not belong to the tenant', async () => {
    store.tables['inventory_items'] = [
      { id: 'i-other', tenant_id: 'other-tenant', name: 'Other Widget', deleted_at: null },
    ]
    const token = await makeToken()
    const res = await request(makeApp())
      .get('/api/inventory/i-other/movements')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(404)
  })

  it('does not include a different item’s movements', async () => {
    const token = await makeToken()
    const app = makeApp()

    const a = (
      await request(app)
        .post('/api/inventory')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Widget A', quantity: 10 })
    ).body.id as string
    const b = (
      await request(app)
        .post('/api/inventory')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Widget B', quantity: 10 })
    ).body.id as string

    await request(app)
      .post(`/api/inventory/${a}/adjust`)
      .set('Authorization', `Bearer ${token}`)
      .send({ delta: 1, reason: 'a-only' })

    const res = await request(app)
      .get(`/api/inventory/${b}/movements`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.movements).toHaveLength(0)
  })
})
