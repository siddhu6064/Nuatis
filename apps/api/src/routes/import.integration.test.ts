import { jest, describe, it, expect, beforeEach } from '@jest/globals'
import { SignJWT } from 'jose'
import {
  createStore,
  createMockSupabase,
  type MockStore,
} from './__test-support__/supabase-mock.js'

let store: MockStore = createStore()
const queueAdd = jest.fn(async () => undefined)
const logActivity = jest.fn(async () => undefined)

jest.unstable_mockModule('@supabase/supabase-js', () => ({
  createClient: () => createMockSupabase(store),
}))
jest.unstable_mockModule('../workers/csv-import-worker.js', () => ({
  getCsvImportQueue: () => ({ add: queueAdd }),
}))
jest.unstable_mockModule('../lib/activity.js', () => ({ logActivity }))

const TENANT_ID = 'aaaaaaaa-0000-0000-0000-00000im00001'
const USER_ID = 'user-im-001'
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

const [{ default: express }, { default: request }, { default: importRouter }] = await Promise.all([
  import('express'),
  import('supertest'),
  import('./import.js'),
])

function makeApp() {
  const app = express()
  app.use(express.json({ limit: '10mb' }))
  app.use('/api/import', importRouter)
  return app
}

beforeEach(() => {
  store = createStore()
  store.tables['contacts'] = []
  store.tables['import_jobs'] = []
  queueAdd.mockClear()
  logActivity.mockClear()
})

describe('POST /api/import/contacts', () => {
  it('processes sync import (<=100 rows) and returns imported + skipped counts directly', async () => {
    const token = await makeToken()
    const rows = [
      { full_name: 'Sync One', phone: '+15125550101' },
      { full_name: 'Sync Two', phone: '+15125550102' },
      { full_name: 'Sync Three', phone: '+15125550103' },
    ]

    const res = await request(makeApp())
      .post('/api/import/contacts')
      .set('Authorization', `Bearer ${token}`)
      .send({
        rows,
        mapping: { full_name: 'name', phone: 'phone' },
        options: { skip_duplicates: true, update_existing: false },
      })

    expect(res.status).toBe(200)
    expect(typeof res.body.imported).toBe('number')
    expect(typeof res.body.skipped).toBe('number')
    expect(queueAdd).not.toHaveBeenCalled()
  })

  it('enqueues async import (>100 rows) and returns job_id with status processing', async () => {
    const token = await makeToken()
    const rows = Array.from({ length: 101 }, (_, i) => ({
      full_name: `Async Person ${i}`,
    }))

    const res = await request(makeApp())
      .post('/api/import/contacts')
      .set('Authorization', `Bearer ${token}`)
      .send({
        rows,
        mapping: { full_name: 'name' },
        options: { skip_duplicates: true, update_existing: false },
      })

    expect(res.status).toBe(200)
    expect(res.body.job_id).toBeDefined()
    expect(res.body.status).toBe('processing')
    expect(queueAdd).toHaveBeenCalledTimes(1)
  })

  it('returns 400 when rows array is missing', async () => {
    const token = await makeToken()

    const res = await request(makeApp())
      .post('/api/import/contacts')
      .set('Authorization', `Bearer ${token}`)
      .send({ mapping: { full_name: 'name' } })

    expect(res.status).toBe(400)
  })
})
