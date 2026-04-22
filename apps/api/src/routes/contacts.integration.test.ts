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

const enqueueScoreCompute = jest.fn<() => void>()
const notifyOwner = jest.fn(async () => undefined)
const logActivity = jest.fn(async () => undefined)
const autoEnrichContact = jest.fn(() => ({
  updates: {},
  suggestedCompany: null,
}))

jest.unstable_mockModule('@supabase/supabase-js', () => ({
  createClient: () => createMockSupabase(store),
}))
jest.unstable_mockModule('../lib/lead-score-queue.js', () => ({ enqueueScoreCompute }))
jest.unstable_mockModule('../lib/notifications.js', () => ({ notifyOwner }))
jest.unstable_mockModule('../lib/activity.js', () => ({ logActivity }))
jest.unstable_mockModule('../lib/contact-enrichment.js', () => ({ autoEnrichContact }))

const TENANT_ID = 'aaaaaaaa-0000-0000-0000-00000ct00001'
const USER_ID = 'user-ct-001'
const SECRET = process.env['AUTH_SECRET'] ?? 'test-secret-for-unit-tests-only-32ch'
process.env['AUTH_SECRET'] = SECRET
process.env['SUPABASE_URL'] = 'https://mock.supabase.co'
process.env['SUPABASE_SERVICE_ROLE_KEY'] = 'mock-service-key'

