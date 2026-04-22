import { jest, describe, it, expect, beforeEach } from '@jest/globals'
import { SignJWT } from 'jose'
import { randomUUID } from 'node:crypto'
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

const TENANT_ID = 'aaaaaaaa-0000-0000-0000-00000000qct1'
const USER_ID = 'user-q-001'
const CONTACT_ID = 'cccccccc-0000-0000-0000-00000000ct01'
const SECRET = process.env['AUTH_SECRET'] ?? 'test-secret-for-unit-tests-only-32ch'
process.env['AUTH_SECRET'] = SECRET
process.env['SUPABASE_URL'] = 'https://mock.supabase.co'
process.env['SUPABASE_SERVICE_ROLE_KEY'] = 'mock-service-key'
delete process.env['TELNYX_API_KEY']
delete process.env['REDIS_URL']

async function makeToken(): Promise<string> {
  const secretBytes = new TextEncoder().encode(SECRET)
  return new SignJWT({ sub: USER_ID, tenantId: TENANT_ID, role: 'owner', vertical: 'dental' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(secretBytes)
}

const [{ default: express }, { default: request }, { default: quotesRouter }] = await Promise.all([
  import('express'),
  import('supertest'),
  import('./quotes.js'),
])

function makeApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/quotes', quotesRouter)
  return app
}

function seedCpqEnabled(): void {
  store.tables['tenants'] = [
    {
      id: TENANT_ID,
      name: 'Nuatis Test Clinic',
      modules: { crm: true, cpq: true },
      settings: {},
      cpq_settings: { max_discount_pct: 20, require_approval_above: 15, deposit_pct: 0 },
    },
  ]
}

function seedCpqDisabled(): void {
  store.tables['tenants'] = [
    { id: TENANT_ID, name: 'Nuatis', modules: { crm: true, cpq: false }, settings: {} },
  ]
}

function seedContact(): void {
  store.tables['contacts'] = [
    { id: CONTACT_ID, tenant_id: TENANT_ID, full_name: 'Jane Customer', email: null, phone: null },
  ]
}

beforeEach(() => {
  store = createStore()
  store.tables['quotes'] = []
  store.tables['quote_line_items'] = []
  store.tables['activity_log'] = []
  store.tables['audit_log'] = []
  store.tables['inventory_items'] = []
  store.tables['locations'] = []
  store.tables['push_subscriptions'] = []
  store.tables['webhooks'] = []
  store.tables['webhook_subscriptions'] = []
})

// ── POST /api/quotes ─────────────────────────────────────────────────────────

describe('POST /api/quotes', () => {
  it('creates a quote and returns 201 with quote_number', async () => {
    seedCpqEnabled()
    seedContact()
    const token = await makeToken()
    const res = await request(makeApp())
      .post('/api/quotes')
      .set('Authorization', `Bearer ${token}`)
      .send({
        title: 'Test Quote',
        contact_id: CONTACT_ID,
        line_items: [{ description: 'Exam', quantity: 1, unit_price: 100 }],
      })

    expect(res.status).toBe(201)
    expect(res.body.id).toBeDefined()
    expect(res.body.quote_number).toMatch(/^Q-\d+/)
  })

  it('returns 401 without auth token', async () => {
    seedCpqEnabled()
    const res = await request(makeApp())
      .post('/api/quotes')
      .send({
        title: 'X',
        line_items: [{ description: 'x', quantity: 1, unit_price: 1 }],
      })
    expect(res.status).toBe(401)
  })

  it('returns 403 when modules.cpq is false', async () => {
    seedCpqDisabled()
    const token = await makeToken()
    const res = await request(makeApp())
      .post('/api/quotes')
      .set('Authorization', `Bearer ${token}`)
      .send({
        title: 'X',
        line_items: [{ description: 'x', quantity: 1, unit_price: 1 }],
      })
    expect(res.status).toBe(403)
  })
})

// ── GET /api/quotes/:id ──────────────────────────────────────────────────────

describe('GET /api/quotes/:id', () => {
  it('returns quote with line items attached', async () => {
    seedCpqEnabled()
    const quoteId = randomUUID()
    store.tables['quotes']!.push({
      id: quoteId,
      tenant_id: TENANT_ID,
      quote_number: 'Q-2026-0001',
      title: 'Sample',
      status: 'draft',
      total: 100,
    })
    store.tables['quote_line_items']!.push({
      id: randomUUID(),
      quote_id: quoteId,
      description: 'Exam',
      quantity: 1,
      unit_price: 100,
      total: 100,
      sort_order: 0,
    })

    const token = await makeToken()
    const res = await request(makeApp())
      .get(`/api/quotes/${quoteId}`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(Array.isArray(res.body.line_items)).toBe(true)
    expect(res.body.line_items.length).toBe(1)
  })

  it('returns 403 when modules.cpq is false — gate fix verified', async () => {
    seedCpqDisabled()
    const quoteId = randomUUID()
    store.tables['quotes']!.push({
      id: quoteId,
      tenant_id: TENANT_ID,
      quote_number: 'Q-2026-0002',
      title: 'X',
      status: 'draft',
      total: 100,
    })
    const token = await makeToken()
    const res = await request(makeApp())
      .get(`/api/quotes/${quoteId}`)
      .set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(403)
  })
})

// ── POST /api/quotes/:id/send ────────────────────────────────────────────────

describe('POST /api/quotes/:id/send', () => {
  it('marks quote as sent and returns { sent: true }', async () => {
    seedCpqEnabled()
    seedContact()
    const quoteId = randomUUID()
    store.tables['quotes']!.push({
      id: quoteId,
      tenant_id: TENANT_ID,
      contact_id: CONTACT_ID,
      quote_number: 'Q-2026-0003',
      title: 'Sample',
      status: 'draft',
      total: 100,
      share_token: 'share-abc',
      approval_status: null,
      discount_pct: 0,
    })

    const token = await makeToken()
    const res = await request(makeApp())
      .post(`/api/quotes/${quoteId}/send`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.sent).toBe(true)
    const stored = (store.tables['quotes'] as Row[]).find((q) => q['id'] === quoteId)
    expect(stored?.['status']).toBe('sent')
  })

  it('returns 403 when modules.cpq is false — gate fix verified', async () => {
    seedCpqDisabled()
    const quoteId = randomUUID()
    store.tables['quotes']!.push({
      id: quoteId,
      tenant_id: TENANT_ID,
      title: 'X',
      status: 'draft',
      total: 1,
      share_token: 'share-xyz',
    })
    const token = await makeToken()
    const res = await request(makeApp())
      .post(`/api/quotes/${quoteId}/send`)
      .set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(403)
  })
})

// ── POST /api/quotes/:id/duplicate ───────────────────────────────────────────

describe('POST /api/quotes/:id/duplicate', () => {
  it('creates a new quote with same line items', async () => {
    seedCpqEnabled()
    const origId = randomUUID()
    store.tables['quotes']!.push({
      id: origId,
      tenant_id: TENANT_ID,
      quote_number: 'Q-2026-0004',
      title: 'Original',
      status: 'draft',
      subtotal: 200,
      tax_rate: 0,
      tax_amount: 0,
      total: 200,
      notes: null,
    })
    store.tables['quote_line_items']!.push(
      {
        id: randomUUID(),
        quote_id: origId,
        description: 'A',
        quantity: 1,
        unit_price: 100,
        total: 100,
        sort_order: 0,
      },
      {
        id: randomUUID(),
        quote_id: origId,
        description: 'B',
        quantity: 1,
        unit_price: 100,
        total: 100,
        sort_order: 1,
      }
    )

    const token = await makeToken()
    const res = await request(makeApp())
      .post(`/api/quotes/${origId}/duplicate`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(201)
    expect(res.body.id).toBeDefined()
    expect(res.body.id).not.toBe(origId)

    const childItems = (store.tables['quote_line_items'] as Row[]).filter(
      (r) => r['quote_id'] === res.body.id
    )
    expect(childItems.length).toBe(2)
  })
})

// ── POST /api/quotes/view/:token/accept ──────────────────────────────────────

describe('POST /api/quotes/view/:token/accept', () => {
  it('sets status to accepted and returns { accepted: true }', async () => {
    seedCpqEnabled()
    const quoteId = randomUUID()
    const shareToken = 'tok-accept-1'
    store.tables['quotes']!.push({
      id: quoteId,
      tenant_id: TENANT_ID,
      contact_id: null,
      quote_number: 'Q-2026-0005',
      title: 'Customer view',
      status: 'sent',
      total: 100,
      share_token: shareToken,
      followup_job_id: null,
    })

    const res = await request(makeApp()).post(`/api/quotes/view/${shareToken}/accept`)

    expect(res.status).toBe(200)
    expect(res.body.accepted).toBe(true)
    const stored = (store.tables['quotes'] as Row[]).find((q) => q['id'] === quoteId)
    expect(stored?.['status']).toBe('accepted')
    expect(stored?.['accepted_at']).toBeDefined()
  })

  it('returns 404 for unknown token', async () => {
    seedCpqEnabled()
    const res = await request(makeApp()).post('/api/quotes/view/invalid-token-xyz/accept')
    expect(res.status).toBe(404)
  })

  it('inventory auto-deduct fires when flag is true', async () => {
    // Tenant with auto-deduct ON.
    store.tables['tenants'] = [
      {
        id: TENANT_ID,
        name: 'Clinic',
        modules: { crm: true, cpq: true },
        settings: { inventory_auto_deduct: true },
      },
    ]

    const invItemId = randomUUID()
    store.tables['inventory_items']!.push({
      id: invItemId,
      tenant_id: TENANT_ID,
      name: 'Exam Gloves',
      quantity: 10,
      reorder_threshold: 2,
      unit: 'box',
      deleted_at: null,
    })

    const quoteId = randomUUID()
    const shareToken = 'tok-deduct-1'
    store.tables['quotes']!.push({
      id: quoteId,
      tenant_id: TENANT_ID,
      contact_id: null,
      quote_number: 'Q-2026-0006',
      title: 'Deduct test',
      status: 'sent',
      total: 30,
      share_token: shareToken,
      followup_job_id: null,
    })
    store.tables['quote_line_items']!.push({
      id: randomUUID(),
      quote_id: quoteId,
      inventory_item_id: invItemId,
      description: 'Gloves',
      quantity: 3,
      unit_price: 10,
      total: 30,
      sort_order: 0,
    })

    const res = await request(makeApp()).post(`/api/quotes/view/${shareToken}/accept`)
    expect(res.status).toBe(200)

    const item = (store.tables['inventory_items'] as Row[]).find((r) => r['id'] === invItemId)
    expect(item?.['quantity']).toBe(7)
  })
})

// ── POST /api/quotes/view/:token/decline ─────────────────────────────────────

describe('POST /api/quotes/view/:token/decline', () => {
  it('sets status to declined and returns { declined: true }', async () => {
    seedCpqEnabled()
    const quoteId = randomUUID()
    const shareToken = 'tok-decline-1'
    store.tables['quotes']!.push({
      id: quoteId,
      tenant_id: TENANT_ID,
      contact_id: null,
      quote_number: 'Q-2026-0007',
      title: 'Decline me',
      status: 'sent',
      total: 50,
      share_token: shareToken,
      followup_job_id: null,
    })

    const res = await request(makeApp()).post(`/api/quotes/view/${shareToken}/decline`)

    expect(res.status).toBe(200)
    expect(res.body.declined).toBe(true)
    const stored = (store.tables['quotes'] as Row[]).find((q) => q['id'] === quoteId)
    expect(stored?.['status']).toBe('declined')
  })
})
