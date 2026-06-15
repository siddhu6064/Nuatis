import { describe, it, expect, jest, beforeAll } from '@jest/globals'
import {
  createStore,
  createMockSupabase,
  type MockStore,
} from '../routes/__test-support__/supabase-mock.js'
import { seedEntitledTenant } from '../routes/__test-support__/tenant-fixture.js'

// ── Env ───────────────────────────────────────────────────────────────────────
process.env['SUPABASE_URL'] = 'https://mock.supabase.co'
process.env['SUPABASE_SERVICE_ROLE_KEY'] = 'mock-service-key'
process.env['GEMINI_API_KEY'] = 'test-gemini-key'
process.env['RESEND_API_KEY'] = 'test-resend-key'

// ── Shared store — persists across all lifecycle steps (no beforeEach reset) ──
let store: MockStore = createStore()

// ── Supabase mock ─────────────────────────────────────────────────────────────
jest.unstable_mockModule('@supabase/supabase-js', () => ({
  createClient: () => createMockSupabase(store),
}))

// ── Auth mock — pass-through for all middleware ───────────────────────────────
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
  requireModule: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}))

// ── BullMQ mock ───────────────────────────────────────────────────────────────
const mockQueueAdd = jest.fn<() => Promise<void>>().mockResolvedValue(undefined)

jest.unstable_mockModule('bullmq', () => ({
  Queue: jest.fn().mockImplementation(() => ({
    add: mockQueueAdd,
    close: jest.fn(),
    // cancel route uses getDelayed() in a silently-ignored try/catch
    getDelayed: jest.fn<() => Promise<unknown[]>>().mockResolvedValue([]),
  })),
  Worker: jest.fn().mockImplementation(() => ({ on: jest.fn(), close: jest.fn() })),
}))

jest.unstable_mockModule('../lib/bullmq-connection.js', () => ({
  createBullMQConnection: jest.fn().mockReturnValue({}),
}))

// ── Gemini mock — controlled per-step via mockResolvedValueOnce ───────────────
const mockGenerateContent = jest.fn<() => Promise<{ text: string }>>()

