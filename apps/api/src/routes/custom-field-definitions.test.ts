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

const TENANT_ID = 'aaaaaaaa-0000-0000-0000-00000cfd0001'
const SECRET = process.env['AUTH_SECRET'] ?? 'test-secret-for-unit-tests-only-32ch'
process.env['AUTH_SECRET'] = SECRET
process.env['SUPABASE_URL'] = 'https://mock.supabase.co'
process.env['SUPABASE_SERVICE_ROLE_KEY'] = 'mock-service-key'

async function makeToken(): Promise<string> {
  return mintTestToken({ sub: 'user-1', tenantId: TENANT_ID, role: 'owner' }, { secret: SECRET })
}

const [{ default: express }, { default: request }, { default: customFieldsRouter }] =
  await Promise.all([
    import('express'),
    import('supertest'),
    import('./custom-field-definitions.js'),
  ])

function makeApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/settings/custom-fields', customFieldsRouter)
  return app
}

beforeEach(() => {
  store = createStore()
  store.tables['tenants'] = [{ id: TENANT_ID, vertical: 'sales_crm' }]
  store.tables['vertical_configs'] = []
})

describe('GET /api/settings/custom-fields', () => {
  it('lazily seeds from the static vertical list on first read', async () => {
    const token = await makeToken()
    const res = await request(makeApp())
      .get('/api/settings/custom-fields')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.vertical).toBe('sales_crm')
    expect(res.body.fields.length).toBeGreaterThan(0)
    expect((store.tables['vertical_configs'] as Row[]).length).toBe(1)
  })

  it('returns the tenant’s already-customized list on a later read', async () => {
    store.tables['vertical_configs'] = [
      {
        id: 'vc-1',
        tenant_id: TENANT_ID,
        vertical_slug: 'sales_crm',
        field_definitions: [
          { key: 'favorite_color', label: 'Favorite color', type: 'text', required: false },
        ],
      },
    ]
    const token = await makeToken()
    const res = await request(makeApp())
      .get('/api/settings/custom-fields')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.fields).toEqual([
      { key: 'favorite_color', label: 'Favorite color', type: 'text', required: false },
    ])
  })
})

describe('POST /api/settings/custom-fields', () => {
  it('adds a new field', async () => {
    const token = await makeToken()
    const res = await request(makeApp())
      .post('/api/settings/custom-fields')
      .set('Authorization', `Bearer ${token}`)
      .send({ key: 'shirt_size', label: 'Shirt size', type: 'text' })

    expect(res.status).toBe(201)
    expect(res.body.key).toBe('shirt_size')

    const getRes = await request(makeApp())
      .get('/api/settings/custom-fields')
      .set('Authorization', `Bearer ${token}`)
    expect(getRes.body.fields.some((f: { key: string }) => f.key === 'shirt_size')).toBe(true)
  })

  it('400s on an invalid key format', async () => {
    const token = await makeToken()
    const res = await request(makeApp())
      .post('/api/settings/custom-fields')
      .set('Authorization', `Bearer ${token}`)
      .send({ key: 'Shirt-Size', label: 'Shirt size', type: 'text' })

    expect(res.status).toBe(400)
  })

  it('400s on a reserved key', async () => {
    const token = await makeToken()
    const res = await request(makeApp())
      .post('/api/settings/custom-fields')
      .set('Authorization', `Bearer ${token}`)
      .send({ key: 'enrichment_suggested_company', label: 'x', type: 'text' })

    expect(res.status).toBe(400)
  })

  it('400s on select type with no options', async () => {
    const token = await makeToken()
    const res = await request(makeApp())
      .post('/api/settings/custom-fields')
      .set('Authorization', `Bearer ${token}`)
      .send({ key: 'tier', label: 'Tier', type: 'select' })

    expect(res.status).toBe(400)
  })

  it('409s on a duplicate key', async () => {
    const token = await makeToken()
    await request(makeApp())
      .post('/api/settings/custom-fields')
      .set('Authorization', `Bearer ${token}`)
      .send({ key: 'shirt_size', label: 'Shirt size', type: 'text' })

    const res = await request(makeApp())
      .post('/api/settings/custom-fields')
      .set('Authorization', `Bearer ${token}`)
      .send({ key: 'shirt_size', label: 'Again', type: 'text' })

    expect(res.status).toBe(409)
  })

  it('400s once the tenant is at the field cap', async () => {
    store.tables['vertical_configs'] = [
      {
        id: 'vc-1',
        tenant_id: TENANT_ID,
        vertical_slug: 'sales_crm',
        field_definitions: Array.from({ length: 30 }, (_, i) => ({
          key: `f${i}`,
          label: `F${i}`,
          type: 'text',
          required: false,
        })),
      },
    ]
    const token = await makeToken()
    const res = await request(makeApp())
      .post('/api/settings/custom-fields')
      .set('Authorization', `Bearer ${token}`)
      .send({ key: 'one_more', label: 'One more', type: 'text' })

    expect(res.status).toBe(400)
  })
})

