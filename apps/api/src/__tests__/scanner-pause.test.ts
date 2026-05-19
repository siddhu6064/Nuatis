import { describe, it, expect, jest, beforeEach } from '@jest/globals'
import {
  createStore,
  createMockSupabase,
  type MockStore,
} from '../routes/__test-support__/supabase-mock.js'

// ── Env vars ──────────────────────────────────────────────────────────────────
process.env['SUPABASE_URL'] = 'https://mock.supabase.co'
process.env['SUPABASE_SERVICE_ROLE_KEY'] = 'mock-service-key'
process.env['REDIS_URL'] = 'redis://localhost:6379'

// ── BullMQ mock ───────────────────────────────────────────────────────────────
const mockQueue = {
  getJobCounts: jest.fn(),
  getFailed: jest.fn(),
  getCompleted: jest.fn(),
  close: jest.fn(),
  clean: jest.fn(),
}

jest.unstable_mockModule('bullmq', () => ({
  Queue: jest.fn().mockImplementation(() => mockQueue),
}))

jest.unstable_mockModule('../lib/bullmq-connection.js', () => ({
  createBullMQConnection: jest.fn().mockReturnValue({}),
}))

// ── Supabase mock ─────────────────────────────────────────────────────────────
let store: MockStore = createStore()

jest.unstable_mockModule('@supabase/supabase-js', () => ({
  createClient: () => createMockSupabase(store),
}))

// ── Auth mock ─────────────────────────────────────────────────────────────────
jest.unstable_mockModule('../lib/auth.js', () => ({
  requireAuth: (req: Record<string, unknown>, _res: unknown, next: () => void) => {
    req['tenantId'] = 'test-tenant-id'
    next()
  },
}))

// ── Dynamic imports (after all mocks) ────────────────────────────────────────
const [
  { default: express },
  { default: request },
  { default: automationOverviewRouter },
  { isScannerPaused },
] = await Promise.all([
  import('express'),
  import('supertest'),
  import('../routes/automation-overview.js'),
  import('../lib/scanner-pause.js'),
])

function makeApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/automation', automationOverviewRouter)
  return app
}

beforeEach(() => {
  store = createStore()
  store.tables['audit_log'] = []
  store.tables['scanner_pauses'] = []

  mockQueue.getJobCounts.mockReset()
  mockQueue.getFailed.mockReset()
  mockQueue.getCompleted.mockReset()
  mockQueue.close.mockReset()
  mockQueue.clean.mockReset()

  mockQueue.close.mockResolvedValue(undefined)
  mockQueue.getJobCounts.mockResolvedValue({
    waiting: 0,
    active: 0,
    completed: 0,
    failed: 0,
    paused: 0,
  })
  mockQueue.getFailed.mockResolvedValue([])
  mockQueue.getCompleted.mockResolvedValue([])
})

// ── Test 1: isScannerPaused returns false when no active pause row ─────────────
describe('isScannerPaused', () => {
  it('returns false when Supabase returns null (no active pause row)', async () => {
    // scanner_pauses table is empty — maybeSingle() will return { data: null, error: null }
    store.tables['scanner_pauses'] = []
    const result = await isScannerPaused('test-tenant-id', 'lead-stalled-scanner')
    expect(result).toBe(false)
  })

  // ── Test 2: isScannerPaused returns true when active pause row exists ─────────
  it('returns true when Supabase returns an active pause row', async () => {
    const now = new Date()
    const from = new Date(now.getTime() - 60 * 60 * 1000).toISOString() // 1 hour ago
    const until = new Date(now.getTime() + 60 * 60 * 1000).toISOString() // 1 hour from now
    store.tables['scanner_pauses'] = [
      {
        id: 'pause-1',
        tenant_id: 'test-tenant-id',
        scanner_key: 'lead-stalled-scanner',
        paused_from: from,
        paused_until: until,
        reason: null,
        created_at: from,
      },
    ]
    const result = await isScannerPaused('test-tenant-id', 'lead-stalled-scanner')
    expect(result).toBe(true)
  })

  // ── Test 3: isScannerPaused returns false when Supabase returns an error ──────
  it('returns false when Supabase returns an error (does not throw)', async () => {
    store.tables['scanner_pauses'] = []
    store.tableErrors = { scanner_pauses: { message: 'DB error' } }
    const result = await isScannerPaused('test-tenant-id', 'lead-stalled-scanner')
    expect(result).toBe(false)
    // Clean up so subsequent tests are unaffected
    store.tableErrors = {}
  })
})

