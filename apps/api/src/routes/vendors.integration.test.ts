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

const TENANT_ID = 'aaaaaaaa-0000-0000-0000-00000ve00001'
const SECRET = process.env['AUTH_SECRET'] ?? 'test-secret-for-unit-tests-only-32ch'
process.env['AUTH_SECRET'] = SECRET
process.env['SUPABASE_URL'] = 'https://mock.supabase.co'
process.env['SUPABASE_SERVICE_ROLE_KEY'] = 'mock-service-key'

async function makeToken(): Promise<string> {
  return mintTestToken({ sub: 'user-1', tenantId: TENANT_ID, role: 'owner' }, { secret: SECRET })
}

const { default: express } = await import('express')
const { default: request } = await import('supertest')
const { default: vendorsRouter } = await import('./vendors.js')

function makeApp() {
  const app = express()
  app.use('/api/vendors', express.json(), vendorsRouter)
  return app
}

beforeEach(() => {
  store = createStore()
  store.tables['tenants'] = [{ id: TENANT_ID, modules: { crm: true } }]
  store.tables['vendors'] = []
})

describe('POST /api/vendors', () => {
  it('creates a vendor', async () => {
    const token = await makeToken()
    const res = await request(makeApp())
      .post('/api/vendors')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Acme Supply Co', email: 'orders@acme.test' })

    expect(res.status).toBe(201)
    expect(res.body.name).toBe('Acme Supply Co')
    expect(res.body.is_active).toBe(true)
  })

  it('400s without a name', async () => {
    const token = await makeToken()
    const res = await request(makeApp())
      .post('/api/vendors')
      .set('Authorization', `Bearer ${token}`)
      .send({ email: 'x@example.com' })
    expect(res.status).toBe(400)
  })
})

describe('GET /api/vendors', () => {
  it('excludes inactive vendors by default', async () => {
    store.tables['vendors'] = [
      { id: 'v1', tenant_id: TENANT_ID, name: 'Active Co', is_active: true },
      { id: 'v2', tenant_id: TENANT_ID, name: 'Retired Co', is_active: false },
    ]
    const token = await makeToken()
    const res = await request(makeApp()).get('/api/vendors').set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(200)
    const ids = (res.body.data as Array<{ id: string }>).map((v) => v.id)
    expect(ids).toEqual(['v1'])
  })
})

describe('DELETE /api/vendors/:id', () => {
  it('soft-deletes by flipping is_active', async () => {
    store.tables['vendors'] = [{ id: 'v1', tenant_id: TENANT_ID, name: 'X', is_active: true }]
    const token = await makeToken()
    const res = await request(makeApp())
      .delete('/api/vendors/v1')
      .set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(200)
    expect(store.tables['vendors']?.[0]?.['is_active']).toBe(false)
  })
})
