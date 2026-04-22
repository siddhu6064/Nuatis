import { jest, describe, it, expect, beforeEach } from '@jest/globals'
import { SignJWT } from 'jose'
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
  const secretBytes = new TextEncoder().encode(SECRET)
  return new SignJWT({ sub: USER_ID, tenantId: TENANT_ID, role: 'owner', vertical: 'dental' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(secretBytes)
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
