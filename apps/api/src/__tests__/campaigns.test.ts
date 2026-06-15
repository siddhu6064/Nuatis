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

const { processCampaignSend } = await import('../workers/campaign-send-worker.js')

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

// ── Test 2: POST /api/campaigns/:id/schedule returns 400 if no smart_list_id ──
describe('POST /api/campaigns/:id/schedule — no smart_list_id', () => {
  it('returns 400 when campaign has no smart_list_id', async () => {
    // Create a draft campaign without smart_list_id
    const createRes = await request(makeApp())
      .post('/api/campaigns')
      .send({ name: 'No List Campaign', type: 'email' })
      .set('Content-Type', 'application/json')

    expect(createRes.status).toBeLessThan(300)
    const campaignId = (createRes.body.campaign as { id: string }).id

    // Manually set subject and body_html so those checks pass, but leave smart_list_id unset
    const camp = (store.tables['campaigns'] as Row[]).find((c) => c['id'] === campaignId)
    if (camp) {
      camp['subject'] = 'Test Subject'
      camp['body_html'] = '<p>Test</p>'
    }

    const scheduledAt = new Date(Date.now() + 10 * 60 * 1000).toISOString() // 10 min from now

    const res = await request(makeApp())
      .post(`/api/campaigns/${campaignId}/schedule`)
      .send({ scheduled_at: scheduledAt })
      .set('Content-Type', 'application/json')

    expect(res.status).toBe(400)
  })
})

// ── Test 3: POST /api/campaigns/:id/schedule returns 400 if scheduled_at is past
describe('POST /api/campaigns/:id/schedule — past date', () => {
  it('returns 400 when scheduled_at is in the past', async () => {
    // Create campaign with smart_list_id, subject, body_html
    const createRes = await request(makeApp())
      .post('/api/campaigns')
      .send({
        name: 'Past Schedule Campaign',
        type: 'email',
        smart_list_id: 'sl-1',
        subject: 'Subject',
      })
      .set('Content-Type', 'application/json')

    expect(createRes.status).toBeLessThan(300)
    const campaignId = (createRes.body.campaign as { id: string }).id

    // Set body_html directly in store
    const camp = (store.tables['campaigns'] as Row[]).find((c) => c['id'] === campaignId)
    if (camp) {
      camp['body_html'] = '<p>Body</p>'
    }

    // 1 hour in the past
    const scheduledAt = new Date(Date.now() - 60 * 60 * 1000).toISOString()

    const res = await request(makeApp())
      .post(`/api/campaigns/${campaignId}/schedule`)
      .send({ scheduled_at: scheduledAt })
      .set('Content-Type', 'application/json')

    expect(res.status).toBe(400)
  })
})

// ── Test 4: Worker skips suppressed contacts ──────────────────────────────────
describe('processCampaignSend — suppression', () => {
  it('skips suppressed contacts (hard_bounce) and only inserts non-suppressed recipients', async () => {
    const campaignId = 'camp-worker-1'
    const tenantId = 'tenant-1'

    store.tables['campaigns'] = [
      {
        id: campaignId,
        tenant_id: tenantId,
        status: 'scheduled',
        subject: 'Hello',
        body_html: '<p>Hi {{contact_name}}</p>',
        smart_list_id: 'sl-1',
      },
    ]

    seedEntitledTenant(store, tenantId)

    store.tables['contacts'] = [
      {
        id: 'contact-good',
        tenant_id: tenantId,
        full_name: 'Good Person',
        email: 'good@example.com',
        email_status: null,
        email_risk_score: 0,
        is_archived: false,
      },
      {
        id: 'contact-bad',
        tenant_id: tenantId,
        full_name: 'Bad Person',
        email: 'bad@example.com',
        email_status: 'hard_bounce',
        email_risk_score: 100,
        is_archived: false,
      },
    ]

    store.tables['campaign_recipients'] = []
    store.tables['smart_lists'] = [{ id: 'sl-1', tenant_id: tenantId, name: 'All', filters: {} }]

    await processCampaignSend({ campaignId, tenantId })

    // Only the good contact should be in campaign_recipients
    const recipients = store.tables['campaign_recipients'] as Row[]
    const contactIds = recipients.map((r) => r['contact_id'])
    expect(contactIds).toContain('contact-good')
    expect(contactIds).not.toContain('contact-bad')
    expect(recipients.length).toBeLessThan(2)
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
