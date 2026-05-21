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
const [
  { default: express },
  { default: request },
  { default: webchatRouter },
  { webchatSettingsRouter },
] = await Promise.all([
  import('express'),
  import('supertest'),
  import('../routes/webchat.js'),
  import('../routes/webchat.js'),
])

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
        business_name: 'Test Biz',
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
    store.tables['tenants'] = [{ id: 'tenant-1', business_name: 'Test Biz' } as Row]

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
})
