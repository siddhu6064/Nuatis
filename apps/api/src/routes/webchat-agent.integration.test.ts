import { jest, describe, it, expect, beforeEach } from '@jest/globals'
import { mintTestToken } from './__test-support__/jwt.js'
import {
  createStore,
  createMockSupabase,
  type MockStore,
  type Row,
} from './__test-support__/supabase-mock.js'
import { entitledTenantRow } from './__test-support__/tenant-fixture.js'

let store: MockStore = createStore()

jest.unstable_mockModule('@supabase/supabase-js', () => ({
  createClient: () => createMockSupabase(store),
}))

const TENANT_ID = 'aaaaaaaa-0000-0000-0000-00000wc00001'
const OTHER_TENANT_ID = 'aaaaaaaa-0000-0000-0000-00000wc00002'
const SECRET = process.env['AUTH_SECRET'] ?? 'test-secret-for-unit-tests-only-32ch'
process.env['AUTH_SECRET'] = SECRET
process.env['SUPABASE_URL'] = 'https://mock.supabase.co'
process.env['SUPABASE_SERVICE_ROLE_KEY'] = 'mock-service-key'

async function makeToken(tenantId: string = TENANT_ID): Promise<string> {
  return mintTestToken({ sub: 'user-1', tenantId, role: 'owner' }, { secret: SECRET })
}

const { default: express } = await import('express')
const { default: request } = await import('supertest')
const { default: webchatAgentRouter } = await import('./webchat-agent.js')

function makeApp() {
  const app = express()
  app.use('/api/webchat/sessions', express.json(), webchatAgentRouter)
  return app
}

beforeEach(() => {
  store = createStore()
  store.tables['tenants'] = [entitledTenantRow(TENANT_ID)]
  store.tables['webchat_sessions'] = []
  store.tables['webchat_messages'] = []
})

describe('GET /api/webchat/sessions/:id', () => {
  it('returns the session and its messages, and resets unread_count', async () => {
    store.tables['webchat_sessions'] = [
      {
        id: 'sess-1',
        tenant_id: TENANT_ID,
        status: 'active',
        mode: 'ai',
        visitor_name: 'Jane',
        unread_count: 3,
      } as Row,
    ]
    store.tables['webchat_messages'] = [
      { id: 'msg-1', session_id: 'sess-1', role: 'user', content: 'Hi' } as Row,
    ]
    const token = await makeToken()

    const res = await request(makeApp())
      .get('/api/webchat/sessions/sess-1')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.session.id).toBe('sess-1')
    expect(res.body.messages).toHaveLength(1)
  })

  it('404s for a session belonging to another tenant', async () => {
    store.tables['webchat_sessions'] = [
      { id: 'sess-1', tenant_id: OTHER_TENANT_ID, status: 'active', mode: 'ai' } as Row,
    ]
    const token = await makeToken()

    const res = await request(makeApp())
      .get('/api/webchat/sessions/sess-1')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(404)
  })
})

describe('GET /api/webchat/sessions/:id/messages', () => {
  it('filters by the after cursor, tenant-scoped', async () => {
    store.tables['webchat_sessions'] = [
      { id: 'sess-1', tenant_id: TENANT_ID, status: 'active', mode: 'human' } as Row,
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
    const token = await makeToken()

    const res = await request(makeApp())
      .get('/api/webchat/sessions/sess-1/messages')
      .query({ after: '2026-01-01T00:01:00.000Z' })
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.mode).toBe('human')
    expect(res.body.messages).toHaveLength(1)
    expect(res.body.messages[0].content).toBe('later')
  })
})

