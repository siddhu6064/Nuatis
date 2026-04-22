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

const TENANT_ID = 'aaaaaaaa-0000-0000-0000-00000pl00001'
const USER_ID = 'user-pl-001'
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

const [{ default: express }, { default: request }, { default: pipelinesRouter }] =
  await Promise.all([import('express'), import('supertest'), import('./pipelines.js')])

function makeApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/pipelines', pipelinesRouter)
  return app
}

beforeEach(() => {
  store = createStore()
  store.tables['pipelines'] = []
  store.tables['pipeline_stages'] = []
  store.tables['contacts'] = []
  store.tables['deals'] = []
})

describe('POST /api/pipelines', () => {
  it('creates pipeline and returns 201 with is_default=true for first of type', async () => {
    const token = await makeToken()
    const res = await request(makeApp())
      .post('/api/pipelines')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Sales Pipeline', pipelineType: 'contacts' })

    expect(res.status).toBe(201)
    expect(res.body.id).toBeDefined()
    expect(res.body.name).toBe('Sales Pipeline')
    expect(res.body.is_default).toBe(true)
  })

  it('returns 400 when pipelineType is invalid', async () => {
    const token = await makeToken()
    const res = await request(makeApp())
      .post('/api/pipelines')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Bad Pipeline', pipelineType: 'invalid_type' })

    expect(res.status).toBe(400)
  })
})

describe('POST /api/pipelines/:pipelineId/stages', () => {
  it('creates stage and returns 201 with pipeline_id set', async () => {
    const pipelineId = randomUUID()
    ;(store.tables['pipelines'] as Row[]).push({
      id: pipelineId,
      tenant_id: TENANT_ID,
      name: 'Sales',
      pipeline_type: 'contacts',
      is_default: true,
    })
    const token = await makeToken()

    const res = await request(makeApp())
      .post(`/api/pipelines/${pipelineId}/stages`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Qualified', color: '#10B981', probability: 40 })

    expect(res.status).toBe(201)
    expect(res.body.id).toBeDefined()
    expect(res.body.name).toBe('Qualified')
    expect(res.body.pipeline_id).toBe(pipelineId)
  })
})

describe('DELETE /api/pipelines/:pipelineId/stages/:stageId', () => {
  it('returns 400 with count when contacts reference the stage', async () => {
    const pipelineId = randomUUID()
    const stageId = randomUUID()
    const stageName = 'Active Client'
    ;(store.tables['pipelines'] as Row[]).push({
      id: pipelineId,
      tenant_id: TENANT_ID,
      name: 'Sales',
      pipeline_type: 'contacts',
    })
    ;(store.tables['pipeline_stages'] as Row[]).push({
      id: stageId,
      tenant_id: TENANT_ID,
      pipeline_id: pipelineId,
      name: stageName,
      position: 0,
    })
    ;(store.tables['contacts'] as Row[]).push({
      id: randomUUID(),
      tenant_id: TENANT_ID,
      full_name: 'Pat',
      pipeline_stage: stageName,
      is_archived: false,
    })
    const token = await makeToken()

    const res = await request(makeApp())
      .delete(`/api/pipelines/${pipelineId}/stages/${stageId}`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(400)
    expect(res.body.error).toContain('Cannot delete stage')
    expect(res.body.count).toBe(1)
  })
})
