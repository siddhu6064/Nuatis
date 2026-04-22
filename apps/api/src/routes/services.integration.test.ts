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

const TENANT_ID = 'aaaaaaaa-0000-0000-0000-00000000svc1'
const USER_ID = 'user-svc-001'
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

const [{ default: express }, { default: request }, { default: servicesRouter }] = await Promise.all(
  [import('express'), import('supertest'), import('./services.js')]
)

function makeApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/services', servicesRouter)
  return app
}

beforeEach(() => {
  store = createStore()
  store.tables['tenants'] = [{ id: TENANT_ID, modules: { crm: true, cpq: true } }]
  store.tables['services'] = []
})

describe('GET /api/services', () => {
  it('returns 200 with empty array for tenant with no services', async () => {
    const token = await makeToken()
    const res = await request(makeApp())
      .get('/api/services')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.services).toEqual([])
  })

  it('returns 401 without auth token', async () => {
    const res = await request(makeApp()).get('/api/services')
    expect(res.status).toBe(401)
  })
})

describe('POST /api/services', () => {
  it('creates a service and returns 201 with id', async () => {
    const token = await makeToken()
    const res = await request(makeApp())
      .post('/api/services')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Teeth Cleaning',
        unit_price: 150,
        description: 'Standard cleaning',
        duration_minutes: 60,
      })

    expect(res.status).toBe(201)
    expect(res.body.id).toBeDefined()
    expect(res.body.name).toBe('Teeth Cleaning')
  })

  it('returns 400 when name is missing', async () => {
    const token = await makeToken()
    const res = await request(makeApp())
      .post('/api/services')
      .set('Authorization', `Bearer ${token}`)
      .send({ unit_price: 150 })

    expect(res.status).toBe(400)
    expect(res.body.error).toBeDefined()
  })
})