describe('POST /api/webchat/sessions/:id/reply', () => {
  it('inserts an agent message and takes over the session (mode flips to human)', async () => {
    store.tables['webchat_sessions'] = [
      { id: 'sess-1', tenant_id: TENANT_ID, status: 'active', mode: 'ai' } as Row,
    ]
    const token = await makeToken()

    const res = await request(makeApp())
      .post('/api/webchat/sessions/sess-1/reply')
      .set('Authorization', `Bearer ${token}`)
      .send({ body: 'Hey, this is Sam from support!' })

    expect(res.status).toBe(201)
    expect(res.body.message.role).toBe('agent')
    expect(res.body.mode).toBe('human')
    const session = (store.tables['webchat_sessions'] as Row[]).find((r) => r['id'] === 'sess-1')
    expect(session?.['mode']).toBe('human')
    expect(session?.['unread_count']).toBe(0)
  })

  it('400s on an empty body', async () => {
    store.tables['webchat_sessions'] = [
      { id: 'sess-1', tenant_id: TENANT_ID, status: 'active', mode: 'ai' } as Row,
    ]
    const token = await makeToken()

    const res = await request(makeApp())
      .post('/api/webchat/sessions/sess-1/reply')
      .set('Authorization', `Bearer ${token}`)
      .send({ body: '   ' })

    expect(res.status).toBe(400)
  })

  it('404s for a session belonging to another tenant', async () => {
    store.tables['webchat_sessions'] = [
      { id: 'sess-1', tenant_id: OTHER_TENANT_ID, status: 'active', mode: 'ai' } as Row,
    ]
    const token = await makeToken()

    const res = await request(makeApp())
      .post('/api/webchat/sessions/sess-1/reply')
      .set('Authorization', `Bearer ${token}`)
      .send({ body: 'hello' })

    expect(res.status).toBe(404)
  })
})

describe('PATCH /api/webchat/sessions/:id/mode', () => {
  it('takes over: ai -> human sets handoff_requested_at', async () => {
    store.tables['webchat_sessions'] = [
      { id: 'sess-1', tenant_id: TENANT_ID, status: 'active', mode: 'ai' } as Row,
    ]
    const token = await makeToken()

    const res = await request(makeApp())
      .patch('/api/webchat/sessions/sess-1/mode')
      .set('Authorization', `Bearer ${token}`)
      .send({ mode: 'human' })

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ ok: true, mode: 'human' })
    const session = (store.tables['webchat_sessions'] as Row[]).find((r) => r['id'] === 'sess-1')
    expect(session?.['handoff_requested_at']).toBeTruthy()
  })

  it('hands back: human -> ai clears handoff fields', async () => {
    store.tables['webchat_sessions'] = [
      {
        id: 'sess-1',
        tenant_id: TENANT_ID,
        status: 'active',
        mode: 'human',
        handoff_requested_at: '2026-01-01T00:00:00.000Z',
        handoff_reason: 'wants pricing',
      } as Row,
    ]
    const token = await makeToken()

    const res = await request(makeApp())
      .patch('/api/webchat/sessions/sess-1/mode')
      .set('Authorization', `Bearer ${token}`)
      .send({ mode: 'ai' })

    expect(res.status).toBe(200)
    const session = (store.tables['webchat_sessions'] as Row[]).find((r) => r['id'] === 'sess-1')
    expect(session?.['mode']).toBe('ai')
    expect(session?.['handoff_requested_at']).toBeNull()
    expect(session?.['handoff_reason']).toBeNull()
  })

  it('400s on an invalid mode value', async () => {
    store.tables['webchat_sessions'] = [
      { id: 'sess-1', tenant_id: TENANT_ID, status: 'active', mode: 'ai' } as Row,
    ]
    const token = await makeToken()

    const res = await request(makeApp())
      .patch('/api/webchat/sessions/sess-1/mode')
      .set('Authorization', `Bearer ${token}`)
      .send({ mode: 'robot' })

    expect(res.status).toBe(400)
  })
})

describe('POST /api/webchat/sessions/:id/close', () => {
  it('closes the session', async () => {
    store.tables['webchat_sessions'] = [
      { id: 'sess-1', tenant_id: TENANT_ID, status: 'active', mode: 'ai' } as Row,
    ]
    const token = await makeToken()

    const res = await request(makeApp())
      .post('/api/webchat/sessions/sess-1/close')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    const session = (store.tables['webchat_sessions'] as Row[]).find((r) => r['id'] === 'sess-1')
    expect(session?.['status']).toBe('closed')
    expect(session?.['ended_at']).toBeTruthy()
  })
})
