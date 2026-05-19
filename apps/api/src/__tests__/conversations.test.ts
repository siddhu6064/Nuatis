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

const mockSendSms = jest.fn<() => Promise<{ success: boolean; messageId?: string }>>()
jest.unstable_mockModule('../lib/sms.js', () => ({ sendSms: mockSendSms }))

jest.unstable_mockModule('../lib/auth.js', () => ({
  requireAuth: (req: Record<string, unknown>, _res: unknown, next: () => void) => {
    req['tenantId'] = TENANT_ID
    req['userId'] = 'user-1'
    next()
  },
}))

// ── Dynamic imports ───────────────────────────────────────────────────────────
const [{ default: express }, { default: request }, { default: conversationsRouter }] =
  await Promise.all([import('express'), import('supertest'), import('../routes/conversations.js')])

// ── Constants ─────────────────────────────────────────────────────────────────
const TENANT_ID = 'aaaaaaaa-0000-0000-0000-convtest0001'
const CONTACT_ID = 'cccccccc-0000-0000-0000-convtest0001'
const STAFF_USER_ID = 'dddddddd-0000-0000-0000-convtest0001'

function makeApp() {
  const app = express()
  app.use(express.json())
  app.use('/', conversationsRouter)
  return app
}

function seedBase() {
  store.tables['contacts'] = [
    {
      id: CONTACT_ID,
      full_name: 'Alice Test',
      phone: '+15125550001',
      email: null,
      sms_opt_in: true,
      tenant_id: TENANT_ID,
    },
  ]
  store.tables['sms_messages'] = [
    {
      id: 'msg-1',
      tenant_id: TENANT_ID,
      contact_id: CONTACT_ID,
      direction: 'inbound',
      body: 'Hello there',
      from_number: '+15125550001',
      to_number: '+15125550002',
      message_sid: null,
      status: 'received',
      ai_handled: false,
      ai_response: null,
      created_at: '2026-01-01T10:00:00Z',
    },
    {
      id: 'msg-2',
      tenant_id: TENANT_ID,
      contact_id: CONTACT_ID,
      direction: 'outbound',
      body: 'Hi Alice!',
      from_number: '+15125550002',
      to_number: '+15125550001',
      message_sid: 'sid-1',
      status: 'sent',
      ai_handled: false,
      ai_response: null,
      created_at: '2026-01-01T10:01:00Z',
    },
  ]
  store.tables['conversation_status'] = []
  store.tables['locations'] = [
    { id: 'loc-1', tenant_id: TENANT_ID, telnyx_number: '+15125550002', is_primary: true },
  ]
}

beforeEach(() => {
  store = createStore()
  mockSendSms.mockReset()
})

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('GET / — conversation list', () => {
  it('returns conversations with expected shape', async () => {
    seedBase()
    const res = await request(makeApp()).get('/?status=open')
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({
      conversations: expect.any(Array),
      total: expect.any(Number),
      page: 1,
    })
    const conv = res.body.conversations[0] as Record<string, unknown>
    expect(conv).toMatchObject({
      id: CONTACT_ID,
      contact_id: CONTACT_ID,
      contact_name: 'Alice Test',
      contact_phone: '+15125550001',
      last_message: expect.any(String),
      status: 'open',
    })
  })
})

describe('GET /:contactId/messages', () => {
  it('returns messages in ascending order', async () => {
    seedBase()
    const res = await request(makeApp()).get(`/${CONTACT_ID}/messages`)
    expect(res.status).toBe(200)
    const msgs = res.body.messages as Array<{ id: string; direction: string }>
    expect(msgs.length).toBe(2)
    expect(msgs[0]!.id).toBe('msg-1')
    expect(msgs[0]!.direction).toBe('inbound')
    expect(msgs[1]!.id).toBe('msg-2')
    expect(msgs[1]!.direction).toBe('outbound')
    expect(res.body.contact).toMatchObject({ id: CONTACT_ID, name: 'Alice Test' })
  })
})

describe('POST /:contactId/send', () => {
  it('returns 403 when contact has opted out of SMS', async () => {
    seedBase()
    ;(store.tables['contacts']![0] as Record<string, unknown>)['sms_opt_in'] = false
    const res = await request(makeApp()).post(`/${CONTACT_ID}/send`).send({ body: 'Hello' })
    expect(res.status).toBe(403)
    expect(res.body).toMatchObject({ error: expect.stringContaining('opted out') })
  })
})

