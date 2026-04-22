import { jest, describe, it, expect, beforeEach } from '@jest/globals'
import { SignJWT } from 'jose'
import { randomUUID } from 'node:crypto'
import {
  createStore,
  createMockSupabase,
  type MockStore,
  type Row,
} from './__test-support__/supabase-mock.js'

let store: MockStore = createStore()
const logActivity = jest.fn(async () => undefined)

jest.unstable_mockModule('@supabase/supabase-js', () => ({
  createClient: () => createMockSupabase(store),
}))
jest.unstable_mockModule('../lib/activity.js', () => ({ logActivity }))

const TENANT_ID = 'aaaaaaaa-0000-0000-0000-00000dl00001'
const USER_ID = 'user-dl-001'
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

const [{ default: express }, { default: request }, { default: dealsRouter }] = await Promise.all([
  import('express'),
  import('supertest'),
  import('./deals.js'),
])

function makeApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/deals', dealsRouter)
  return app
}

function seedDealsEnabled(): void {
  store.tables['tenants'] = [{ id: TENANT_ID, modules: { deals: true } }]
}

function seedDealsDisabled(): void {
  store.tables['tenants'] = [{ id: TENANT_ID, modules: { deals: false } }]
}

beforeEach(() => {
  store = createStore()
  store.tables['deals'] = []
  store.tables['pipeline_stages'] = []
  store.tables['contacts'] = []
  store.tables['companies'] = []
  store.tables['users'] = []
  logActivity.mockClear()
})

describe('POST /api/deals', () => {
  it('creates deal and returns 201 with id and title', async () => {
    seedDealsEnabled()
    const token = await makeToken()
    const res = await request(makeApp())
      .post('/api/deals')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'New roof installation' })

    expect(res.status).toBe(201)
    expect(res.body.id).toBeDefined()
    expect(res.body.title).toBe('New roof installation')
  })

  it('returns 400 when title is missing', async () => {
    seedDealsEnabled()
    const token = await makeToken()
    const res = await request(makeApp())
      .post('/api/deals')
      .set('Authorization', `Bearer ${token}`)
      .send({ value: 5000 })

    expect(res.status).toBe(400)
  })

  it('returns 403 when modules.deals is false', async () => {
    seedDealsDisabled()
    const token = await makeToken()
    const res = await request(makeApp())
      .post('/api/deals')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'X' })

    expect(res.status).toBe(403)
  })
})

describe('PUT /api/deals/:id', () => {
  it('logs stage_change activity when pipeline_stage_id changes', async () => {
    seedDealsEnabled()
    const stageAId = randomUUID()
    const stageBId = randomUUID()
    ;(store.tables['pipeline_stages'] as Row[]).push(
      { id: stageAId, tenant_id: TENANT_ID, name: 'Stage A', color: '#111' },
      { id: stageBId, tenant_id: TENANT_ID, name: 'Stage B', color: '#222' }
    )
    const dealId = randomUUID()
    ;(store.tables['deals'] as Row[]).push({
      id: dealId,
      tenant_id: TENANT_ID,
      title: 'Test Deal',
      value: 100,
      pipeline_stage_id: stageAId,
      is_archived: false,
      is_closed_won: false,
      is_closed_lost: false,
    })

    const token = await makeToken()
    const res = await request(makeApp())
      .put(`/api/deals/${dealId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ pipeline_stage_id: stageBId })

    expect(res.status).toBe(200)
    const stageChangeCall = logActivity.mock.calls.find(
      (c) => (c[0] as { type?: string }).type === 'stage_change'
    )
    expect(stageChangeCall).toBeDefined()
  })
})
