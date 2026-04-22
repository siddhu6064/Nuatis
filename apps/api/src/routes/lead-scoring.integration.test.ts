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
const bulkQueueAdd = jest.fn(async () => undefined)
const getLeadScoreBulkQueue = jest.fn(() => ({ add: bulkQueueAdd }))

jest.unstable_mockModule('@supabase/supabase-js', () => ({
  createClient: () => createMockSupabase(store),
}))
jest.unstable_mockModule('../lib/lead-score-queue.js', () => ({
  getLeadScoreBulkQueue,
  getLeadScoreQueue: () => ({ add: async () => undefined }),
  enqueueScoreCompute: () => undefined,
}))

const TENANT_ID = 'aaaaaaaa-0000-0000-0000-00000ls00001'
const USER_ID = 'user-ls-001'
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

const [{ default: express }, { default: request }, { default: leadScoringRouter }] =
  await Promise.all([import('express'), import('supertest'), import('./lead-scoring.js')])

function makeApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/lead-scoring', leadScoringRouter)
  return app
}

beforeEach(() => {
  store = createStore()
  store.tables['lead_scoring_rules'] = []
  store.tables['contacts'] = []
  bulkQueueAdd.mockClear()
  getLeadScoreBulkQueue.mockClear()
  getLeadScoreBulkQueue.mockReturnValue({ add: bulkQueueAdd })
})

describe('POST /api/lead-scoring/rules', () => {
  it('creates rule and returns 201 with id', async () => {
    const token = await makeToken()
    const res = await request(makeApp())
      .post('/api/lead-scoring/rules')
      .set('Authorization', `Bearer ${token}`)
      .send({
        category: 'engagement',
        rule_key: 'appointment_booked',
        label: 'Appointment Booked',
        points: 20,
      })

    expect(res.status).toBe(201)
    expect(res.body.id).toBeDefined()
    expect(res.body.rule_key).toBe('appointment_booked')
    expect(res.body.points).toBe(20)
  })

  it('returns 400 when category is invalid', async () => {
    const token = await makeToken()
    const res = await request(makeApp())
      .post('/api/lead-scoring/rules')
      .set('Authorization', `Bearer ${token}`)
      .send({
        category: 'not_a_real_category',
        rule_key: 'test',
        label: 'Test',
        points: 10,
      })

    expect(res.status).toBe(400)
  })
})

describe('POST /api/lead-scoring/rescore-all', () => {
  it('enqueues bulk job and returns message', async () => {
    ;(store.tables['contacts'] as Row[]).push({
      id: randomUUID(),
      tenant_id: TENANT_ID,
      full_name: 'Pat',
      is_archived: false,
    })
    const token = await makeToken()

    const res = await request(makeApp())
      .post('/api/lead-scoring/rescore-all')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.message).toContain('Re-scoring started')
    expect(bulkQueueAdd).toHaveBeenCalledTimes(1)
  })
})

describe('GET /api/lead-scoring/distribution', () => {
  it('returns distribution envelope with A/B/C/D/F + average/median/total', async () => {
    ;(store.tables['contacts'] as Row[]).push(
      {
        id: randomUUID(),
        tenant_id: TENANT_ID,
        lead_score: 90,
        lead_grade: 'A',
        is_archived: false,
      },
      {
        id: randomUUID(),
        tenant_id: TENANT_ID,
        lead_score: 60,
        lead_grade: 'C',
        is_archived: false,
      }
    )
    const token = await makeToken()

    const res = await request(makeApp())
      .get('/api/lead-scoring/distribution')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.distribution).toBeDefined()
    expect(res.body.distribution).toHaveProperty('A')
    expect(res.body.distribution).toHaveProperty('B')
    expect(res.body.distribution).toHaveProperty('C')
    expect(res.body.distribution).toHaveProperty('D')
    expect(res.body.distribution).toHaveProperty('F')
    expect(typeof res.body.average).toBe('number')
    expect(typeof res.body.median).toBe('number')
    expect(typeof res.body.total).toBe('number')
  })
})
