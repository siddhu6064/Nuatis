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

const TENANT_ID = 'aaaaaaaa-0000-0000-0000-00000co00001'
const USER_ID = 'user-co-001'
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
  store.tables['deals'] = []
  store.tables['activity_log'] = []
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

describe('GET /api/companies/duplicates', () => {
  it('pairs companies by matching domain at confidence 100', async () => {
    store.tables['companies'] = [
      { id: 'c1', tenant_id: TENANT_ID, name: 'Acme Inc', domain: 'acme.com', is_archived: false },
      { id: 'c2', tenant_id: TENANT_ID, name: 'Acme LLC', domain: 'acme.com', is_archived: false },
    ]
    const token = await makeToken()
    const res = await request(makeApp())
      .get('/api/companies/duplicates')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.pairs).toHaveLength(1)
    expect(res.body.pairs[0].confidence).toBe(100)
    expect(res.body.pairs[0].match_reason).toBe('domain')
  })

  it('is not shadowed by GET /:id — "duplicates" must not be read as an id', async () => {
    const token = await makeToken()
    const res = await request(makeApp())
      .get('/api/companies/duplicates')
      .set('Authorization', `Bearer ${token}`)
    // A regression would hit GET /:id, which 404s ("Company not found") for
    // a nonexistent id — this must instead reach the duplicates handler.
    expect(res.status).toBe(200)
    expect(res.body.pairs).toBeDefined()
  })
})

describe('POST /api/companies/merge', () => {
  it('reassigns contacts and deals, archives the secondary', async () => {
    store.tables['companies'] = [
      {
        id: 'primary',
        tenant_id: TENANT_ID,
        name: 'Primary Co',
        domain: 'primary.com',
        is_archived: false,
      },
      {
        id: 'secondary',
        tenant_id: TENANT_ID,
        name: 'Secondary Co',
        domain: null,
        is_archived: false,
      },
    ]
    store.tables['contacts'] = [
      { id: 'contact-1', tenant_id: TENANT_ID, company_id: 'secondary', full_name: 'Jane' },
    ]
    store.tables['deals'] = [
      { id: 'deal-1', tenant_id: TENANT_ID, company_id: 'secondary', name: 'Big Deal' },
    ]

    const token = await makeToken()
    const res = await request(makeApp())
      .post('/api/companies/merge')
      .set('Authorization', `Bearer ${token}`)
      .send({ primary_id: 'primary', secondary_id: 'secondary' })

    expect(res.status).toBe(200)
    expect(res.body.id).toBe('primary')

    expect(store.tables['contacts']?.[0]?.['company_id']).toBe('primary')
    expect(store.tables['deals']?.[0]?.['company_id']).toBe('primary')
    const secondaryRow = store.tables['companies']?.find((c) => c['id'] === 'secondary')
    expect(secondaryRow?.['is_archived']).toBe(true)
  })

  it('400s merging a company into itself', async () => {
    const token = await makeToken()
    const res = await request(makeApp())
      .post('/api/companies/merge')
      .set('Authorization', `Bearer ${token}`)
      .send({ primary_id: 'x', secondary_id: 'x' })
    expect(res.status).toBe(400)
  })

  it('404s when either company is missing', async () => {
    const token = await makeToken()
    const res = await request(makeApp())
      .post('/api/companies/merge')
      .set('Authorization', `Bearer ${token}`)
      .send({ primary_id: 'nope', secondary_id: 'also-nope' })
    expect(res.status).toBe(404)
  })
})

describe('POST /api/companies/bulk/archive', () => {
  it('archives the given ids, tenant-scoped', async () => {
    store.tables['companies'] = [
      { id: 'c1', tenant_id: TENANT_ID, name: 'A', is_archived: false },
      { id: 'c2', tenant_id: TENANT_ID, name: 'B', is_archived: false },
      { id: 'other-tenant-co', tenant_id: 'other-tenant', name: 'C', is_archived: false },
    ]
    const token = await makeToken()
    const res = await request(makeApp())
      .post('/api/companies/bulk/archive')
      .set('Authorization', `Bearer ${token}`)
      .send({ ids: ['c1', 'c2', 'other-tenant-co'] })

    expect(res.status).toBe(200)
    expect(res.body.archived).toBe(2) // cross-tenant id silently dropped
    expect(store.tables['companies']?.find((c) => c['id'] === 'c1')?.['is_archived']).toBe(true)
    expect(
      store.tables['companies']?.find((c) => c['id'] === 'other-tenant-co')?.['is_archived']
    ).toBe(false)
  })

  it('400s an empty ids array', async () => {
    const token = await makeToken()
    const res = await request(makeApp())
      .post('/api/companies/bulk/archive')
      .set('Authorization', `Bearer ${token}`)
      .send({ ids: [] })
    expect(res.status).toBe(400)
  })
})
