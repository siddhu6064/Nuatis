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

jest.unstable_mockModule('@supabase/supabase-js', () => ({
  createClient: () => createMockSupabase(store),
}))

const TENANT_ID = 'aaaaaaaa-0000-0000-0000-00000ip00001'
const USER_ID = 'user-ip-001'
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

const [{ default: express }, { default: request }, { default: insightsRouter }] = await Promise.all(
  [import('express'), import('supertest'), import('./insights.js')]
)

function makeApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/insights', insightsRouter)
  return app
}

function seedPipeline(opts: {
  pipelineId: string
  isDefault: boolean
  stageIds: string[]
  dealCount: number
}): void {
  ;(store.tables['pipelines'] as Row[]).push({
    id: opts.pipelineId,
    tenant_id: TENANT_ID,
    name: opts.isDefault ? 'Default Pipeline' : 'Other Pipeline',
    is_default: opts.isDefault,
    pipeline_type: 'deals',
  })
  for (let i = 0; i < opts.stageIds.length; i++) {
    ;(store.tables['pipeline_stages'] as Row[]).push({
      id: opts.stageIds[i]!,
      tenant_id: TENANT_ID,
      pipeline_id: opts.pipelineId,
      name: `Stage ${i + 1}`,
      position: i,
      probability: (i + 1) * 25,
    })
  }
  const futureMonth = new Date()
  futureMonth.setMonth(futureMonth.getMonth() + 1)
  const closeDate = futureMonth.toISOString().slice(0, 10)

  for (let i = 0; i < opts.dealCount; i++) {
    ;(store.tables['deals'] as Row[]).push({
      id: randomUUID(),
      tenant_id: TENANT_ID,
      value: 1000,
      close_date: closeDate,
      is_archived: false,
      is_closed_won: false,
      is_closed_lost: false,
      pipeline_stage_id: opts.stageIds[i % opts.stageIds.length]!,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
  }
}

beforeEach(() => {
  store = createStore()
  store.tables['pipelines'] = []
  store.tables['pipeline_stages'] = []
  store.tables['deals'] = []
})

describe('GET /api/insights/pipeline-forecast', () => {
  it('returns pipeline + stages + summary with correct envelope shape', async () => {
    seedPipeline({
      pipelineId: 'pipe-default-001',
      isDefault: true,
      stageIds: ['stage-a', 'stage-b'],
      dealCount: 2,
    })
    const token = await makeToken()

    const res = await request(makeApp())
      .get('/api/insights/pipeline-forecast')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.pipeline).toBeDefined()
    expect(Array.isArray(res.body.stages)).toBe(true)
    expect(res.body.stages.length).toBe(2)
    expect(res.body.summary.deal_count).toBe(2)
    expect(Array.isArray(res.body.summary.monthly_forecast)).toBe(true)
    expect(typeof res.body.summary.total_pipeline_value).toBe('number')
  })

  it('returns zero-shape 200 when no default pipeline exists', async () => {
    const token = await makeToken()

    const res = await request(makeApp())
      .get('/api/insights/pipeline-forecast')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.summary.deal_count).toBe(0)
    expect(res.body.stages.length).toBe(0)
  })

  it('filters by pipeline_id query param when provided', async () => {
    seedPipeline({
      pipelineId: 'pipe-a-001',
      isDefault: true,
      stageIds: ['stage-a1', 'stage-a2'],
      dealCount: 1,
    })
    seedPipeline({
      pipelineId: 'pipe-b-001',
      isDefault: false,
      stageIds: ['stage-b1'],
      dealCount: 1,
    })
    const token = await makeToken()

    const res = await request(makeApp())
      .get('/api/insights/pipeline-forecast?pipeline_id=pipe-b-001')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.pipeline.id).toBe('pipe-b-001')
    expect(res.body.summary.deal_count).toBe(1)
  })
})
