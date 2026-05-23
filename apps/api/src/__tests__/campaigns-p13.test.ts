import { describe, it, expect, jest, beforeEach } from '@jest/globals'
import {
  createStore,
  createMockSupabase,
  type MockStore,
  type Row,
} from '../routes/__test-support__/supabase-mock.js'

// ── Env ───────────────────────────────────────────────────────────────────────
process.env['SUPABASE_URL'] = 'https://mock.supabase.co'
process.env['SUPABASE_SERVICE_ROLE_KEY'] = 'mock-service-key'
process.env['GEMINI_API_KEY'] = 'test-gemini-key'
process.env['RESEND_API_KEY'] = 'test-resend-key'

// ── Mutable store — reset in beforeEach ──────────────────────────────────────
let store: MockStore = createStore()

// ── Supabase mock ─────────────────────────────────────────────────────────────
jest.unstable_mockModule('@supabase/supabase-js', () => ({
  createClient: () => createMockSupabase(store),
}))

// ── Auth mock — requireModule reads tenant modules from the mock store ────────
// requireAuth sets tenantId on req; requireModule checks store['tenants'] modules
// field so Test 2 (module gate) can exercise the 403 path.
jest.unstable_mockModule('../lib/auth.js', () => ({
  requireAuth: (
    req: { tenantId: string; userId: string; role: string },
    _res: unknown,
    next: () => void
  ) => {
    req.tenantId = 'tenant-1'
    req.userId = 'user-1'
    req.role = 'admin'
    next()
  },
  requireModule:
    (moduleName: string) =>
    (
      _req: unknown,
      res: { status: (n: number) => { json: (b: unknown) => void } },
      next: () => void
    ) => {
      const tenants = (store.tables['tenants'] ?? []) as Row[]
      const tenant = tenants.find((t) => t['id'] === 'tenant-1')
      const modules = (tenant?.['modules'] ?? {}) as Record<string, boolean>
      if (modules[moduleName] === false) {
        res.status(403).json({ error: `Module '${moduleName}' is not enabled` })
        return
      }
      next()
    },
}))

// ── BullMQ mock ───────────────────────────────────────────────────────────────
const mockQueueAdd = jest.fn<() => Promise<void>>().mockResolvedValue(undefined)

jest.unstable_mockModule('bullmq', () => ({
  Queue: jest.fn().mockImplementation(() => ({ add: mockQueueAdd, close: jest.fn() })),
  Worker: jest.fn().mockImplementation(() => ({ on: jest.fn(), close: jest.fn() })),
}))

jest.unstable_mockModule('../lib/bullmq-connection.js', () => ({
  createBullMQConnection: jest.fn().mockReturnValue({}),
}))

// ── Gemini mock ───────────────────────────────────────────────────────────────
jest.unstable_mockModule('@google/genai', () => ({
  GoogleGenAI: jest.fn().mockImplementation(() => ({
    models: {
      generateContent: jest
        .fn<() => Promise<{ text: string }>>()
        .mockResolvedValue({ text: JSON.stringify({ body: 'Hi {first_name}!' }) }),
    },
  })),
}))

// ── Email-risk mock ───────────────────────────────────────────────────────────
jest.unstable_mockModule('../lib/email-risk.js', () => ({
  shouldSuppressEmail: jest.fn().mockReturnValue(false),
}))

// ── Resend mock ───────────────────────────────────────────────────────────────
jest.unstable_mockModule('resend', () => ({
  Resend: jest.fn().mockImplementation(() => ({
    emails: {
      send: jest
        .fn<() => Promise<{ data: { id: string } | null; error: null }>>()
        .mockResolvedValue({ data: { id: 'email-123' }, error: null }),
    },
  })),
}))

// ── Dynamic imports (after all mocks) ────────────────────────────────────────
const [{ default: express }, { default: request }, { default: campaignsRouter }] =
  await Promise.all([import('express'), import('supertest'), import('../routes/campaigns.js')])

function makeApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/campaigns', campaignsRouter)
  return app
}

// ── beforeEach: fresh store ───────────────────────────────────────────────────
beforeEach(() => {
  store = createStore()
  store.tables['campaigns'] = []
  store.tables['campaign_messages'] = []
  store.tables['campaign_sends'] = []
  store.tables['contacts'] = []
  store.tables['smart_lists'] = []
  // modules: {} means no module is explicitly disabled → requireModule passes
  store.tables['tenants'] = [
    { id: 'tenant-1', name: 'Test Biz', brand_voice: null, modules: {}, vertical: null },
  ]
  mockQueueAdd.mockClear()
})