jest.unstable_mockModule('@google/genai', () => ({
  GoogleGenAI: jest.fn().mockImplementation(() => ({
    models: { generateContent: mockGenerateContent },
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

// ── Lifecycle state — captured across it() blocks ────────────────────────────
let campaignId = ''
let msgId = ''

// ── Store bootstrap — runs once; store persists for the full lifecycle ─────────
beforeAll(() => {
  store = createStore()
  store.tables['campaigns'] = []
  store.tables['campaign_messages'] = []
  store.tables['campaign_sends'] = []
  store.tables['campaign_performance'] = []
  store.tables['contacts'] = [
    {
      id: 'c-1',
      tenant_id: 'tenant-1',
      full_name: 'Test User',
      is_archived: false,
      sms_opt_in: true,
      phone: '+15125550001',
      email: 'test@example.com',
    },
  ]
  store.tables['smart_lists'] = [
    { id: 'sl-1', tenant_id: 'tenant-1', name: 'Test Segment', filters: {} },
  ]
  seedEntitledTenant(store, 'tenant-1')

  jest.spyOn(console, 'info').mockImplementation(() => {})
  jest.spyOn(console, 'warn').mockImplementation(() => {})
  jest.spyOn(console, 'error').mockImplementation(() => {})
})

// ── Full lifecycle ────────────────────────────────────────────────────────────
describe('campaign full lifecycle — integration', () => {
  // ── Step 1: Create draft campaign ─────────────────────────────────────────
  it('creates a draft campaign', async () => {
    const res = await request(makeApp())
      .post('/api/campaigns')
      .send({
        name: 'Test',
        objective: 'reactivate_lapsed',
        channels: ['sms'],
        segment_id: 'sl-1',
      })
      .set('Content-Type', 'application/json')

    expect(res.status).toBe(201)
    const body = res.body as { campaign: { id: string; status: string } }
    expect(body.campaign.status).toBe('draft')
    campaignId = body.campaign.id
    expect(campaignId).toBeTruthy()
  })

  // ── Step 2: Generate AI copy ───────────────────────────────────────────────
  it('generates AI copy', async () => {
    mockGenerateContent.mockResolvedValueOnce({
      text: JSON.stringify({ body: 'Hi {first_name}, we miss you! Reply STOP to opt out.' }),
    })

    const res = await request(makeApp())
      .post(`/api/campaigns/${campaignId}/generate`)
      .send({})
      .set('Content-Type', 'application/json')

    expect(res.status).toBe(200)
    const body = res.body as { messages: Array<{ id: string; channel: string; approved: boolean }> }
    expect(Array.isArray(body.messages)).toBe(true)
    expect(body.messages.length).toBeGreaterThan(0)
    const smsMsg = body.messages.find((m) => m.channel === 'sms')
    expect(smsMsg).toBeDefined()
    expect(smsMsg!.approved).toBe(false)
    msgId = smsMsg!.id
    expect(msgId).toBeTruthy()
  })

  // ── Step 3: Edit generated copy — resets ai_generated and approved ─────────
  it('allows editing generated copy', async () => {
    const res = await request(makeApp())
      .patch(`/api/campaigns/${campaignId}/messages/${msgId}`)
      .send({ body: 'Hi {first_name}, time for your checkup! Reply STOP to opt out.' })
      .set('Content-Type', 'application/json')

    expect(res.status).toBe(200)
    const body = res.body as { message: { approved: boolean; ai_generated: boolean } }
    expect(body.message.approved).toBe(false)
    expect(body.message.ai_generated).toBe(false)
  })

  // ── Step 4: Approve all messages ───────────────────────────────────────────
  it('approves all messages', async () => {
    const res = await request(makeApp())
      .post(`/api/campaigns/${campaignId}/approve`)
      .send({})
      .set('Content-Type', 'application/json')

    expect(res.status).toBe(200)
    const body = res.body as { messages: Array<{ approved: boolean }> }
    expect(Array.isArray(body.messages)).toBe(true)
    expect(body.messages.length).toBeGreaterThan(0)
    expect(body.messages.every((m) => m.approved)).toBe(true)
  })

  // ── Step 5: Schedule the campaign ─────────────────────────────────────────
  it('schedules the campaign', async () => {
    const scheduleAt = new Date(Date.now() + 60_000).toISOString()

    const res = await request(makeApp())
      .post(`/api/campaigns/${campaignId}/schedule`)
      .send({ schedule_at: scheduleAt })
      .set('Content-Type', 'application/json')

    expect(res.status).toBe(200)
    const body = res.body as { campaign: { status: string; contact_count: number | null } }
    expect(body.campaign.status).toBe('scheduled')
    // contact_count: numeric when segment resolves, null when not
    const cc = body.campaign.contact_count
    expect(cc === null || typeof cc === 'number').toBe(true)
  })

  // ── Step 6: Performance summary before any sends ───────────────────────────
  it('returns performance summary before any sends', async () => {
    const res = await request(makeApp()).get(`/api/campaigns/${campaignId}/performance/summary`)

    expect(res.status).toBe(200)
    const body = res.body as {
      total_sent: number
      delivery_rate: number
      open_rate: number
      click_rate: number
      opt_out_rate: number
      by_channel: unknown[]
    }
    expect(body.total_sent).toBe(0)
    expect(body.delivery_rate).toBe(0)
    expect(body.open_rate).toBe(0)
    expect(body.click_rate).toBe(0)
    expect(body.opt_out_rate).toBe(0)
    expect(Array.isArray(body.by_channel)).toBe(true)
  })

  // ── Step 7: Edit on scheduled campaign resets approved to false ────────────
  it('editing a scheduled campaign copy resets approved to false', async () => {
    const res = await request(makeApp())
      .patch(`/api/campaigns/${campaignId}/messages/${msgId}`)
      .send({ body: 'changed' })
      .set('Content-Type', 'application/json')

    expect(res.status).toBe(200)
    const body = res.body as { message: { approved: boolean } }
    expect(body.message.approved).toBe(false)
  })

  // ── Step 8: Cancel the scheduled campaign ─────────────────────────────────
  it('cancels the scheduled campaign', async () => {
    const res = await request(makeApp())
      .post(`/api/campaigns/${campaignId}/cancel`)
      .send({})
      .set('Content-Type', 'application/json')

    expect(res.status).toBe(200)
    const body = res.body as { campaign: { status: string } }
    expect(body.campaign.status).toBe('cancelled')
  })

  // ── Step 9: Cannot schedule a cancelled campaign ───────────────────────────
  it('cannot schedule a cancelled campaign', async () => {
    const scheduleAt = new Date(Date.now() + 60_000).toISOString()

    const res = await request(makeApp())
      .post(`/api/campaigns/${campaignId}/schedule`)
      .send({ schedule_at: scheduleAt })
      .set('Content-Type', 'application/json')

    expect(res.status).toBe(400)
  })
})
