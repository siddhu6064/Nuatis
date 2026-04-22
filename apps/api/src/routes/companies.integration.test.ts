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

const TENANT_ID = 'aaaaaaaa-0000-0000-0000-00000co00001'
const USER_ID = 'user-co-001'
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

const [{ default: express }, { default: request }, { default: companiesRouter }] =
  await Promise.all([import('express'), import('supertest'), import('./companies.js')])

function makeApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/companies', companiesRouter)
  return app
}

beforeEach(() => {
  store = createStore()
  store.tables['tenants'] = [{ id: TENANT_ID, modules: { companies: true } }]
  store.tables['companies'] = []
  store.tables['contacts'] = []
})

describe('GET /api/companies', () => {
  it('returns 200 with companies array, total, and page', async () => {
    const token = await makeToken()
    const res = await request(makeApp())
      .get('/api/companies')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(Array.isArray(res.body.companies)).toBe(true)
    expect(typeof res.body.total).toBe('number')
    expect(typeof res.body.page).toBe('number')
  })

  it('returns 401 without auth token', async () => {
    const res = await request(makeApp()).get('/api/companies')
    expect(res.status).toBe(401)
  })
})

describe('POST /api/companies', () => {
  it('creates company and returns 201 with id', async () => {
    const token = await makeToken()
    const res = await request(makeApp())
      .post('/api/companies')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Acme Roofing LLC', domain: 'acmeroofing.com' })

    expect(res.status).toBe(201)
    expect(res.body.id).toBeDefined()
    expect(res.body.name).toBe('Acme Roofing LLC')
  })

  it('returns 400 when name is missing', async () => {
    const token = await makeToken()
    const res = await request(makeApp())
      .post('/api/companies')
      .set('Authorization', `Bearer ${token}`)
      .send({ domain: 'acmeroofing.com' })

    expect(res.status).toBe(400)
  })
})
