import { jest, describe, it, expect, beforeEach } from '@jest/globals'
import { mintTestToken } from './__test-support__/jwt.js'
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
  return mintTestToken(
    { sub: USER_ID, tenantId: TENANT_ID, role, vertical: 'dental' },
    { secret: SECRET }
  )
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

function seedTenant(plan: string | null, status: string | null, id: string = TENANT_ID) {
  ;(store.tables['tenants'] as Row[]).push({
    id,
    modules: { maya: true, crm: true, cpq: false },
    ...(plan !== null ? { subscription_plan: plan } : {}),
    ...(status !== null ? { subscription_status: status } : {}),
  })
}

describe('PUT /api/settings/modules', () => {
  it('enables a module within the tenant plan and returns updated modules', async () => {
    store.tables['tenants'] = []
    seedTenant('scale', 'active')
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

describe('PUT /api/settings/modules — plan gate', () => {
  it('returns 402 when Core tenant tries to enable cpq', async () => {
    store.tables['tenants'] = [
      {
        id: TENANT_ID,
        modules: { maya: true, crm: true, cpq: false },
        subscription_plan: 'core',
        subscription_status: 'active',
      },
    ]
    const token = await makeToken('owner')
    const res = await request(makeApp())
      .put('/api/settings/modules')
      .set('Authorization', `Bearer ${token}`)
      .send({ module: 'cpq', enabled: true })

    expect(res.status).toBe(402)
    expect(res.body.required_plan).toBe('scale')
    expect(res.body.current_plan).toBe('core')
    expect(res.body.module).toBe('cpq')
  })

  it('gates trial tenants by their plan — Core trialing cannot enable above-plan modules', async () => {
    for (const moduleName of ['cpq', 'campaigns', 'automation', 'insights']) {
      store.tables['tenants'] = []
      seedTenant('core', 'trialing')
      const token = await makeToken('owner')
      const res = await request(makeApp())
        .put('/api/settings/modules')
        .set('Authorization', `Bearer ${token}`)
        .send({ module: moduleName, enabled: true })

      expect(res.status).toBe(402)
      const row = (store.tables['tenants'] as Row[]).find((r) => r['id'] === TENANT_ID)
      expect((row?.['modules'] as Record<string, boolean>)[moduleName]).not.toBe(true)
    }
  })

  it('returns 402 when Core active tenant tries to enable campaigns', async () => {
    store.tables['tenants'] = []
    seedTenant('core', 'active')
    const token = await makeToken('owner')
    const res = await request(makeApp())
      .put('/api/settings/modules')
      .set('Authorization', `Bearer ${token}`)
      .send({ module: 'campaigns', enabled: true })

    expect(res.status).toBe(402)
    expect(res.body.required_plan).toBe('pro')
    expect(res.body.upgrade_url).toBe('/pricing')
  })

  it('allows Core tenants (trialing or active) to enable base-suite modules', async () => {
    for (const status of ['trialing', 'active']) {
      for (const moduleName of ['pipeline', 'crm', 'maya']) {
        store.tables['tenants'] = []
        seedTenant('core', status)
        const token = await makeToken('owner')
        const res = await request(makeApp())
          .put('/api/settings/modules')
          .set('Authorization', `Bearer ${token}`)
          .send({ module: moduleName, enabled: true })

        expect(res.status).toBe(200)
        expect(res.body.modules[moduleName]).toBe(true)
      }
    }
  })

  it('allows Pro tenant to enable campaigns', async () => {
    store.tables['tenants'] = []
    seedTenant('pro', 'active')
    const token = await makeToken('owner')
    const res = await request(makeApp())
      .put('/api/settings/modules')
      .set('Authorization', `Bearer ${token}`)
      .send({ module: 'campaigns', enabled: true })

    expect(res.status).toBe(200)
    expect(res.body.modules.campaigns).toBe(true)
  })

  it('never gates disabling — Core tenant can disable an above-plan module', async () => {
    store.tables['tenants'] = []
    seedTenant('core', 'active')
    const token = await makeToken('owner')
    const res = await request(makeApp())
      .put('/api/settings/modules')
      .set('Authorization', `Bearer ${token}`)
      .send({ module: 'cpq', enabled: false })

    expect(res.status).toBe(200)
    expect(res.body.modules.cpq).toBe(false)
  })

  it('fails closed with 503 when the tenant/plan lookup errors — no write performed', async () => {
    store.tables['tenants'] = []
    seedTenant('scale', 'active')
    store.tableErrors = { tenants: { message: 'db unavailable' } }
    const token = await makeToken('owner')
    const res = await request(makeApp())
      .put('/api/settings/modules')
      .set('Authorization', `Bearer ${token}`)
      .send({ module: 'cpq', enabled: true })

    expect(res.status).toBe(503)
    const row = (store.tables['tenants'] as Row[]).find((r) => r['id'] === TENANT_ID)
    expect((row?.['modules'] as Record<string, boolean>)['cpq']).toBe(false)
  })

  it('null plan fails closed: base module 200, above-base module 402', async () => {
    store.tables['tenants'] = []
    seedTenant(null, null)
    const token = await makeToken('owner')

    const base = await request(makeApp())
      .put('/api/settings/modules')
      .set('Authorization', `Bearer ${token}`)
      .send({ module: 'crm', enabled: true })
    expect(base.status).toBe(200)

    const aboveBase = await request(makeApp())
      .put('/api/settings/modules')
      .set('Authorization', `Bearer ${token}`)
      .send({ module: 'campaigns', enabled: true })
    expect(aboveBase.status).toBe(402)
    expect(aboveBase.body.required_plan).toBe('pro')
  })

  it('writes scope to the authed tenant only — other tenants untouched', async () => {
    const OTHER_ID = 'bbbbbbbb-0000-0000-0000-00000sm00002'
    store.tables['tenants'] = []
    seedTenant('scale', 'active')
    seedTenant('scale', 'active', OTHER_ID)
    const token = await makeToken('owner')

    const res = await request(makeApp())
      .put('/api/settings/modules')
      .set('Authorization', `Bearer ${token}`)
      .send({ module: 'cpq', enabled: true })
    expect(res.status).toBe(200)

    const other = (store.tables['tenants'] as Row[]).find((r) => r['id'] === OTHER_ID)
    expect((other?.['modules'] as Record<string, boolean>)['cpq']).toBe(false)
  })
})