describe('PUT /api/settings/custom-fields/:key', () => {
  it('edits label/required without changing the key', async () => {
    const token = await makeToken()
    await request(makeApp())
      .post('/api/settings/custom-fields')
      .set('Authorization', `Bearer ${token}`)
      .send({ key: 'shirt_size', label: 'Shirt size', type: 'text' })

    const res = await request(makeApp())
      .put('/api/settings/custom-fields/shirt_size')
      .set('Authorization', `Bearer ${token}`)
      .send({ label: 'Shirt Size (US)', required: true })

    expect(res.status).toBe(200)
    expect(res.body.label).toBe('Shirt Size (US)')
    expect(res.body.required).toBe(true)
    expect(res.body.key).toBe('shirt_size')
  })

  it('404s for an unknown key', async () => {
    const token = await makeToken()
    const res = await request(makeApp())
      .put('/api/settings/custom-fields/does_not_exist')
      .set('Authorization', `Bearer ${token}`)
      .send({ label: 'x' })

    expect(res.status).toBe(404)
  })
})

describe('DELETE /api/settings/custom-fields/:key', () => {
  it('removes a field definition', async () => {
    const token = await makeToken()
    await request(makeApp())
      .post('/api/settings/custom-fields')
      .set('Authorization', `Bearer ${token}`)
      .send({ key: 'shirt_size', label: 'Shirt size', type: 'text' })

    const res = await request(makeApp())
      .delete('/api/settings/custom-fields/shirt_size')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    const getRes = await request(makeApp())
      .get('/api/settings/custom-fields')
      .set('Authorization', `Bearer ${token}`)
    expect(getRes.body.fields.some((f: { key: string }) => f.key === 'shirt_size')).toBe(false)
  })
})

describe('PUT /api/settings/custom-fields/reorder', () => {
  it('reorders the field list', async () => {
    store.tables['vertical_configs'] = [
      {
        id: 'vc-1',
        tenant_id: TENANT_ID,
        vertical_slug: 'sales_crm',
        field_definitions: [
          { key: 'a', label: 'A', type: 'text', required: false },
          { key: 'b', label: 'B', type: 'text', required: false },
        ],
      },
    ]
    const token = await makeToken()
    const res = await request(makeApp())
      .put('/api/settings/custom-fields/reorder')
      .set('Authorization', `Bearer ${token}`)
      .send({ keys: ['b', 'a'] })

    expect(res.status).toBe(200)
    expect(res.body.fields.map((f: { key: string }) => f.key)).toEqual(['b', 'a'])
  })

  it('400s when keys is not a full permutation', async () => {
    store.tables['vertical_configs'] = [
      {
        id: 'vc-1',
        tenant_id: TENANT_ID,
        vertical_slug: 'sales_crm',
        field_definitions: [{ key: 'a', label: 'A', type: 'text', required: false }],
      },
    ]
    const token = await makeToken()
    const res = await request(makeApp())
      .put('/api/settings/custom-fields/reorder')
      .set('Authorization', `Bearer ${token}`)
      .send({ keys: ['a', 'nonexistent'] })

    expect(res.status).toBe(400)
  })
})
