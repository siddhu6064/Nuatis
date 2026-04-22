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
const queueAdd = jest.fn(async () => undefined)

jest.unstable_mockModule('@supabase/supabase-js', () => ({
  createClient: () => createMockSupabase(store),
}))
jest.unstable_mockModule('../workers/export-worker.js', () => ({
  getExportQueue: () => ({ add: queueAdd }),
}))

const TENANT_ID = 'aaaaaaaa-0000-0000-0000-00000de00001'
const USER_ID = 'user-de-001'
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

const { default: express } = await import('express')
const { default: request } = await import('supertest')
const { default: dataExportRouter } = await import('./data-export.js')

function makeApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/settings/data-export', dataExportRouter)
  return app
}

beforeEach(() => {
  store = createStore()
  store.tables['export_jobs'] = []
  queueAdd.mockClear()
})

describe('POST /api/settings/data-export', () => {
  it('enqueues export job and returns 201 with exportJobId', async () => {
    const token = await makeToken()

    const res = await request(makeApp())
      .post('/api/settings/data-export')
      .set('Authorization', `Bearer ${token}`)
      .send({ tables: ['contacts', 'tasks'] })

    expect(res.status).toBe(201)
    expect(res.body.exportJobId).toBeDefined()
    expect(res.body.status).toBe('pending')
    expect(queueAdd).toHaveBeenCalledTimes(1)
  })
})

describe('GET /api/settings/data-export', () => {
  it('returns list of export jobs for tenant', async () => {
    ;(store.tables['export_jobs'] as Row[]).push({
      id: randomUUID(),
      tenant_id: TENANT_ID,
      status: 'completed',
      tables_included: ['contacts'],
      created_at: new Date().toISOString(),
    })
    const token = await makeToken()

    const res = await request(makeApp())
      .get('/api/settings/data-export')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(Array.isArray(res.body.exports)).toBe(true)
    expect(res.body.exports.length).toBe(1)
  })
})

describe('GET /api/settings/data-export/:id/download', () => {
  it('redirects (302) to download_url for completed job', async () => {
    const jobId = randomUUID()
    const futureIso = new Date(Date.now() + 86400000).toISOString()
    ;(store.tables['export_jobs'] as Row[]).push({
      id: jobId,
      tenant_id: TENANT_ID,
      status: 'completed',
      file_path: `exports/${TENANT_ID}/${jobId}.csv.gz`,
      download_url: 'https://signed.url/test-download',
      expires_at: futureIso,
    })
    const token = await makeToken()

    const res = await request(makeApp())
      .get(`/api/settings/data-export/${jobId}/download`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(302)
    expect(res.headers.location).toBe('https://signed.url/test-download')
  })
})
