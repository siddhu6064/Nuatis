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
  return mintTestToken(
    { sub: USER_ID, tenantId: TENANT_ID, role: 'owner', vertical: 'dental' },
    { secret: SECRET }
  )
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

// ── ENUM-1: pipeline_stages tenant scope on ?pipeline_id= ─────────────────────
describe('ENUM-1 — pipeline_id filter is tenant-scoped', () => {
  const B_TENANT = 'bbbbbbbb-0000-0000-0000-0000000dl00b1'
  const A_PIPELINE = 'pipe-a-dl'
  const B_PIPELINE = 'pipe-b-dl'
  const A_STAGE = 'stage-a-dl'
  const A_STAGE2 = 'stage-a2-dl'
  const B_STAGE = 'stage-b-dl'

  function seedADeal(id: string, stageId: string): void {
    ;(store.tables['deals'] as Row[]).push({
      id,
      tenant_id: TENANT_ID,
      title: id,
      pipeline_stage_id: stageId,
      is_archived: false,
      is_closed_won: false,
      is_closed_lost: false,
      contact_id: null,
      company_id: null,
    })
  }

  it("a foreign tenant's pipeline_id resolves to zero stages and does NOT filter A's deals", async () => {
    seedDealsEnabled()
    ;(store.tables['pipeline_stages'] as Row[]).push(
      { id: A_STAGE, tenant_id: TENANT_ID, pipeline_id: A_PIPELINE, name: 'AWon', color: '#1' },
      { id: B_STAGE, tenant_id: B_TENANT, pipeline_id: B_PIPELINE, name: 'BWon', color: '#2' }
    )
    seedADeal('d1', A_STAGE)
    seedADeal('d2', A_STAGE)
    const token = await makeToken()

    const res = await request(makeApp())
      .get(`/api/deals?pipeline_id=${B_PIPELINE}`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    // B's pipeline yields no stages for A → no pipeline_stage_id filter → both returned.
    expect((res.body.deals as Array<unknown>).length).toBe(2)
  })

  it("POSITIVE CONTROL: A's own pipeline_id filters A's deals by its stages", async () => {
    seedDealsEnabled()
    ;(store.tables['pipeline_stages'] as Row[]).push(
      { id: A_STAGE, tenant_id: TENANT_ID, pipeline_id: A_PIPELINE, name: 'AWon', color: '#1' },
      {
        id: A_STAGE2,
        tenant_id: TENANT_ID,
        pipeline_id: 'pipe-a-other',
        name: 'AOther',
        color: '#3',
      }
    )
    seedADeal('d1', A_STAGE)
    seedADeal('d2', A_STAGE)
    seedADeal('d3', A_STAGE2)
    const token = await makeToken()

    const res = await request(makeApp())
      .get(`/api/deals?pipeline_id=${A_PIPELINE}`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    const idsOut = (res.body.deals as Array<{ id: string }>).map((d) => d.id).sort()
    expect(idsOut).toEqual(['d1', 'd2'])
  })
})
