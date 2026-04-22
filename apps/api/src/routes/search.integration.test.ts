import { jest, describe, it, expect, beforeEach } from '@jest/globals'
import { SignJWT } from 'jose'
import {
  createStore,
  createMockSupabase,
  type MockStore,
} from './__test-support__/supabase-mock.js'

let store: MockStore = createStore()

jest.unstable_mockModule('@supabase/supabase-js', () => ({
  createClient: () => createMockSupabase(store),
}))

const TENANT_ID = 'aaaaaaaa-0000-0000-0000-00000sr00001'
const USER_ID = 'user-sr-001'
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

const [{ default: express }, { default: request }, { default: searchRouter }] = await Promise.all([
  import('express'),
  import('supertest'),
  import('./search.js'),
])

function makeApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/search', searchRouter)
  return app
}

beforeEach(() => {
  store = createStore()
  store.tables['contacts'] = []
  store.tables['appointments'] = []
  store.tables['quotes'] = []
  store.tables['inventory_items'] = []
})

describe('GET /api/search', () => {
  it('returns envelope with 5 top-level keys', async () => {
    store.tables['tenants'] = [{ id: TENANT_ID, modules: { crm: true } }]
    const token = await makeToken()
    const res = await request(makeApp())
      .get('/api/search?q=test')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(Array.isArray(res.body.contacts)).toBe(true)
    expect(Array.isArray(res.body.appointments)).toBe(true)
    expect(Array.isArray(res.body.quotes)).toBe(true)
    expect(Array.isArray(res.body.inventory)).toBe(true)
    expect(typeof res.body.total).toBe('number')
  })

  it('returns 400 when query is less than 2 characters', async () => {
    store.tables['tenants'] = [{ id: TENANT_ID, modules: { crm: true } }]
    const token = await makeToken()
    const res = await request(makeApp())
      .get('/api/search?q=a')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(400)
    expect(res.body.error).toBe('q must be at least 2 characters')
  })

  it('returns empty inventory array when modules.crm is false', async () => {
    store.tables['tenants'] = [{ id: TENANT_ID, modules: { crm: false } }]
    const token = await makeToken()
    const res = await request(makeApp())
      .get('/api/search?q=test')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.inventory.length).toBe(0)
  })
})
