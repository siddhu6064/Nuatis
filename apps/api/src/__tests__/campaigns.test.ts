import { describe, it, expect, jest, beforeEach } from '@jest/globals'
import {
  createStore,
  createMockSupabase,
  type MockStore,
  type Row,
} from '../routes/__test-support__/supabase-mock.js'
import { seedEntitledTenant } from '../routes/__test-support__/tenant-fixture.js'

// ── Env vars ──────────────────────────────────────────────────────────────────
process.env['SUPABASE_URL'] = 'https://mock.supabase.co'
process.env['SUPABASE_SERVICE_ROLE_KEY'] = 'mock-service-key'
process.env['GEMINI_API_KEY'] = 'test-gemini-key'
process.env['RESEND_API_KEY'] = 'test-resend-key'

// ── Shared mock store ─────────────────────────────────────────────────────────
let store: MockStore = createStore()

// ── Supabase mock ─────────────────────────────────────────────────────────────
jest.unstable_mockModule('@supabase/supabase-js', () => ({
  createClient: () => createMockSupabase(store),
}))

// ── Auth mock ─────────────────────────────────────────────────────────────────
jest.unstable_mockModule('../lib/auth.js', () => ({
  requireAuth: (
    _req: { tenantId: string; userId: string; role: string },
    _res: unknown,
    next: () => void
  ) => {
    _req.tenantId = 'tenant-1'
    _req.userId = 'user-1'
    _req.role = 'admin'
    next()
  },
  requireModule: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}))

// ── BullMQ mock ───────────────────────────────────────────────────────────────
const mockQueueAdd = jest.fn<() => Promise<void>>().mockResolvedValue(undefined)
const mockQueueClose = jest.fn<() => Promise<void>>().mockResolvedValue(undefined)

jest.unstable_mockModule('bullmq', () => ({
  Queue: jest.fn().mockImplementation(() => ({
    add: mockQueueAdd,
    close: mockQueueClose,
  })),
  Worker: jest.fn().mockImplementation(() => ({
    on: jest.fn(),
    close: jest.fn(),
  })),
}))

// ── BullMQ connection mock ────────────────────────────────────────────────────
jest.unstable_mockModule('../lib/bullmq-connection.js', () => ({
  createBullMQConnection: jest.fn().mockReturnValue({}),
}))

// ── Gemini mock ───────────────────────────────────────────────────────────────
jest.unstable_mockModule('@google/genai', () => ({
  GoogleGenAI: jest.fn().mockImplementation(() => ({
    models: {
      generateContent: jest.fn<() => Promise<{ text: string }>>().mockResolvedValue({
        text: '{"subject": "Re-engage now!", "body_html": "<h1>Hello</h1>", "body_text": "Hello"}',
      }),
    },
  })),
}))

// ── shouldSuppressEmail mock ──────────────────────────────────────────────────
jest.unstable_mockModule('../lib/email-risk.js', () => ({
  shouldSuppressEmail: jest.fn().mockImplementation((contact: { email_status: string | null }) => {
    return contact.email_status === 'hard_bounce'
  }),
}))

// ── Resend mock ───────────────────────────────────────────────────────────────
jest.unstable_mockModule('resend', () => ({
  Resend: jest.fn().mockImplementation(() => ({
    emails: {
      send: jest
        .fn<() => Promise<{ data: { id: string } | null; error: null }>>()
        .mockResolvedValue({
          data: { id: 'email-123' },
          error: null,
        }),
    },
  })),
}))

// ── Dynamic imports (after mocks) ─────────────────────────────────────────────
const [{ default: express }, { default: request }, { default: campaignsRouter }] =
  await Promise.all([import('express'), import('supertest'), import('../routes/campaigns.js')])

function makeApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/campaigns', campaignsRouter)
  return app
}

