import { describe, it, expect, jest, beforeEach } from '@jest/globals'
import {
  createStore,
  createMockSupabase,
  type MockStore,
} from '../routes/__test-support__/supabase-mock.js'
import { seedEntitledTenant } from '../routes/__test-support__/tenant-fixture.js'

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
const [{ default: express }, { default: request }, { default: automationOverviewRouter }] =
  await Promise.all([
    import('express'),
    import('supertest'),
    import('../routes/automation-overview.js'),
  ])

function makeApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/automation', automationOverviewRouter)
  return app
}

beforeEach(() => {
  store = createStore()
  seedEntitledTenant(store, 'test-tenant-id')
  store.tables['audit_log'] = []

  mockQueue.getJobCounts.mockReset()
  mockQueue.getFailed.mockReset()
  mockQueue.getCompleted.mockReset()
  mockQueue.close.mockReset()
  mockQueue.clean.mockReset()

  mockQueue.close.mockResolvedValue(undefined)
})

// ── Test 1: GET /api/automation/overview returns expected shape ────────────────
describe('GET /api/automation/overview', () => {
  it('returns expected shape with scanners, enrollments_chart, trigger_analysis, totals', async () => {
    mockQueue.getJobCounts.mockResolvedValue({
      waiting: 0,
      active: 0,
      completed: 5,
      failed: 0,
      paused: 0,
    })
    mockQueue.getFailed.mockResolvedValue([])
    mockQueue.getCompleted.mockResolvedValue([{ finishedOn: Date.now() }])

    const res = await request(makeApp()).get('/api/automation/overview')

    expect(res.status).toBe(200)

    const body = res.body as {
      scanners: unknown[]
      enrollments_chart: unknown[]
      trigger_analysis: { attempted: number; matched: number; unmatched: number }
      total_active: number
      total_paused: number
    }

    expect(Array.isArray(body.scanners)).toBe(true)
    expect(body.scanners).toHaveLength(7)

    expect(Array.isArray(body.enrollments_chart)).toBe(true)

    expect(body.trigger_analysis).toBeDefined()
    expect(typeof body.trigger_analysis.attempted).toBe('number')
    expect(typeof body.trigger_analysis.matched).toBe('number')
    expect(typeof body.trigger_analysis.unmatched).toBe('number')

    expect(typeof body.total_active).toBe('number')
    expect(typeof body.total_paused).toBe('number')
  })

  // ── Test 2: enrollments_chart has at most 7 entries ───────────────────────
  it('enrollments_chart has at most 7 entries', async () => {
    mockQueue.getJobCounts.mockResolvedValue({
      waiting: 0,
      active: 0,
      completed: 5,
      failed: 0,
      paused: 0,
    })
    mockQueue.getFailed.mockResolvedValue([])
    mockQueue.getCompleted.mockResolvedValue([{ finishedOn: Date.now() }])

    const res = await request(makeApp()).get('/api/automation/overview')

    expect(res.status).toBe(200)
    const body = res.body as { enrollments_chart: unknown[] }
    expect(body.enrollments_chart.length).toBeLessThanOrEqual(7)
  })

  // ── Test 3: total_active + total_paused === scanners without error status ──
  it('total_active + total_paused equals scanners with non-error status', async () => {
    mockQueue.getJobCounts.mockResolvedValue({
      waiting: 0,
      active: 0,
      completed: 3,
      failed: 0,
      paused: 0,
    })
    mockQueue.getFailed.mockResolvedValue([])
    mockQueue.getCompleted.mockResolvedValue([])

    const res = await request(makeApp()).get('/api/automation/overview')

    expect(res.status).toBe(200)
    const body = res.body as {
      scanners: Array<{ status: string }>
      total_active: number
      total_paused: number
    }

    const nonErrorCount = body.scanners.filter((s) => s.status !== 'error').length
    expect(body.total_active + body.total_paused).toBe(nonErrorCount)
  })
})

// ── Test 4: POST /api/automation/scanners/invalid-key/retry-failed → 400 ──────
describe('POST /api/automation/scanners/:key/retry-failed', () => {
  it('POST /api/automation/scanners/invalid-key/retry-failed returns 400', async () => {
    const app = makeApp()
    const res = await request(app)
      .post('/api/automation/scanners/invalid-key/retry-failed')
      .expect(400)
    expect(res.body).toMatchObject({ error: expect.any(String) })
  })
})

// ── Test 5: POST /api/automation/scanners/:key/clear-failed → { cleared: n } ──
describe('POST /api/automation/scanners/:key/clear-failed', () => {
  it('POST /api/automation/scanners/:key/clear-failed returns { cleared: number }', async () => {
    mockQueue.clean.mockResolvedValue(['job1', 'job2', 'job3'])
    const app = makeApp()
    const res = await request(app)
      .post('/api/automation/scanners/lead-stalled-scanner/clear-failed')
      .expect(200)
    expect(res.body).toMatchObject({ cleared: 3 })
  })
})
