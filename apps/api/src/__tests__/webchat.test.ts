import { describe, it, expect, jest, beforeEach } from '@jest/globals'
import {
  createStore,
  createMockSupabase,
  type MockStore,
  type Row,
} from '../routes/__test-support__/supabase-mock.js'

// ── Env vars ──────────────────────────────────────────────────────────────────
process.env['SUPABASE_URL'] = 'https://mock.supabase.co'
process.env['SUPABASE_SERVICE_ROLE_KEY'] = 'mock-service-key'
process.env['GEMINI_API_KEY'] = 'test-gemini-key'

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

// ── Gemini mock ───────────────────────────────────────────────────────────────
jest.unstable_mockModule('@google/genai', () => ({
  GoogleGenAI: jest.fn().mockImplementation(() => ({
    models: {
      generateContent: jest.fn<() => Promise<{ text: string }>>().mockResolvedValue({
        text: 'Hello! How can I help you today?',
      }),
    },
  })),
}))

// ── Dynamic imports (after mocks) ─────────────────────────────────────────────
// Sequential, not Promise.all — concurrent dynamic imports that share a
// newly-common dependency (lib/supabase.js, since the getServiceClient()
// consolidation) race in Jest's experimental VM-modules linker and throw
// "module ... is not linked".
const { default: express } = await import('express')
const { default: request } = await import('supertest')
const { default: webchatRouter } = await import('../routes/webchat.js')
const { webchatSettingsRouter } = await import('../routes/webchat.js')

function makeApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/webchat', webchatRouter)
  app.use('/api/settings/webchat', webchatSettingsRouter)
  return app
}

// ── beforeEach: reset store ───────────────────────────────────────────────────
beforeEach(() => {
  store = createStore()
  store.tables['tenants'] = []
  store.tables['webchat_sessions'] = []
  store.tables['webchat_messages'] = []
})

