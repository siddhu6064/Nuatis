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

const TENANT_ID = 'aaaaaaaa-0000-0000-0000-00000ss00001'
const OTHER_TENANT_ID = 'aaaaaaaa-0000-0000-0000-00000ss00099'
const SECRET = process.env['AUTH_SECRET'] ?? 'test-secret-for-unit-tests-only-32ch'
process.env['AUTH_SECRET'] = SECRET
process.env['SUPABASE_URL'] = 'https://mock.supabase.co'
process.env['SUPABASE_SERVICE_ROLE_KEY'] = 'mock-service-key'

async function makeToken(): Promise<string> {
  return mintTestToken({ sub: 'user-1', tenantId: TENANT_ID, role: 'owner' }, { secret: SECRET })
}

const { default: express } = await import('express')
const { default: request } = await import('supertest')
const { default: staffRouter } = await import('./staff.js')

function makeApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/staff', staffRouter)
  return app
}

beforeEach(() => {
  store = createStore()
  store.tables['tenants'] = [{ id: TENANT_ID, modules: { crm: true } }]
  store.tables['staff_members'] = [
    { id: 'staff-1', tenant_id: TENANT_ID, name: 'Jane', role: 'Stylist', is_active: true },
  ]
  store.tables['services'] = [
    { id: 'svc-1', tenant_id: TENANT_ID, name: 'Haircut', is_active: true },
    { id: 'svc-2', tenant_id: TENANT_ID, name: 'Color', is_active: true },
  ]
  store.tables['staff_services'] = []
})

describe('GET /api/staff/:id/services', () => {
  it('returns an empty list when nothing mapped', async () => {
    const token = await makeToken()
    const res = await request(makeApp())
      .get('/api/staff/staff-1/services')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.service_ids).toEqual([])
  })

  it('404s a staff member in another tenant', async () => {
    store.tables['staff_members'] = [
      { id: 'staff-1', tenant_id: OTHER_TENANT_ID, name: 'Jane', role: 'Stylist', is_active: true },
    ]
    const token = await makeToken()
    const res = await request(makeApp())
      .get('/api/staff/staff-1/services')
      .set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(404)
  })
})

describe('PUT /api/staff/:id/services', () => {
  it('replaces the mapped service set', async () => {
    const token = await makeToken()
    const app = makeApp()

    const putRes = await request(app)
      .put('/api/staff/staff-1/services')
      .set('Authorization', `Bearer ${token}`)
      .send({ service_ids: ['svc-1', 'svc-2'] })

    expect(putRes.status).toBe(200)
    expect(putRes.body.service_ids.sort()).toEqual(['svc-1', 'svc-2'])

    const getRes = await request(app)
      .get('/api/staff/staff-1/services')
      .set('Authorization', `Bearer ${token}`)
    expect(getRes.body.service_ids.sort()).toEqual(['svc-1', 'svc-2'])

    // Replacing again with a smaller set drops the removed mapping
    const putRes2 = await request(app)
      .put('/api/staff/staff-1/services')
      .set('Authorization', `Bearer ${token}`)
      .send({ service_ids: ['svc-1'] })
    expect(putRes2.status).toBe(200)
    expect(putRes2.body.service_ids).toEqual(['svc-1'])
  })

  it('400s an unknown service_id', async () => {
    const token = await makeToken()
    const res = await request(makeApp())
      .put('/api/staff/staff-1/services')
      .set('Authorization', `Bearer ${token}`)
      .send({ service_ids: ['not-a-real-service'] })
    expect(res.status).toBe(400)
  })

  it('404s a staff member in another tenant', async () => {
    store.tables['staff_members'] = [
      { id: 'staff-1', tenant_id: OTHER_TENANT_ID, name: 'Jane', role: 'Stylist', is_active: true },
    ]
    const token = await makeToken()
    const res = await request(makeApp())
      .put('/api/staff/staff-1/services')
      .set('Authorization', `Bearer ${token}`)
      .send({ service_ids: [] })
    expect(res.status).toBe(404)
  })
})
