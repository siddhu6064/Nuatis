import { describe, it, expect, jest, beforeEach } from '@jest/globals'
import { randomUUID } from 'node:crypto'
import {
  createStore,
  createMockSupabase,
  type MockStore,
  type Row,
} from '../routes/__test-support__/supabase-mock.js'

// ── Mock supabase ─────────────────────────────────────────────────────────────
let store: MockStore = createStore()

jest.unstable_mockModule('@supabase/supabase-js', () => ({
  createClient: () => createMockSupabase(store),
}))

// ── Mock nanoid so tokens are deterministic ───────────────────────────────────
// 16-char mixed-case value so the token-format tests can prove the generator
// neither truncates nor lowercases.
const MOCK_TOKEN = 'AbCdEfGh12345678'

jest.unstable_mockModule('nanoid', () => ({
  nanoid: () => MOCK_TOKEN,
}))

// ── Mock requireAuth ──────────────────────────────────────────────────────────
const TENANT_ID = 'tenant-test-1'

jest.unstable_mockModule('../lib/auth.js', () => ({
  requireAuth: (req: Record<string, unknown>, _res: unknown, next: () => void) => {
    req['tenantId'] = TENANT_ID
    req['userId'] = 'user-1'
    req['role'] = 'admin'
    next()
  },
}))

process.env['SUPABASE_URL'] = 'https://mock.supabase.co'
process.env['SUPABASE_SERVICE_ROLE_KEY'] = 'mock-service-key'
process.env['API_BASE_URL'] = 'http://localhost:3001'

const [
  { default: express },
  { default: request },
  { default: triggerLinksRouter, triggerLinkPublicRouter },
  { generateTriggerToken },
  { buildTriggerUrl },
] = await Promise.all([
  import('express'),
  import('supertest'),
  import('../routes/trigger-links.js'),
  import('../lib/slugify.js'),
  import('@nuatis/shared'),
])

function makePublicApp() {
  const app = express()
  app.use('/t', triggerLinkPublicRouter)
  return app
}

function makeAuthedApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/trigger-links', triggerLinksRouter)
  return app
}

function seedLink(overrides: Row = {}): string {
  const linkId = randomUUID()
  ;(store.tables['trigger_links'] as Row[]).push({
    id: linkId,
    tenant_id: TENANT_ID,
    name: 'Test Link',
    slug: 'testslug',
    action: 'mark_contacted',
    action_config: {},
    click_count: 0,
    expires_at: null,
    max_uses: null,
    use_count: 0,
    ...overrides,
  })
  return linkId
}

beforeEach(() => {
  store = createStore()
  store.tables['trigger_links'] = []
  store.tables['trigger_link_events'] = []
  store.tables['appointments'] = []
})

// ── Unit: generateTriggerToken ────────────────────────────────────────────────
describe('generateTriggerToken', () => {
  it('returns a 16-character full-alphabet token, not lowercased', async () => {
    const token = await generateTriggerToken()
    expect(token).toHaveLength(16)
    // Exact match proves the mixed-case nanoid output was not case-folded.
    expect(token).toBe(MOCK_TOKEN)
  })
})

// ── Unit: buildTriggerUrl ────────────────────────────────────────────────────
describe('buildTriggerUrl', () => {
  it('includes ?cid= param when contactId provided', () => {
    const url = buildTriggerUrl('abc12345', 'contact-uuid')
    expect(url).toBe('http://localhost:3001/t/abc12345?cid=contact-uuid')
  })

  it('omits ?cid= param when contactId not provided', () => {
    const url = buildTriggerUrl('abc12345')
    expect(url).toBe('http://localhost:3001/t/abc12345')
  })
})

