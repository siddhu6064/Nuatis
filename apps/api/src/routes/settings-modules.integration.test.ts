import { jest, describe, it, expect, beforeEach } from '@jest/globals'
import { SignJWT } from 'jose'
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

const TENANT_ID = 'aaaaaaaa-0000-0000-0000-00000sm00001'
const USER_ID = 'user-sm-001'
const SECRET = process.env['AUTH_SECRET'] ?? 'test-secret-for-unit-tests-only-32ch'
process.env['AUTH_SECRET'] = SECRET
process.env['SUPABASE_URL'] = 'https://mock.supabase.co'
process.env['SUPABASE_SERVICE_ROLE_KEY'] = 'mock-service-key'

async function makeToken(role: string = 'owner'): Promise<string> {
  const secretBytes = new TextEncoder().encode(SECRET)
  return new SignJWT({ sub: USER_ID, tenantId: TENANT_ID, role, vertical: 'dental' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(secretBytes)
}

const [{ default: express }, { default: request }, { default: settingsModulesRouter }] =
  await Promise.all([import('express'), import('supertest'), import('./settings-modules.js')])

function makeApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/settings/modules', settingsModulesRouter)
  return app
}

beforeEach(() => {
  store = createStore()
  store.tables['tenants'] = [{ id: TENANT_ID, modules: { maya: true, crm: true, cpq: false } }]
})

describe('GET /api/settings/modules', () => {
  it('returns modules object for authenticated owner', async () => {
    const token = await makeToken('owner')
    const res = await request(makeApp())
      .get('/api/settings/modules')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.modules).toBeDefined()
    expect(res.body.modules.cpq).toBe(false)
  })

  it('returns 401 without auth token', async () => {
    const res = await request(makeApp()).get('/api/settings/modules')
    expect(res.status).toBe(401)
  })
})

describe('PUT /api/settings/modules', () => {
  it('enables a module and returns updated modules', async () => {
    const token = await makeToken('owner')
    const res = await request(makeApp())
      .put('/api/settings/modules')
      .set('Authorization', `Bearer ${token}`)
      .send({ module: 'cpq', enabled: true })

    expect(res.status).toBe(200)
    expect(res.body.modules.cpq).toBe(true)
  })

  it('returns 403 when caller is not owner role', async () => {
    const token = await makeToken('member')
    const res = await request(makeApp())
      .put('/api/settings/modules')
      .set('Authorization', `Bearer ${token}`)
      .send({ module: 'crm', enabled: false })

    expect(res.status).toBe(403)
  })

  it('returns 400 when module key is not in VALID_MODULES', async () => {
    const token = await makeToken('owner')
    const res = await request(makeApp())
      .put('/api/settings/modules')
      .set('Authorization', `Bearer ${token}`)
      .send({ module: 'not_a_real_module', enabled: true })

    expect(res.status).toBe(400)
  })

  it('accepts companies module (fix verified — previously 400)', async () => {
    const token = await makeToken('owner')
    const res = await request(makeApp())
      .put('/api/settings/modules')
      .set('Authorization', `Bearer ${token}`)
      .send({ module: 'companies', enabled: false })

    expect(res.status).toBe(200)
    const row = (store.tables['tenants'] as Row[]).find((r) => r['id'] === TENANT_ID)
    const modules = row?.['modules'] as Record<string, boolean>
    expect(modules.companies).toBe(false)
  })

  it('accepts deals module (fix verified — previously 400)', async () => {
    const token = await makeToken('owner')
    const res = await request(makeApp())
      .put('/api/settings/modules')
      .set('Authorization', `Bearer ${token}`)
      .send({ module: 'deals', enabled: true })

    expect(res.status).toBe(200)
    const row = (store.tables['tenants'] as Row[]).find((r) => r['id'] === TENANT_ID)
    const modules = row?.['modules'] as Record<string, boolean>
    expect(modules.deals).toBe(true)
  })
})
