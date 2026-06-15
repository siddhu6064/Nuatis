/**
 * Public share-token regression (migration 0130).
 *
 * The public invoice route and public chat transcript route previously keyed on
 * the raw PK UUID, making a leaked URL a forever-valid credential. They now key
 * on an unguessable share_token. These tests prove: valid token → 200, the old
 * raw-PK URL → 404 (the core fix), unknown token → 404, and that the authed
 * invoice route still resolves by id behind auth.
 */
import { jest, describe, it, expect, beforeEach } from '@jest/globals'
import { mintTestToken } from './__test-support__/jwt.js'
import {
  createStore,
  createMockSupabase,
  type MockStore,
  type Row,
} from './__test-support__/supabase-mock.js'

let store: MockStore = createStore()

jest.unstable_mockModule('@supabase/supabase-js', () => ({
  createClient: () => createMockSupabase(store),
}))

const TENANT_ID = 'aaaaaaaa-0000-0000-0000-0000000st00a1'
const SECRET = process.env['AUTH_SECRET'] ?? 'test-secret-for-unit-tests-only-32ch'
process.env['AUTH_SECRET'] = SECRET
process.env['SUPABASE_URL'] = 'https://mock.supabase.co'
process.env['SUPABASE_SERVICE_ROLE_KEY'] = 'mock-service-key'

async function makeToken(): Promise<string> {
  return mintTestToken(
    { sub: 'user-st', tenantId: TENANT_ID, role: 'owner', vertical: 'dental' },
    { secret: SECRET }
  )
}

const { default: express } = await import('express')
const { default: request } = await import('supertest')
const invoicesMod = await import('./invoices.js')
const { default: chatPublicRouter } = await import('./chat-public.js')

function makeApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/invoices/public', invoicesMod.publicRouter)
  app.use('/api/invoices', invoicesMod.default)
  app.use('/api/chat', chatPublicRouter)
  return app
}

const INVOICE_ID = 'invoice-pk-1'
const INVOICE_TOKEN = 'share-token-invoice-1'
const SESSION_ID = 'chat-pk-1'
const SESSION_TOKEN = 'share-token-session-1'

beforeEach(() => {
  store = createStore()
  store.tables['tenants'] = [
    { id: TENANT_ID, name: 'Test Biz', chat_widget_enabled: true, business_name: 'Test Biz' },
  ]
  store.tables['invoices'] = [
    {
      id: INVOICE_ID,
      tenant_id: TENANT_ID,
      share_token: INVOICE_TOKEN,
      invoice_number: 'INV-1001',
      status: 'sent',
      issue_date: '2026-06-01',
      due_date: '2026-06-15',
      subtotal: 100,
      tax_rate: 0,
      tax_amount: 0,
      total: 100,
      amount_paid: 0,
      notes: null,
      contact_id: null,
    },
  ]
  store.tables['invoice_line_items'] = []
  store.tables['chat_sessions'] = [
    { id: SESSION_ID, tenant_id: TENANT_ID, share_token: SESSION_TOKEN, status: 'active' },
  ]
  store.tables['chat_messages'] = [
    {
      id: 'msg-1',
      session_id: SESSION_ID,
      tenant_id: TENANT_ID,
      sender_type: 'visitor',
      body: 'hello',
      created_at: '2026-06-01T00:00:00Z',
    },
  ]
})

describe('Public invoice route — share_token only', () => {
  it('resolves by valid share_token (200)', async () => {
    const res = await request(makeApp()).get(`/api/invoices/public/${INVOICE_TOKEN}`)
    expect(res.status).toBe(200)
    expect(res.body.invoice_number).toBe('INV-1001')
  })

  it('does NOT resolve by the raw PK id (404 — the core fix)', async () => {
    const res = await request(makeApp()).get(`/api/invoices/public/${INVOICE_ID}`)
    expect(res.status).toBe(404)
  })

  it('returns 404 for an unknown token', async () => {
    const res = await request(makeApp()).get('/api/invoices/public/no-such-token')
    expect(res.status).toBe(404)
  })

  it('REGRESSION: authed invoice route still resolves by id', async () => {
    const res = await request(makeApp())
      .get(`/api/invoices/${INVOICE_ID}`)
      .set('Authorization', `Bearer ${await makeToken()}`)
    expect(res.status).toBe(200)
    expect(res.body.invoice_number).toBe('INV-1001')
  })
})

describe('Public chat transcript route — share_token only', () => {
  it('resolves messages by valid share_token (200)', async () => {
    const res = await request(makeApp()).get(`/api/chat/messages/${SESSION_TOKEN}`)
    expect(res.status).toBe(200)
    expect((res.body.messages as Array<unknown>).length).toBe(1)
  })

  it('does NOT resolve by the raw PK session id (404 — the core fix)', async () => {
    const res = await request(makeApp()).get(`/api/chat/messages/${SESSION_ID}`)
    expect(res.status).toBe(404)
  })

  it('returns 404 for an unknown token', async () => {
    const res = await request(makeApp()).get('/api/chat/messages/no-such-token')
    expect(res.status).toBe(404)
  })

  it('POST /init returns the share_token (not the raw PK) as sessionId', async () => {
    const res = await request(makeApp()).post('/api/chat/init').send({ tenantId: TENANT_ID })
    expect(res.status).toBe(201)
    const created = (store.tables['chat_sessions'] as Row[]).find(
      (s) => s['id'] !== SESSION_ID
    ) as Row
    // Returned identifier is the new session's share_token, never its raw PK.
    expect(res.body.sessionId).toBe(created['share_token'])
    expect(res.body.sessionId).not.toBe(created['id'])
  })
})
