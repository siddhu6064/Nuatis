import { jest, describe, it, expect, beforeEach } from '@jest/globals'
import { mintTestToken } from './__test-support__/jwt.js'
import { randomUUID } from 'node:crypto'
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

const TENANT_ID = 'aaaaaaaa-0000-0000-0000-00000ak00001'
const SECRET = process.env['AUTH_SECRET'] ?? 'test-secret-for-unit-tests-only-32ch'
process.env['AUTH_SECRET'] = SECRET
process.env['SUPABASE_URL'] = 'https://mock.supabase.co'
process.env['SUPABASE_SERVICE_ROLE_KEY'] = 'mock-service-key'

async function makeToken(role = 'owner'): Promise<string> {
  return mintTestToken(
    { sub: 'user-ak-001', tenantId: TENANT_ID, role, vertical: 'dental', appUserId: 'user-ak-001' },
    { secret: SECRET }
  )
}

const [{ default: express }, { default: request }, { default: apiKeysRouter }] = await Promise.all([
  import('express'),
  import('supertest'),
  import('./api-keys.js'),
])

function makeApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/api-keys', apiKeysRouter)
  return app
}

beforeEach(() => {
  store = createStore()
  store.tables['api_keys'] = []
})

describe('POST /api/api-keys', () => {
  it('creates a key, returns the plaintext once, and stores only the hash', async () => {
    const token = await makeToken()

    const res = await request(makeApp())
      .post('/api/api-keys')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'CI script' })

    expect(res.status).toBe(201)
    expect(res.body.key).toMatch(/^nuatis_/)
    expect(res.body.name).toBe('CI script')

    const row = (store.tables['api_keys'] as Row[])[0]
    expect(row?.['key_hash']).toBeDefined()
    expect(row?.['key_hash']).not.toBe(res.body.key)
  })

  it('rejects a non-owner/admin role with 403', async () => {
    const token = await makeToken('staff')

    const res = await request(makeApp())
      .post('/api/api-keys')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'CI script' })

    expect(res.status).toBe(403)
  })

  it('400s when name is missing', async () => {
    const token = await makeToken()

    const res = await request(makeApp())
      .post('/api/api-keys')
      .set('Authorization', `Bearer ${token}`)
      .send({})

    expect(res.status).toBe(400)
  })
})

describe('GET /api/api-keys', () => {
  // The route's .select() explicitly omits key_hash — verified by code
  // review, not by this test: the mock returns whatever was stored
  // regardless of the select column list (it doesn't enforce projection the
  // way real Postgres/PostgREST does), so asserting key_hash is absent here
  // would pass even if the route's .select() were broken.
  it('lists keys with the prefix', async () => {
    ;(store.tables['api_keys'] as Row[]).push({
      id: randomUUID(),
      tenant_id: TENANT_ID,
      name: 'existing key',
      key_hash: 'some-hash',
      key_prefix: 'nuatis_abc123',
      created_at: new Date().toISOString(),
    })
    const token = await makeToken()

    const res = await request(makeApp())
      .get('/api/api-keys')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.keys).toHaveLength(1)
    expect(res.body.keys[0].key_prefix).toBe('nuatis_abc123')
  })
})

describe('DELETE /api/api-keys/:id', () => {
  it('revokes a key (stamps revoked_at) rather than deleting the row', async () => {
    const keyId = randomUUID()
    ;(store.tables['api_keys'] as Row[]).push({
      id: keyId,
      tenant_id: TENANT_ID,
      name: 'to revoke',
      key_hash: 'some-hash',
      key_prefix: 'nuatis_xyz',
      revoked_at: null,
    })
    const token = await makeToken()

    const res = await request(makeApp())
      .delete(`/api/api-keys/${keyId}`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.revoked).toBe(true)

    const row = (store.tables['api_keys'] as Row[]).find((r) => r['id'] === keyId)
    expect(row?.['revoked_at']).not.toBeNull()
  })
})