// ── beforeEach: reset store ───────────────────────────────────────────────────
beforeEach(() => {
  store = createStore()
  store.tables['campaigns'] = []
  store.tables['campaign_recipients'] = []
  seedEntitledTenant(store, 'tenant-1')
  store.tables['smart_lists'] = [
    { id: 'sl-1', tenant_id: 'tenant-1', name: 'All Contacts', filters: {} },
  ]
  store.tables['contacts'] = []
  mockQueueAdd.mockClear()
  mockQueueClose.mockClear()
})

// ── Test 1: POST /api/campaigns creates draft with correct defaults ────────────
describe('POST /api/campaigns', () => {
  it('creates draft campaign with correct defaults', async () => {
    const res = await request(makeApp())
      .post('/api/campaigns')
      .send({ name: 'Test Campaign', type: 'email' })
      .set('Content-Type', 'application/json')

    expect(res.status).toBeGreaterThanOrEqual(200)
    expect(res.status).toBeLessThan(300)
    expect(res.body).toHaveProperty('campaign')
    const campaign = res.body.campaign as { status: string; type: string; name: string }
    expect(campaign.status).toBe('draft')
    expect(campaign.type).toBe('email')
    expect(campaign.name).toBe('Test Campaign')
  })
})

// ── Helpers for the P13 /send-now + /schedule suite ──────────────────────────
// Seed a draft campaign + one campaign_messages row directly in the store.
function seedCampaign(
  id: string,
  opts: { status?: string; approved?: boolean; segment_id?: string | null } = {}
): void {
  ;(store.tables['campaigns'] as Row[]).push({
    id,
    tenant_id: 'tenant-1',
    status: opts.status ?? 'draft',
    channels: ['sms'],
    segment_id: opts.segment_id ?? null,
    contact_count: null,
  })
  store.tables['campaign_messages'] = (store.tables['campaign_messages'] as Row[]) ?? []
  ;(store.tables['campaign_messages'] as Row[]).push({
    id: `${id}-msg`,
    campaign_id: id,
    channel: 'sms',
    subject: null,
    body: 'Hi {first_name}',
    approved: opts.approved ?? true,
  })
}

// ── Test 2: /send-now on an approved draft → 200, scheduled, one 'send' job ────
describe('POST /api/campaigns/:id/send-now — approved draft', () => {
  it('schedules and enqueues exactly one send job with delay 0', async () => {
    seedCampaign('camp-sn-ok', { status: 'draft', approved: true })

    const res = await request(makeApp())
      .post('/api/campaigns/camp-sn-ok/send-now')
      .send({})
      .set('Content-Type', 'application/json')

    expect(res.status).toBe(200)
    const campaign = res.body.campaign as { status: string }
    expect(campaign.status).toBe('scheduled')

    expect(mockQueueAdd).toHaveBeenCalledTimes(1)
    const call = mockQueueAdd.mock.calls[0] as unknown as [
      string,
      { campaignId: string; tenantId: string },
      { delay: number },
    ]
    expect(call[0]).toBe('send')
    expect(call[1]).toEqual({ campaignId: 'camp-sn-ok', tenantId: 'tenant-1' })
    expect(call[2].delay).toBe(0)
  })
})

// ── Test 3: /send-now with an unapproved message → rejected, no job ───────────
describe('POST /api/campaigns/:id/send-now — unapproved message', () => {
  it('returns 400 and enqueues nothing', async () => {
    seedCampaign('camp-sn-unapproved', { status: 'draft', approved: false })

    const res = await request(makeApp())
      .post('/api/campaigns/camp-sn-unapproved/send-now')
      .send({})
      .set('Content-Type', 'application/json')

    expect(res.status).toBe(400)
    expect((res.body as { error: string }).error).toMatch(/Approve/i)
    expect(mockQueueAdd).not.toHaveBeenCalled()
  })
})