async function makeToken(): Promise<string> {
  const secretBytes = new TextEncoder().encode(SECRET)
  return new SignJWT({ sub: USER_ID, tenantId: TENANT_ID, role: 'owner', vertical: 'dental' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(secretBytes)
}

const [{ default: express }, { default: request }, { default: contactsRouter }] = await Promise.all(
  [import('express'), import('supertest'), import('./contacts.js')]
)

function makeApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/contacts', contactsRouter)
  return app
}

function seedContact(partial: Partial<Row> = {}): string {
  const id = randomUUID()
  ;(store.tables['contacts'] as Row[]).push({
    id,
    tenant_id: TENANT_ID,
    full_name: 'Jane Doe',
    phone: null,
    email: null,
    tags: [],
    is_archived: false,
    lifecycle_stage: 'lead',
    pipeline_stage: null,
    assigned_to_user_id: null,
    created_at: new Date().toISOString(),
    ...partial,
  })
  return id
}

beforeEach(() => {
  store = createStore()
  store.tables['contacts'] = []
  store.tables['pipeline_stages'] = []
  store.tables['activity_log'] = []
  store.tables['tasks'] = []
  store.tables['appointments'] = []
  store.tables['quotes'] = []
  enqueueScoreCompute.mockClear()
  notifyOwner.mockClear()
  logActivity.mockClear()
  autoEnrichContact.mockClear()
  autoEnrichContact.mockReturnValue({ updates: {}, suggestedCompany: null })
})

// ── GET /api/contacts ────────────────────────────────────────────────────────

describe('GET /api/contacts', () => {
  it('returns 200 with empty array for tenant with no contacts', async () => {
    const token = await makeToken()
    const res = await request(makeApp())
      .get('/api/contacts')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(Array.isArray(res.body.contacts)).toBe(true)
    expect(res.body.contacts.length).toBe(0)
  })

  it('returns 401 without auth token', async () => {
    const res = await request(makeApp()).get('/api/contacts')
    expect(res.status).toBe(401)
  })
})

// ── POST /api/contacts ───────────────────────────────────────────────────────

describe('POST /api/contacts', () => {
  it('creates contact and returns 201 with id', async () => {
    const token = await makeToken()
    const res = await request(makeApp())
      .post('/api/contacts')
      .set('Authorization', `Bearer ${token}`)
      .send({
        full_name: 'Jane Doe',
        phone: '+15125550001',
        email: 'jane@example.com',
      })

    expect(res.status).toBe(201)
    expect(res.body.id).toBeDefined()
    expect(res.body.full_name).toBe('Jane Doe')
    expect(enqueueScoreCompute).toHaveBeenCalledTimes(1)
    const args = enqueueScoreCompute.mock.calls[0]! as unknown as [string, string, string]
    expect(args[2]).toBe('contact_created')
  })

  it('returns 400 when full_name is missing', async () => {
    const token = await makeToken()
    const res = await request(makeApp())
      .post('/api/contacts')
      .set('Authorization', `Bearer ${token}`)
      .send({ phone: '+15125550001' })

    expect(res.status).toBe(400)
    expect(res.body.error).toBeDefined()
  })
})

// ── PUT /api/contacts/:id ────────────────────────────────────────────────────

describe('PUT /api/contacts/:id', () => {
  it('updates contact and triggers score recompute', async () => {
    const id = seedContact({ pipeline_stage: 'New Lead' })
    const token = await makeToken()
    const res = await request(makeApp())
      .put(`/api/contacts/${id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ pipeline_stage: 'Qualified' })

    expect(res.status).toBe(200)
    expect(res.body.pipeline_stage).toBe('Qualified')
    expect(enqueueScoreCompute).toHaveBeenCalledTimes(1)
    const args = enqueueScoreCompute.mock.calls[0]! as unknown as [string, string, string]
    expect(args[2]).toBe('contact_updated')
  })
})

// ── GET /api/contacts/duplicates ─────────────────────────────────────────────

describe('GET /api/contacts/duplicates', () => {
  it('returns candidate pairs when fuzzy matches exist', async () => {
    seedContact({ full_name: 'Jane A', phone: '+15125550001', email: null })
    seedContact({ full_name: 'Jane B', phone: '+15125550001', email: null })
    const token = await makeToken()
    const res = await request(makeApp())
      .get('/api/contacts/duplicates')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(Array.isArray(res.body.pairs)).toBe(true)
    expect(res.body.pairs.length).toBeGreaterThanOrEqual(1)
  })

  it('returns empty pairs when no duplicates exist', async () => {
    seedContact({ full_name: 'Alice', phone: '+15551110001', email: 'a@example.com' })
    seedContact({ full_name: 'Bob', phone: '+15552220002', email: 'b@example.com' })
    const token = await makeToken()
    const res = await request(makeApp())
      .get('/api/contacts/duplicates')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.pairs.length).toBe(0)
  })
})

// ── POST /api/contacts/merge ─────────────────────────────────────────────────

describe('POST /api/contacts/merge', () => {
  it('merges duplicate contacts, archives secondary, returns primary', async () => {
    const primaryId = seedContact({ full_name: 'Primary Jane', phone: '+15125550001' })
    const secondaryId = seedContact({ full_name: 'Secondary Jane', phone: '+15125550001' })
    const token = await makeToken()

    const res = await request(makeApp())
      .post('/api/contacts/merge')
      .set('Authorization', `Bearer ${token}`)
      .send({ primary_id: primaryId, secondary_id: secondaryId })

    expect(res.status).toBe(200)
    expect(res.body.id).toBe(primaryId)

    // Secondary is archived; default GET excludes archived, so it should not appear
    const listRes = await request(makeApp())
      .get('/api/contacts')
      .set('Authorization', `Bearer ${token}`)
    const returnedIds = (listRes.body.contacts as Array<{ id: string }>).map((c) => c.id)
    expect(returnedIds).toContain(primaryId)
    expect(returnedIds).not.toContain(secondaryId)
  })
})

// ── POST /api/contacts/bulk/stage ────────────────────────────────────────────

describe('POST /api/contacts/bulk/stage', () => {
  it('updates pipeline_stage for multiple contacts', async () => {
    const stageId = randomUUID()
    ;(store.tables['pipeline_stages'] as Row[]).push({
      id: stageId,
      tenant_id: TENANT_ID,
      name: 'Qualified',
    })
    const id1 = seedContact({ full_name: 'A' })
    const id2 = seedContact({ full_name: 'B' })
    const token = await makeToken()

    const res = await request(makeApp())
      .post('/api/contacts/bulk/stage')
      .set('Authorization', `Bearer ${token}`)
      .send({ contact_ids: [id1, id2], pipeline_stage_id: stageId })

    expect(res.status).toBe(200)
    const rows = store.tables['contacts'] as Row[]
    expect(rows.find((r) => r['id'] === id1)?.['pipeline_stage']).toBe('Qualified')
    expect(rows.find((r) => r['id'] === id2)?.['pipeline_stage']).toBe('Qualified')
  })
})

// ── POST /api/contacts/bulk/archive ──────────────────────────────────────────

describe('POST /api/contacts/bulk/archive', () => {
  it('archives multiple contacts', async () => {
    const id1 = seedContact({ full_name: 'A' })
    const id2 = seedContact({ full_name: 'B' })
    const token = await makeToken()

    const archiveRes = await request(makeApp())
      .post('/api/contacts/bulk/archive')
      .set('Authorization', `Bearer ${token}`)
      .send({ contact_ids: [id1, id2] })

    expect(archiveRes.status).toBe(200)

    const listRes = await request(makeApp())
      .get('/api/contacts')
      .set('Authorization', `Bearer ${token}`)
    const ids = (listRes.body.contacts as Array<{ id: string }>).map((c) => c.id)
    expect(ids).not.toContain(id1)
    expect(ids).not.toContain(id2)
  })
})

// ── PATCH /api/contacts/:id/lifecycle ────────────────────────────────────────

describe('PATCH /api/contacts/:id/lifecycle', () => {
  it('transitions lifecycle_stage and logs activity', async () => {
    const id = seedContact({ lifecycle_stage: 'lead' })
    const token = await makeToken()

    const res = await request(makeApp())
      .patch(`/api/contacts/${id}/lifecycle`)
      .set('Authorization', `Bearer ${token}`)
      .send({ lifecycle_stage: 'customer' })

    expect(res.status).toBe(200)
    expect(res.body.lifecycle_stage).toBe('customer')
    expect(logActivity).toHaveBeenCalled()
    const call = logActivity.mock.calls.find(
      (c) => (c[0] as { type?: string }).type === 'lifecycle_change'
    )
    expect(call).toBeDefined()
  })

  it('returns 400 for invalid lifecycle_stage value', async () => {
    const id = seedContact({ lifecycle_stage: 'lead' })
    const token = await makeToken()

    const res = await request(makeApp())
      .patch(`/api/contacts/${id}/lifecycle`)
      .set('Authorization', `Bearer ${token}`)
      .send({ lifecycle_stage: 'not_a_real_stage' })

    expect(res.status).toBe(400)
  })
})

// ── PUT assignment triggers notifyOwner ─────────────────────────────────────

describe('PUT /api/contacts/:id — assignment change', () => {
  it('logs assignment activity + notifies owner when assigned_to_user_id changes', async () => {
    const id = seedContact({ assigned_to_user_id: null })
    ;(store.tables['users'] = store.tables['users'] ?? []).push({
      id: 'user-new-assignee',
      full_name: 'New Assignee',
    })
    const token = await makeToken()

    const res = await request(makeApp())
      .put(`/api/contacts/${id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ assigned_to_user_id: 'user-new-assignee' })

    expect(res.status).toBe(200)
    expect(notifyOwner).toHaveBeenCalledTimes(1)
    const [, eventKey] = notifyOwner.mock.calls[0]! as unknown as [string, string, unknown]
    expect(eventKey).toBe('contact_assigned')
  })
})

// ── GET /api/contacts/:id ───────────────────────────────────────────────────

describe('GET /api/contacts/:id', () => {
  it('returns contact detail for a valid id', async () => {
    const id = seedContact({ full_name: 'Single Target' })
    const token = await makeToken()

    const res = await request(makeApp())
      .get(`/api/contacts/${id}`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.id).toBe(id)
    expect(res.body.full_name).toBe('Single Target')
  })
})