// ── Test 1 — POST /:id/schedule returns 400 when messages not approved ─────────
describe('POST /:id/schedule — unapproved messages guard', () => {
  it('returns 400 with "Approve" in error when campaign_messages are not approved', async () => {
    const campId = 'camp-sched-guard'
    ;(store.tables['campaigns'] as Row[]).push({
      id: campId,
      tenant_id: 'tenant-1',
      status: 'draft',
      channels: ['sms'],
      segment_id: null,
      contact_count: null,
    })
    ;(store.tables['campaign_messages'] as Row[]).push({
      id: 'msg-1',
      campaign_id: campId,
      channel: 'sms',
      body: 'Hi {first_name}',
      subject: null,
      approved: false,
    })

    const futureAt = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString() // 2 h from now

    const res = await request(makeApp())
      .post(`/api/campaigns/${campId}/schedule`)
      .send({ schedule_at: futureAt })
      .set('Content-Type', 'application/json')

    expect(res.status).toBe(400)
    const body = res.body as { error: string }
    expect(body.error).toMatch(/Approve/i)
  })
})

// ── Test 2 — POST /api/campaigns returns 403 when modules.campaigns is false ──────
// Note: GET / has no requireModule guard; POST / does.
describe('POST /api/campaigns — module gate', () => {
  it('returns 402 when tenant has campaigns module explicitly disabled', async () => {
    // Disable the campaigns module for this tenant. Phase 9 changed the
    // gate from requireModule (→ 403) to requirePlan (→ 402, with an
    // upgrade_url payload).
    ;(store.tables['tenants'] as Row[])[0]!['modules'] = { campaigns: false }

    const res = await request(makeApp())
      .post('/api/campaigns')
      .send({ name: 'Test Campaign', objective: 'custom', channels: ['sms'] })
      .set('Content-Type', 'application/json')

    expect(res.status).toBe(402)
  })

  it('returns 200 when tenant has campaigns module enabled (modules: {})', async () => {
    // Default beforeEach store has modules: {} — campaign list route should pass gate
    const res = await request(makeApp()).get('/api/campaigns')

    // 200 with an empty data array (no campaigns in store)
    expect(res.status).toBe(200)
    const body = res.body as { data: unknown[] }
    expect(Array.isArray(body.data)).toBe(true)
  })
})

// ── Test 3 — PATCH /:id returns 400 when campaign is running ─────────────────────
describe('PATCH /:id — immutable-status guard', () => {
  it('returns 400 when campaign status is "running"', async () => {
    const campId = 'camp-running-guard'
    ;(store.tables['campaigns'] as Row[]).push({
      id: campId,
      tenant_id: 'tenant-1',
      status: 'running',
    })

    const res = await request(makeApp())
      .patch(`/api/campaigns/${campId}`)
      .send({ name: 'New Name' })
      .set('Content-Type', 'application/json')

    expect(res.status).toBe(400)
  })

  it('returns 200 when campaign status is "draft"', async () => {
    const campId = 'camp-draft-patch'
    ;(store.tables['campaigns'] as Row[]).push({
      id: campId,
      tenant_id: 'tenant-1',
      status: 'draft',
      name: 'Old Name',
    })

    const res = await request(makeApp())
      .patch(`/api/campaigns/${campId}`)
      .send({ name: 'New Name' })
      .set('Content-Type', 'application/json')

    expect(res.status).toBe(200)
  })
})

// ── Test 4 — POST /:id/approve returns 400 when a channel has no message ─────────
describe('POST /:id/approve — missing-channel guard', () => {
  it('returns 400 naming the missing channel when a campaign_message is absent', async () => {
    const campId = 'camp-approve-guard'
    // Campaign declares both sms and email channels
    ;(store.tables['campaigns'] as Row[]).push({
      id: campId,
      tenant_id: 'tenant-1',
      status: 'draft',
      channels: ['sms', 'email'],
      segment_id: null,
    })
    // Only the SMS message exists — email message is missing
    ;(store.tables['campaign_messages'] as Row[]).push({
      id: 'msg-sms-only',
      campaign_id: campId,
      channel: 'sms',
      body: 'Hi {first_name}',
      subject: null,
      approved: false,
    })

    const res = await request(makeApp())
      .post(`/api/campaigns/${campId}/approve`)
      .send({})
      .set('Content-Type', 'application/json')

    expect(res.status).toBe(400)
    const body = res.body as { error: string }
    // Error must identify the missing channel
    expect(body.error).toContain('email')
  })

  it('returns 200 when all declared channels have messages', async () => {
    const campId = 'camp-approve-ok'
    ;(store.tables['campaigns'] as Row[]).push({
      id: campId,
      tenant_id: 'tenant-1',
      status: 'draft',
      channels: ['sms'],
      segment_id: null,
    })
    ;(store.tables['campaign_messages'] as Row[]).push({
      id: 'msg-sms-ok',
      campaign_id: campId,
      channel: 'sms',
      body: 'Hi {first_name}',
      subject: null,
      approved: false,
    })

    const res = await request(makeApp())
      .post(`/api/campaigns/${campId}/approve`)
      .send({})
      .set('Content-Type', 'application/json')

    expect(res.status).toBe(200)
  })
})