describe('POST /:contactId/resolve', () => {
  it('marks conversation resolved and returns 200', async () => {
    seedBase()
    const res = await request(makeApp()).post(`/${CONTACT_ID}/resolve`)
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ resolved: true, resolved_at: expect.any(String) })
    const row = store.tables['conversation_status']?.[0] as Record<string, unknown> | undefined
    expect(row?.resolved_at).toBeTruthy()
  })
})

describe('POST /:contactId/assign', () => {
  it('assigns staff member and returns 200 with assigned_to and assigned_at', async () => {
    seedBase()
    store.tables['users'] = [
      {
        id: STAFF_USER_ID,
        tenant_id: TENANT_ID,
        full_name: 'Staff Bob',
        email: 'bob@test.com',
        is_active: true,
      },
    ]

    const res = await request(makeApp())
      .post(`/${CONTACT_ID}/assign`)
      .send({ user_id: STAFF_USER_ID })

    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({
      assigned_to: STAFF_USER_ID,
      assigned_at: expect.any(String),
    })
    const row = store.tables['conversation_status']?.[0] as Record<string, unknown> | undefined
    expect(row?.assigned_to).toBe(STAFF_USER_ID)
  })

  it('unassigns when user_id is null and returns assigned_to: null', async () => {
    seedBase()
    store.tables['conversation_status'] = [
      {
        id: 'status-1',
        tenant_id: TENANT_ID,
        contact_id: CONTACT_ID,
        assigned_to: STAFF_USER_ID,
        assigned_at: '2026-01-01T09:00:00Z',
      },
    ]

    const res = await request(makeApp()).post(`/${CONTACT_ID}/assign`).send({ user_id: null })

    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ assigned_to: null, assigned_at: null })
  })
})

describe('POST /:contactId/messages/read', () => {
  it('marks inbound unread messages as read and returns count', async () => {
    seedBase()
    // msg-1 is inbound with no read_at → should be marked
    // msg-2 is outbound → should NOT be marked

    const res = await request(makeApp()).post(`/${CONTACT_ID}/messages/read`)

    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ marked_read: 1 })

    const inbound = (store.tables['sms_messages'] ?? []).find((m) => m['id'] === 'msg-1') as
      | Record<string, unknown>
      | undefined
    expect(inbound?.read_at).toBeTruthy()
  })
})

describe('GET /analytics', () => {
  it('returns expected shape with all required keys', async () => {
    seedBase()
    const now = Date.now()
    store.tables['sms_messages'] = [
      {
        id: 'msg-a',
        tenant_id: TENANT_ID,
        contact_id: CONTACT_ID,
        direction: 'inbound',
        body: 'Hello',
        ai_handled: false,
        created_at: new Date(now - 5 * 60000).toISOString(),
      },
      {
        id: 'msg-b',
        tenant_id: TENANT_ID,
        contact_id: CONTACT_ID,
        direction: 'outbound',
        body: 'Hi!',
        ai_handled: false,
        created_at: new Date(now - 1 * 60000).toISOString(),
      },
    ]

    const res = await request(makeApp()).get('/analytics')
    expect(res.status).toBe(200)
    const body = res.body as Record<string, unknown>
    expect(body).toMatchObject({
      period_days: 30,
      total_conversations: 1,
      open_conversations: 1,
      resolved_conversations: 0,
      ai_handled_count: 0,
      ai_handled_pct: 0,
      volume_by_day: expect.any(Array),
    })
    expect('avg_response_time_minutes' in body).toBe(true)
    expect('busiest_hour' in body).toBe(true)
  })

  it('returns avg_response_time_minutes as null when no inbound→outbound pairs', async () => {
    seedBase()
    store.tables['sms_messages'] = [
      {
        id: 'msg-a',
        tenant_id: TENANT_ID,
        contact_id: CONTACT_ID,
        direction: 'inbound',
        body: 'Hello',
        ai_handled: false,
        created_at: new Date().toISOString(),
      },
    ]

    const res = await request(makeApp()).get('/analytics')
    expect(res.status).toBe(200)
    expect(res.body.avg_response_time_minutes).toBeNull()
  })

  it('returns volume_by_day with exactly 14 entries', async () => {
    seedBase()
    store.tables['sms_messages'] = [
      {
        id: 'msg-a',
        tenant_id: TENANT_ID,
        contact_id: CONTACT_ID,
        direction: 'inbound',
        body: 'Hello',
        ai_handled: false,
        created_at: new Date().toISOString(),
      },
    ]

    const res = await request(makeApp()).get('/analytics')
    expect(res.status).toBe(200)
    expect((res.body.volume_by_day as unknown[]).length).toBe(14)
  })
})