// ── Test 3: POST /pause returns 400 when paused_until < paused_from ───────────
describe('POST /api/automation/scanners/:key/pause', () => {
  it('returns 400 when paused_until is before paused_from (invalid range)', async () => {
    const from = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString() // 2 hours from now
    const until = new Date(Date.now() + 1 * 60 * 60 * 1000).toISOString() // 1 hour from now (before from)
    const res = await request(makeApp())
      .post('/api/automation/scanners/lead-stalled-scanner/pause')
      .send({ paused_from: from, paused_until: until })
      .expect(400)
    expect(res.body).toMatchObject({ error: expect.any(String) })
  })

  // ── Test 4: POST /pause returns 400 when range exceeds 90 days ───────────────
  it('returns 400 when pause range exceeds 90 days', async () => {
    const from = new Date().toISOString()
    const until = new Date(Date.now() + 91 * 24 * 60 * 60 * 1000).toISOString() // 91 days
    const res = await request(makeApp())
      .post('/api/automation/scanners/lead-stalled-scanner/pause')
      .send({ paused_from: from, paused_until: until })
      .expect(400)
    expect(res.body).toMatchObject({ error: expect.any(String) })
  })

  // ── Test 5: POST /pause returns ScannerPause shape on valid input ─────────────
  it('returns 201/200 with ScannerPause shape on valid input', async () => {
    const from = new Date().toISOString()
    const until = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString() // 7 days from now
    const res = await request(makeApp())
      .post('/api/automation/scanners/lead-stalled-scanner/pause')
      .send({ paused_from: from, paused_until: until, reason: 'vacation' })
    expect(res.status).toBeGreaterThanOrEqual(200)
    expect(res.status).toBeLessThan(300)
    expect(res.body).toMatchObject({
      id: expect.any(String),
      scanner_key: 'lead-stalled-scanner',
      paused_from: expect.any(String),
      paused_until: expect.any(String),
    })
    // Verify the row was seeded into the store
    expect(store.tables['scanner_pauses']?.length).toBeGreaterThanOrEqual(1)
  })

  // ── Test 6: POST /pause returns 400 for unknown scanner key ──────────────────
  it('returns 400 for unknown scanner key', async () => {
    const from = new Date().toISOString()
    const until = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
    const res = await request(makeApp())
      .post('/api/automation/scanners/unknown-scanner/pause')
      .send({ paused_from: from, paused_until: until })
      .expect(400)
    expect(res.body).toMatchObject({ error: expect.any(String) })
  })
})

// ── Test 7: DELETE /pause returns { cancelled: 0 } when no active pause ───────
describe('DELETE /api/automation/scanners/:key/pause', () => {
  it('returns { cancelled: 0 } when no active pause exists', async () => {
    // scanner_pauses table is empty — delete returns empty array
    store.tables['scanner_pauses'] = []
    const res = await request(makeApp())
      .delete('/api/automation/scanners/lead-stalled-scanner/pause')
      .expect(200)
    expect(res.body).toMatchObject({ cancelled: 0 })
  })

  // ── Test 8: DELETE /pause returns { cancelled: 1 } when active pause exists ──
  it('returns { cancelled: 1 } when an active pause row exists', async () => {
    const now = new Date()
    const from = new Date(now.getTime() - 60 * 60 * 1000).toISOString() // 1 hour ago
    const until = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString() // 1 day from now
    store.tables['scanner_pauses'] = [
      {
        id: 'pause-active-1',
        tenant_id: 'test-tenant-id',
        scanner_key: 'lead-stalled-scanner',
        paused_from: from,
        paused_until: until,
        reason: null,
        created_at: from,
      },
    ]
    const res = await request(makeApp())
      .delete('/api/automation/scanners/lead-stalled-scanner/pause')
      .expect(200)
    expect(res.body).toMatchObject({ cancelled: 1 })
  })

  // ── Test 9: DELETE /pause returns 400 for unknown scanner key ────────────────
  it('returns 400 for unknown scanner key', async () => {
    const res = await request(makeApp())
      .delete('/api/automation/scanners/unknown-scanner/pause')
      .expect(400)
    expect(res.body).toMatchObject({ error: expect.any(String) })
  })
})

// ── GET /scanners/:key/pause describe block ────────────────────────────────────
describe('GET /api/automation/scanners/:key/pause', () => {
  // ── Test 10: returns { active: false } when no active pause ──────────────────
  it('returns { active: false } when no active pause exists', async () => {
    store.tables['scanner_pauses'] = []
    const res = await request(makeApp())
      .get('/api/automation/scanners/lead-stalled-scanner/pause')
      .expect(200)
    expect(res.body).toMatchObject({ active: false })
  })

  // ── Test 11: returns { active: true } with pause data when active pause ───────
  it('returns { active: true } with pause data when active pause exists', async () => {
    const now = new Date()
    const from = new Date(now.getTime() - 60 * 60 * 1000).toISOString() // 1 hour ago
    const until = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString() // 1 day from now
    store.tables['scanner_pauses'] = [
      {
        id: 'pause-get-1',
        tenant_id: 'test-tenant-id',
        scanner_key: 'lead-stalled-scanner',
        paused_from: from,
        paused_until: until,
        reason: 'maintenance',
        created_at: from,
      },
    ]
    const res = await request(makeApp())
      .get('/api/automation/scanners/lead-stalled-scanner/pause')
      .expect(200)
    expect(res.body).toMatchObject({
      active: true,
      id: 'pause-get-1',
      paused_from: expect.any(String),
      paused_until: expect.any(String),
    })
  })
})
