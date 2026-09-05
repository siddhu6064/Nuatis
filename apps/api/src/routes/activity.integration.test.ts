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

const TENANT_ID = 'aaaaaaaa-0000-0000-0000-00000av00001'
const USER_ID = 'user-av-001'
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

const [{ default: express }, { default: request }, { default: activityRouter }] = await Promise.all(
  [import('express'), import('supertest'), import('./activity.js')]
)

// Mount under /api — matches how index.ts mounts: app.use('/api', activityRouter)
function makeApp() {
  const app = express()
  app.use(express.json())
  app.use('/api', activityRouter)
  return app
}

beforeEach(() => {
  store = createStore()
  store.tables['contacts'] = []
  store.tables['companies'] = []
  store.tables['activity_log'] = []
  store.tables['users'] = []
})

describe('POST /api/contacts/:contactId/notes', () => {
  it('creates note and returns 201 with type=note, actor_type=user', async () => {
    const contactId = randomUUID()
    ;(store.tables['contacts'] as Row[]).push({
      id: contactId,
      tenant_id: TENANT_ID,
      full_name: 'Pat',
    })
    const token = await makeToken()

    const res = await request(makeApp())
      .post(`/api/contacts/${contactId}/notes`)
      .set('Authorization', `Bearer ${token}`)
      .send({ body: 'Patient called to confirm appointment' })

    expect(res.status).toBe(201)
    expect(res.body.type).toBe('note')
    expect(res.body.actor_type).toBe('user')
    expect(res.body.body).toBe('Patient called to confirm appointment')
  })

  it('returns 400 when body is missing', async () => {
    const contactId = randomUUID()
    ;(store.tables['contacts'] as Row[]).push({
      id: contactId,
      tenant_id: TENANT_ID,
      full_name: 'Pat',
    })
    const token = await makeToken()

    const res = await request(makeApp())
      .post(`/api/contacts/${contactId}/notes`)
      .set('Authorization', `Bearer ${token}`)
      .send({})

    expect(res.status).toBe(400)
  })
})

describe('GET /api/contacts/:contactId/activity', () => {
  it('returns envelope { items, hasMore, nextCursor }', async () => {
    const contactId = randomUUID()
    ;(store.tables['contacts'] as Row[]).push({
      id: contactId,
      tenant_id: TENANT_ID,
      full_name: 'Pat',
    })
    ;(store.tables['activity_log'] as Row[]).push({
      id: randomUUID(),
      tenant_id: TENANT_ID,
      contact_id: contactId,
      type: 'note',
      body: 'Test note',
      metadata: { pinned: false },
      actor_type: 'user',
      actor_id: USER_ID,
      created_at: new Date().toISOString(),
    })
    const token = await makeToken()

    const res = await request(makeApp())
      .get(`/api/contacts/${contactId}/activity`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(Array.isArray(res.body.items)).toBe(true)
    expect(typeof res.body.hasMore).toBe('boolean')
    expect(res.body.nextCursor === null || typeof res.body.nextCursor === 'string').toBe(true)
  })
})

describe('GET /api/companies/:companyId/activity', () => {
  it('returns only the activity for that company, tenant-scoped', async () => {
    store.tables['companies'] = [{ id: 'comp-1', tenant_id: TENANT_ID, name: 'Acme' }]
    store.tables['activity_log'] = [
      {
        id: randomUUID(),
        tenant_id: TENANT_ID,
        company_id: 'comp-1',
        type: 'system',
        body: 'Merged Beta Inc into this company',
        actor_type: 'user',
        actor_id: USER_ID,
        created_at: new Date().toISOString(),
      },
      {
        id: randomUUID(),
        tenant_id: TENANT_ID,
        company_id: 'other-company',
        type: 'system',
        body: 'unrelated',
        actor_type: 'system',
        created_at: new Date().toISOString(),
      },
    ]
    store.tables['users'] = [{ id: USER_ID, full_name: 'Sid' }]

    const token = await makeToken()
    const res = await request(makeApp())
      .get('/api/companies/comp-1/activity')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect((res.body.items as Row[]).map((i) => i['body'] as string)).toEqual([
      'Merged Beta Inc into this company',
    ])
    expect((res.body.items as Row[])[0]?.['actor_name']).toBe('Sid')
  })

  it('404s for a company in another tenant', async () => {
    store.tables['companies'] = [{ id: 'comp-x', tenant_id: 'other-tenant', name: 'X' }]
    const token = await makeToken()
    const res = await request(makeApp())
      .get('/api/companies/comp-x/activity')
      .set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(404)
  })
})