// ── Tests ─────────────────────────────────────────────────────────────────────
describe('Webchat routes', () => {
  // Test 1: POST /session/init — creates session, returns token
  it('POST /api/webchat/session/init — creates session and returns token', async () => {
    store.tables['tenants'] = [
      {
        id: 'tenant-1',
        name: 'Test Biz',
        webchat_enabled: true,
        webchat_greeting: 'Hi there!',
        webchat_color: '#0d9488',
        webchat_position: 'bottom-right',
      } as Row,
    ]
    store.tables['webchat_sessions'] = []

    const res = await request(makeApp())
      .post('/api/webchat/session/init')
      .send({ tenant_id: 'tenant-1' })

    expect(res.status).toBe(201)
    expect(res.body.session_token).toBeTruthy()
    expect(res.body.greeting).toBe('Hi there!')
    expect(res.body.business_name).toBe('Test Biz')
    expect(store.tables['webchat_sessions']).toHaveLength(1)
  })

  // Test 2: POST /session/:token/message — creates user msg, returns AI reply
  it('POST /api/webchat/session/:token/message — creates user message and returns AI reply', async () => {
    store.tables['webchat_sessions'] = [
      {
        id: 'sess-1',
        session_token: 'tok-1',
        tenant_id: 'tenant-1',
        status: 'active',
      } as Row,
    ]
    store.tables['webchat_messages'] = []
    store.tables['tenants'] = [{ id: 'tenant-1', name: 'Test Biz' } as Row]

    const res = await request(makeApp())
      .post('/api/webchat/session/tok-1/message')
      .send({ content: 'Hello', role: 'user' })

    expect(res.status).toBe(201)
    expect(res.body.message.content).toBe('Hello')
    expect(res.body.message.role).toBe('user')
    expect(res.body.reply.role).toBe('assistant')
    expect(res.body.reply.content).toBeTruthy()
    expect(store.tables['webchat_messages']).toHaveLength(2)
  })

  // Test 3: GET /session/:token — returns session + messages
  it('GET /api/webchat/session/:token — returns session and messages', async () => {
    store.tables['webchat_sessions'] = [
      {
        id: 'sess-1',
        session_token: 'tok-2',
        status: 'active',
        visitor_name: 'Jane',
      } as Row,
    ]
    store.tables['webchat_messages'] = [
      { id: 'msg-1', session_id: 'sess-1', role: 'user', content: 'Hello' } as Row,
      { id: 'msg-2', session_id: 'sess-1', role: 'assistant', content: 'Hi Jane!' } as Row,
    ]

    const res = await request(makeApp()).get('/api/webchat/session/tok-2')

    expect(res.status).toBe(200)
    expect(res.body.session.id).toBe('sess-1')
    expect(res.body.messages).toHaveLength(2)
  })

  // Test 4: Invalid token returns 404
  it('GET /api/webchat/session/:token — returns 404 for invalid token', async () => {
    store.tables['webchat_sessions'] = []

    const res = await request(makeApp()).get('/api/webchat/session/nonexistent-token')

    expect(res.status).toBe(404)
  })

  // Test 5: GET /api/settings/webchat — returns webchat config
  it('GET /api/settings/webchat — returns webchat config for tenant', async () => {
    store.tables['tenants'] = [
      {
        id: 'tenant-1',
        webchat_enabled: true,
        webchat_greeting: 'Welcome! How can we help?',
        webchat_color: '#2563eb',
        webchat_position: 'bottom-right',
      } as Row,
    ]

    const res = await request(makeApp()).get('/api/settings/webchat')

    expect(res.status).toBe(200)
    expect(typeof res.body.webchat_enabled).toBe('boolean')
    expect(typeof res.body.webchat_greeting).toBe('string')
  })

  // Test 6: handoff flips mode to human
  it('POST /api/webchat/session/:token/handoff — flips mode to human', async () => {
    store.tables['tenants'] = [{ id: 'tenant-1', name: 'Test Biz' } as Row]
    store.tables['webchat_sessions'] = [
      {
        id: 'sess-1',
        session_token: 'tok-h1',
        tenant_id: 'tenant-1',
        status: 'active',
        mode: 'ai',
      } as Row,
    ]

    const res = await request(makeApp())
      .post('/api/webchat/session/tok-h1/handoff')
      .send({ reason: 'Wants pricing help' })

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ ok: true, mode: 'human' })
    const row = (store.tables['webchat_sessions'] as Row[]).find((r) => r['id'] === 'sess-1')
    expect(row?.['mode']).toBe('human')
    expect(row?.['handoff_requested_at']).toBeTruthy()
    expect(row?.['handoff_reason']).toBe('Wants pricing help')
  })

  // Test 7: handoff is idempotent
  it('POST /api/webchat/session/:token/handoff — is idempotent when already human', async () => {
    store.tables['tenants'] = [{ id: 'tenant-1', name: 'Test Biz' } as Row]
    store.tables['webchat_sessions'] = [
      {
        id: 'sess-1',
        session_token: 'tok-h2',
        tenant_id: 'tenant-1',
        status: 'active',
        mode: 'human',
        handoff_requested_at: '2026-01-01T00:00:00.000Z',
      } as Row,
    ]

    const res = await request(makeApp()).post('/api/webchat/session/tok-h2/handoff').send({})

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ ok: true, mode: 'human' })
    const row = (store.tables['webchat_sessions'] as Row[]).find((r) => r['id'] === 'sess-1')
    // untouched — no re-write on the already-human path
    expect(row?.['handoff_requested_at']).toBe('2026-01-01T00:00:00.000Z')
  })

  // Test 8: AI is skipped once in human mode — this is the core regression guard
  it('POST /api/webchat/session/:token/message — skips Gemini once mode is human', async () => {
    store.tables['tenants'] = [{ id: 'tenant-1', name: 'Test Biz' } as Row]
    store.tables['webchat_sessions'] = [
      {
        id: 'sess-1',
        session_token: 'tok-m1',
        tenant_id: 'tenant-1',
        status: 'active',
        mode: 'human',
      } as Row,
    ]
    store.tables['webchat_messages'] = []

    const { GoogleGenAI } = await import('@google/genai')
    const genAiCtor = GoogleGenAI as unknown as jest.Mock
    genAiCtor.mockClear()

    const res = await request(makeApp())
      .post('/api/webchat/session/tok-m1/message')
      .send({ content: 'Is anyone there?', role: 'user' })

    expect(res.status).toBe(201)
    expect(res.body.message.content).toBe('Is anyone there?')
    expect(res.body.reply).toBeUndefined()
    expect(res.body.mode).toBe('human')
    expect(genAiCtor).not.toHaveBeenCalled()
    expect(store.tables['webchat_messages']).toHaveLength(1)
  })

  // Test 9: cursor poll only returns messages after the given timestamp
  it('GET /api/webchat/session/:token/messages?after= — filters by cursor', async () => {
    store.tables['webchat_sessions'] = [
      {
        id: 'sess-1',
        session_token: 'tok-p1',
        tenant_id: 'tenant-1',
        status: 'active',
        mode: 'ai',
      } as Row,
    ]
    store.tables['webchat_messages'] = [
      {
        id: 'msg-1',
        session_id: 'sess-1',
        role: 'user',
        content: 'early',
        created_at: '2026-01-01T00:00:00.000Z',
      } as Row,
      {
        id: 'msg-2',
        session_id: 'sess-1',
        role: 'agent',
        content: 'later',
        created_at: '2026-01-01T00:05:00.000Z',
      } as Row,
    ]

    const res = await request(makeApp())
      .get('/api/webchat/session/tok-p1/messages')
      .query({ after: '2026-01-01T00:01:00.000Z' })

    expect(res.status).toBe(200)
    expect(res.body.mode).toBe('ai')
    expect(res.body.messages).toHaveLength(1)
    expect(res.body.messages[0].content).toBe('later')
  })

  // Test 10: GET /sessions status filter actually applies (was previously a no-op)
  it('GET /api/webchat/sessions?status=active — filters out closed sessions', async () => {
    store.tables['webchat_sessions'] = [
      {
        id: 'sess-1',
        session_token: 'a',
        tenant_id: 'tenant-1',
        status: 'active',
        mode: 'ai',
      } as Row,
      {
        id: 'sess-2',
        session_token: 'b',
        tenant_id: 'tenant-1',
        status: 'closed',
        mode: 'ai',
      } as Row,
    ]

    const res = await request(makeApp()).get('/api/webchat/sessions').query({ status: 'active' })

    expect(res.status).toBe(200)
    expect(res.body.sessions).toHaveLength(1)
    expect(res.body.sessions[0].id).toBe('sess-1')
  })
})
