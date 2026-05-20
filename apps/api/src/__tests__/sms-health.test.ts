import { jest, describe, it, expect, beforeEach } from '@jest/globals'
import {
  createStore,
  createMockSupabase,
  type MockStore,
} from '../routes/__test-support__/supabase-mock.js'

// ── Env ───────────────────────────────────────────────────────────────────────
process.env['SUPABASE_URL'] = 'https://mock.supabase.co'
process.env['SUPABASE_SERVICE_ROLE_KEY'] = 'mock-service-key'

// ── Mocks ─────────────────────────────────────────────────────────────────────
let store: MockStore = createStore()

jest.unstable_mockModule('@supabase/supabase-js', () => ({
  createClient: () => createMockSupabase(store),
}))

jest.unstable_mockModule('../lib/auth.js', () => ({
  requireAuth: (req: Record<string, unknown>, _res: unknown, next: () => void) => {
    req['tenantId'] = TENANT_ID
    req['userId'] = 'user-1'
    next()
  },
}))

// ── Dynamic imports ───────────────────────────────────────────────────────────
const [{ default: express }, { default: request }, { default: smsHealthRouter }] =
  await Promise.all([import('express'), import('supertest'), import('../routes/sms-health.js')])

// ── Constants ─────────────────────────────────────────────────────────────────
const TENANT_ID = 'aaaaaaaa-0000-0000-0000-smshealth001'

function makeApp() {
  const app = express()
  app.use(express.json())
  app.use('/', smsHealthRouter)
  return app
}

/** Returns an ISO string for `daysAgo` days in the past (within the last 30 days) */
function daysAgo(n: number): string {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString()
}

// ── Tests ─────────────────────────────────────────────────────────────────────
describe('GET /health — sms-health route', () => {
  beforeEach(() => {
    store = createStore()
  })

  it('GET /api/sms/health returns expected shape with all required keys', async () => {
    // Seed 3 delivered + 1 failed outbound messages within last 30 days
    store.tables['sms_messages'] = [
      {
        id: 'msg-1',
        tenant_id: TENANT_ID,
        direction: 'outbound',
        status: 'delivered',
        created_at: daysAgo(2),
      },
      {
        id: 'msg-2',
        tenant_id: TENANT_ID,
        direction: 'outbound',
        status: 'delivered',
        created_at: daysAgo(5),
      },
      {
        id: 'msg-3',
        tenant_id: TENANT_ID,
        direction: 'outbound',
        status: 'delivered',
        created_at: daysAgo(10),
      },
      {
        id: 'msg-4',
        tenant_id: TENANT_ID,
        direction: 'outbound',
        status: 'failed',
        created_at: daysAgo(3),
      },
    ]
    store.tables['contacts'] = [{ id: 'c-1', tenant_id: TENANT_ID, sms_opt_in: false }]
    store.tables['sms_delivery_errors'] = []

    const res = await request(makeApp()).get('/health')
    expect(res.status).toBe(200)

    const body = res.body as Record<string, unknown>
    expect(body).toHaveProperty('period_days')
    expect(body).toHaveProperty('total_sent')
    expect(body).toHaveProperty('total_delivered')
    expect(body).toHaveProperty('total_failed')
    expect(body).toHaveProperty('total_opted_out')
    expect(body).toHaveProperty('delivery_rate')
    expect(body).toHaveProperty('failure_rate')
    expect(body).toHaveProperty('error_breakdown')
    expect(body).toHaveProperty('trend_7d')
    expect(body).toHaveProperty('alert')
    expect(body['alert']).toHaveProperty('level')
    expect(body['alert']).toHaveProperty('message')
  })

  it("alert.level is 'critical' when failure_rate > 10", async () => {
    // 10 sent, 9 failed → failure_rate = 90% (> 10%)
    store.tables['sms_messages'] = [
      ...Array.from({ length: 9 }, (_, i) => ({
        id: `msg-fail-${i}`,
        tenant_id: TENANT_ID,
        direction: 'outbound',
        status: 'failed',
        created_at: daysAgo(i + 1),
      })),
      {
        id: 'msg-delivered-1',
        tenant_id: TENANT_ID,
        direction: 'outbound',
        status: 'delivered',
        created_at: daysAgo(1),
      },
    ]
    store.tables['contacts'] = []
    store.tables['sms_delivery_errors'] = []

    const res = await request(makeApp()).get('/health')
    expect(res.status).toBe(200)

    const alert = (res.body as { alert: { level: string; message: string } }).alert
    expect(alert.level).toBe('critical')
    expect(alert.message).toContain('check 10DLC')
  })

  it("alert.level is 'warning' when failure_rate > 5 and ≤ 10", async () => {
    // 20 sent, 1 failed → failure_rate = 5% ... need > 5 so use 20 sent, 2 failed = 10% exactly → that's not > 10 but is > 5
    // Actually 2/20 = 10% which is exactly 10. The route checks > 10 for critical, > 5 for warning.
    // 10% is NOT > 10, so it falls to the warning branch (> 5). Let's use 20 sent, 2 failed = 10%.
    // Wait: Math.round(2/20 * 1000)/10 = Math.round(100)/10 = 10.0 → failureRate = 10.0 → not > 10 → check > 5 → yes → warning
    store.tables['sms_messages'] = [
      ...Array.from({ length: 2 }, (_, i) => ({
        id: `msg-fail-${i}`,
        tenant_id: TENANT_ID,
        direction: 'outbound',
        status: 'failed',
        created_at: daysAgo(i + 1),
      })),
      ...Array.from({ length: 18 }, (_, i) => ({
        id: `msg-delivered-${i}`,
        tenant_id: TENANT_ID,
        direction: 'outbound',
        status: 'delivered',
        created_at: daysAgo(i + 1),
      })),
    ]
    store.tables['contacts'] = []
    store.tables['sms_delivery_errors'] = []

    const res = await request(makeApp()).get('/health')
    expect(res.status).toBe(200)

    const alert = (res.body as { alert: { level: string; message: string } }).alert
    expect(alert.level).toBe('warning')
    expect(alert.message).toContain('monitor closely')
  })

  it("alert.level is 'ok' when failure_rate ≤ 5", async () => {
    // 10 sent, 0 failed → failure_rate = 0%
    store.tables['sms_messages'] = Array.from({ length: 10 }, (_, i) => ({
      id: `msg-delivered-${i}`,
      tenant_id: TENANT_ID,
      direction: 'outbound',
      status: 'delivered',
      created_at: daysAgo(i + 1),
    }))
    store.tables['contacts'] = []
    store.tables['sms_delivery_errors'] = []

    const res = await request(makeApp()).get('/health')
    expect(res.status).toBe(200)

    const alert = (res.body as { alert: { level: string; message: string | null } }).alert
    expect(alert.level).toBe('ok')
    expect(alert.message).toBeNull()
  })

  it('trend_7d has exactly 7 entries', async () => {
    store.tables['sms_messages'] = [
      {
        id: 'msg-trend-1',
        tenant_id: TENANT_ID,
        direction: 'outbound',
        status: 'delivered',
        created_at: daysAgo(1),
      },
    ]
    store.tables['contacts'] = []
    store.tables['sms_delivery_errors'] = []

    const res = await request(makeApp()).get('/health')
    expect(res.status).toBe(200)

    const trend7d = (res.body as { trend_7d: unknown[] }).trend_7d
    expect(trend7d).toHaveLength(7)
  })
})