// ── Test 4: /send-now on an already-scheduled/complete campaign → rejected ────
describe('POST /api/campaigns/:id/send-now — non-draft status', () => {
  it('returns 400 for a scheduled campaign and enqueues nothing', async () => {
    seedCampaign('camp-sn-sched', { status: 'scheduled', approved: true })

    const res = await request(makeApp())
      .post('/api/campaigns/camp-sn-sched/send-now')
      .send({})
      .set('Content-Type', 'application/json')

    expect(res.status).toBe(400)
    expect(mockQueueAdd).not.toHaveBeenCalled()
  })

  it('returns 400 for a complete campaign and enqueues nothing', async () => {
    seedCampaign('camp-sn-complete', { status: 'complete', approved: true })

    const res = await request(makeApp())
      .post('/api/campaigns/camp-sn-complete/send-now')
      .send({})
      .set('Content-Type', 'application/json')

    expect(res.status).toBe(400)
    expect(mockQueueAdd).not.toHaveBeenCalled()
  })
})

// ── Test 4b: /send-now on a segment-scoped campaign → schedules for real ──────
describe('POST /api/campaigns/:id/send-now — segment-scoped', () => {
  it('resolves the segment, snapshots its real contact_count, and enqueues a send job', async () => {
    ;(store.tables['contacts'] as Row[]).push(
      { id: 'c-1', tenant_id: 'tenant-1', full_name: 'A', is_archived: false },
      { id: 'c-2', tenant_id: 'tenant-1', full_name: 'B', is_archived: false }
    )
    // sl-1 (seeded in beforeEach) has empty filters — matches all tenant contacts.
    seedCampaign('camp-sn-seg', { status: 'draft', approved: true, segment_id: 'sl-1' })

    const res = await request(makeApp())
      .post('/api/campaigns/camp-sn-seg/send-now')
      .send({})
      .set('Content-Type', 'application/json')

    expect(res.status).toBe(200)
    const campaign = (res.body as { campaign: { contact_count: number } }).campaign
    expect(campaign.contact_count).toBe(2)
    expect(mockQueueAdd).toHaveBeenCalledTimes(1)
  })

  it('schedules with contact_count: 0 rather than erroring for a deleted/missing smart list', async () => {
    seedCampaign('camp-sn-seg-missing', { status: 'draft', approved: true, segment_id: 'gone' })

    const res = await request(makeApp())
      .post('/api/campaigns/camp-sn-seg-missing/send-now')
      .send({})
      .set('Content-Type', 'application/json')

    // A missing smart list resolves to zero contacts, not a route-level error —
    // the campaign still schedules with contact_count: 0.
    expect(res.status).toBe(200)
    const campaign = (res.body as { campaign: { contact_count: number } }).campaign
    expect(campaign.contact_count).toBe(0)
  })
})

// ── Test 5: /schedule still enforces the approval gate + honours schedule_at ──
describe('POST /api/campaigns/:id/schedule — approval gate + future schedule_at', () => {
  it('returns 400 when a message is unapproved and enqueues nothing', async () => {
    seedCampaign('camp-sch-unapproved', { status: 'draft', approved: false })
    const futureAt = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString()

    const res = await request(makeApp())
      .post('/api/campaigns/camp-sch-unapproved/schedule')
      .send({ schedule_at: futureAt })
      .set('Content-Type', 'application/json')

    expect(res.status).toBe(400)
    expect((res.body as { error: string }).error).toMatch(/Approve/i)
    expect(mockQueueAdd).not.toHaveBeenCalled()
  })

  it('schedules an approved draft at a future schedule_at and enqueues one send job', async () => {
    seedCampaign('camp-sch-ok', { status: 'draft', approved: true })
    const futureAt = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString()

    const res = await request(makeApp())
      .post('/api/campaigns/camp-sch-ok/schedule')
      .send({ schedule_at: futureAt })
      .set('Content-Type', 'application/json')

    expect(res.status).toBe(200)
    expect((res.body.campaign as { status: string }).status).toBe('scheduled')
    expect(mockQueueAdd).toHaveBeenCalledTimes(1)
    const call = mockQueueAdd.mock.calls[0] as unknown as [string, unknown, { delay: number }]
    expect(call[0]).toBe('send')
    expect(call[2].delay).toBeGreaterThan(0)
  })

  it('returns 400 for a past schedule_at and enqueues nothing', async () => {
    seedCampaign('camp-sch-past', { status: 'draft', approved: true })
    const pastAt = new Date(Date.now() - 60 * 60 * 1000).toISOString()

    const res = await request(makeApp())
      .post('/api/campaigns/camp-sch-past/schedule')
      .send({ schedule_at: pastAt })
      .set('Content-Type', 'application/json')

    expect(res.status).toBe(400)
    expect(mockQueueAdd).not.toHaveBeenCalled()
  })
})