// ── Route: POST /api/trigger-links (creation defaults) ───────────────────────
describe('POST /api/trigger-links', () => {
  it('defaults state-mutating actions to single-use with an expiry', async () => {
    const res = await request(makeAuthedApp())
      .post('/api/trigger-links')
      .send({ name: 'Confirm', action: 'confirm_appointment' })
    expect(res.status).toBe(201)
    expect(res.body.trigger_link.max_uses).toBe(1)
    expect(res.body.trigger_link.expires_at).toBeTruthy()
    expect(Date.parse(res.body.trigger_link.expires_at)).toBeGreaterThan(Date.now())
    expect(res.body.trigger_link.slug).toBe(MOCK_TOKEN)
  })

  it('defaults tracking actions to unlimited uses with no expiry', async () => {
    const res = await request(makeAuthedApp())
      .post('/api/trigger-links')
      .send({ name: 'Contacted', action: 'mark_contacted' })
    expect(res.status).toBe(201)
    expect(res.body.trigger_link.max_uses).toBeNull()
    expect(res.body.trigger_link.expires_at).toBeNull()
  })

  it('lets the creator override max_uses and expires_at', async () => {
    const expires = new Date(Date.now() + 60 * 60 * 1000).toISOString()
    const res = await request(makeAuthedApp())
      .post('/api/trigger-links')
      .send({ name: 'Webhook', action: 'custom_webhook', max_uses: 5, expires_at: expires })
    expect(res.status).toBe(201)
    expect(res.body.trigger_link.max_uses).toBe(5)
    expect(res.body.trigger_link.expires_at).toBe(expires)
  })
})

// ── Route: GET /t/:slug ───────────────────────────────────────────────────────
describe('GET /t/:slug', () => {
  it('returns 404 HTML when slug not found', async () => {
    const res = await request(makePublicApp()).get('/t/unknownslug')
    expect(res.status).toBe(404)
    expect(res.text).toContain('no longer active')
  })

  it('increments click_count for a valid slug', async () => {
    const linkId = seedLink()

    await request(makePublicApp()).get('/t/testslug')

    const link = (store.tables['trigger_links'] as Row[]).find((r) => r['id'] === linkId)
    expect(link?.['click_count']).toBe(1)
  })

  it('serves a multi-use tracking link repeatedly', async () => {
    seedLink()
    const app = makePublicApp()
    for (let i = 0; i < 3; i++) {
      const res = await request(app).get('/t/testslug')
      expect(res.status).toBe(200)
    }
  })

  it('returns 410 for an expired link', async () => {
    seedLink({ expires_at: new Date(Date.now() - 1000).toISOString() })
    const res = await request(makePublicApp()).get('/t/testslug')
    expect(res.status).toBe(410)
    expect(res.text).toContain('expired')
  })

  it('fires a single-use link once, then returns 410 on replay', async () => {
    const apptId = randomUUID()
    ;(store.tables['appointments'] as Row[]).push({
      id: apptId,
      tenant_id: TENANT_ID,
      status: 'pending',
    })
    const linkId = seedLink({
      action: 'confirm_appointment',
      action_config: { appointment_id: apptId },
      max_uses: 1,
    })
    const app = makePublicApp()

    const first = await request(app).get('/t/testslug')
    expect(first.status).toBe(200)
    const appt = (store.tables['appointments'] as Row[]).find((r) => r['id'] === apptId)
    expect(appt?.['status']).toBe('confirmed')

    // Replay: flip the appointment back and verify the second click can't re-flip it.
    appt!['status'] = 'pending'
    const second = await request(app).get('/t/testslug')
    expect(second.status).toBe(410)
    expect(appt?.['status']).toBe('pending')

    const link = (store.tables['trigger_links'] as Row[]).find((r) => r['id'] === linkId)
    expect(link?.['use_count']).toBe(1)
  })

  it('claims a single-use link exactly once under concurrent double-fire', async () => {
    const linkId = seedLink({ action: 'custom_webhook', action_config: {}, max_uses: 1 })
    const app = makePublicApp()

    const [a, b] = await Promise.all([
      request(app).get('/t/testslug'),
      request(app).get('/t/testslug'),
    ])

    const statuses = [a.status, b.status].sort()
    expect(statuses).toEqual([200, 410])

    const link = (store.tables['trigger_links'] as Row[]).find((r) => r['id'] === linkId)
    expect(link?.['use_count']).toBe(1)
  })
})