// ── Test 5: GET /api/campaigns/:id/stats returns correct open_rate ────────────
describe('GET /api/campaigns/:id/stats', () => {
  it('returns correct open_rate and delivered count', async () => {
    const campaignId = 'camp-1'

    // Insert campaign into store
    ;(store.tables['campaigns'] as Row[]).push({
      id: campaignId,
      tenant_id: 'tenant-1',
      name: 'Stats Campaign',
      status: 'sent',
      type: 'email',
      recipient_count: 9,
      sent_count: 9,
    })

    // 5 delivered, 2 opened, 1 clicked, 1 bounced
    store.tables['campaign_recipients'] = [
      { id: 'r1', campaign_id: campaignId, tenant_id: 'tenant-1', status: 'delivered' },
      { id: 'r2', campaign_id: campaignId, tenant_id: 'tenant-1', status: 'delivered' },
      { id: 'r3', campaign_id: campaignId, tenant_id: 'tenant-1', status: 'delivered' },
      { id: 'r4', campaign_id: campaignId, tenant_id: 'tenant-1', status: 'delivered' },
      { id: 'r5', campaign_id: campaignId, tenant_id: 'tenant-1', status: 'delivered' },
      { id: 'r6', campaign_id: campaignId, tenant_id: 'tenant-1', status: 'opened' },
      { id: 'r7', campaign_id: campaignId, tenant_id: 'tenant-1', status: 'opened' },
      { id: 'r8', campaign_id: campaignId, tenant_id: 'tenant-1', status: 'clicked' },
      { id: 'r9', campaign_id: campaignId, tenant_id: 'tenant-1', status: 'bounced' },
    ]

    const res = await request(makeApp()).get(`/api/campaigns/${campaignId}/stats`)

    expect(res.status).toBe(200)
    expect(res.body).toHaveProperty('delivered')
    expect(res.body).toHaveProperty('open_rate')
    expect(res.body).toHaveProperty('click_rate')
    expect(res.body.delivered).toBe(5)
    expect(res.body.open_rate).toBeCloseTo(0.4)
    expect(res.body.click_rate).toBeCloseTo(0.2)
  })
})

// ── Test 6: POST /api/campaigns/:id/generate returns AI-generated content ─────
describe('POST /api/campaigns/:id/generate', () => {
  it('returns subject and body_html from mocked Gemini', async () => {
    // Create campaign first
    const createRes = await request(makeApp())
      .post('/api/campaigns')
      .send({ name: 'AI Campaign', type: 'email' })
      .set('Content-Type', 'application/json')

    expect(createRes.status).toBeLessThan(300)
    const campaignId = (createRes.body.campaign as { id: string }).id

    const res = await request(makeApp())
      .post(`/api/campaigns/${campaignId}/generate`)
      .send({ prompt: 'Write a welcome email' })
      .set('Content-Type', 'application/json')

    expect(res.status).toBe(200)
    expect(res.body).toHaveProperty('subject')
    expect(res.body).toHaveProperty('body_html')
    expect(res.body.subject).toBe('Re-engage now!')
    expect(res.body.body_html).toContain('<h1>')
  })
})
