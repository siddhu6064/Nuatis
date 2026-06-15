/**
 * FILT-1 security regression — proves each search route APPLIES sanitizeSearchTerm
 * before building its PostgREST .or() filter (not just that the helper is correct
 * in isolation).
 *
 * The supabase mock does not expose the raw .or() argument for direct assertion,
 * so this uses a behavioral proof: a "decoy" row is seeded that the mock would
 * return ONLY if an injected `,<col>.ilike.<needle>` clause survived into the
 * filter (the mock splits .or() on commas, mirroring PostgREST). With the route
 * sanitizing (commas stripped), the injected clause cannot form, so the decoy is
 * NOT returned. A plain-term positive control proves the decoy is otherwise
 * findable, and an apostrophe control proves legitimate punctuation is preserved.
 *
 * If a route stopped calling the sanitizer, the comma would reach .or(), the
 * decoy would leak, and the injection test would fail — the regression we want.
 */
import { jest, describe, it, expect, beforeEach } from '@jest/globals'
import { mintTestToken } from './__test-support__/jwt.js'
import {
  createStore,
  createMockSupabase,
  type MockStore,
} from './__test-support__/supabase-mock.js'
import { seedEntitledTenant } from './__test-support__/tenant-fixture.js'

let store: MockStore = createStore()

jest.unstable_mockModule('@supabase/supabase-js', () => ({
  createClient: () => createMockSupabase(store),
}))

const A_TENANT = 'aaaaaaaa-0000-0000-0000-0000000fi00a1'
const SECRET = process.env['AUTH_SECRET'] ?? 'test-secret-for-unit-tests-only-32ch'
process.env['AUTH_SECRET'] = SECRET
process.env['SUPABASE_URL'] = 'https://mock.supabase.co'
process.env['SUPABASE_SERVICE_ROLE_KEY'] = 'mock-service-key'

async function token(): Promise<string> {
  return mintTestToken(
    { sub: 'user-a', tenantId: A_TENANT, role: 'owner', vertical: 'dental' },
    { secret: SECRET }
  )
}

// Import sequentially (not Promise.all): linking five route modules — each of
// which imports auth.ts → jose — concurrently triggers a Jest ESM module-linking
// race ("request for 'jose' can not be resolved ... not linked").
const { default: express } = await import('express')
const { default: request } = await import('supertest')
const { default: contactsRouter } = await import('./contacts.js')
const { default: searchRouter } = await import('./search.js')
const { default: companiesRouter } = await import('./companies.js')
const { default: snippetsRouter } = await import('./snippets.js')
const { default: inventoryRouter } = await import('./inventory.js')

function makeApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/contacts', contactsRouter)
  app.use('/api/search', searchRouter)
  app.use('/api/companies', companiesRouter)
  app.use('/api/snippets', snippetsRouter)
  app.use('/api/inventory', inventoryRouter)
  return app
}

const DECOY_C = 'contact-decoy'
const DECOY_CO = 'co-decoy'
const DECOY_S = 'snip-decoy'
const DECOY_I = 'inv-decoy'

beforeEach(() => {
  store = createStore()
  seedEntitledTenant(store, A_TENANT)
  store.tables['contacts'] = [
    {
      id: DECOY_C,
      tenant_id: A_TENANT,
      full_name: 'NoMatchName',
      email: 'decoy@example.com',
      phone: null,
      is_archived: false,
    },
    {
      id: 'contact-ob',
      tenant_id: A_TENANT,
      full_name: "O'Brien",
      email: 'ob@example.com',
      phone: null,
      is_archived: false,
    },
  ]
  store.tables['companies'] = [
    {
      id: DECOY_CO,
      tenant_id: A_TENANT,
      name: 'NoMatchCo',
      domain: 'decoy.com',
      is_archived: false,
    },
    { id: 'co-ob', tenant_id: A_TENANT, name: "O'Brien Co", domain: 'ob.com', is_archived: false },
  ]
  store.tables['snippets'] = [
    { id: DECOY_S, tenant_id: A_TENANT, name: 'ZzzNoMatch', shortcut: 'decoy-sc', body: 'b' },
    { id: 'snip-ob', tenant_id: A_TENANT, name: "O'Brien", shortcut: 'obr', body: 'b' },
  ]
  store.tables['inventory_items'] = [
    {
      id: DECOY_I,
      tenant_id: A_TENANT,
      name: 'ZzzNoMatch',
      sku: 'DECOYSKU',
      quantity: 1,
      reorder_threshold: 0,
      deleted_at: null,
    },
    {
      id: 'inv-ob',
      tenant_id: A_TENANT,
      name: "O'Brien",
      sku: 'OBSKU',
      quantity: 1,
      reorder_threshold: 0,
      deleted_at: null,
    },
  ]
  store.tables['appointments'] = []
  store.tables['quotes'] = []
})

function ids(arr: unknown): string[] {
  return ((arr as Array<{ id: string }>) ?? []).map((r) => r.id)
}

describe('FILT-1 — contacts route sanitizes q', () => {
  it('comma-injection does not leak the decoy (route sanitized) and returns 200', async () => {
    const res = await request(makeApp())
      .get('/api/contacts?q=zzz,email.ilike.decoy')
      .set('Authorization', `Bearer ${await token()}`)
    expect(res.status).toBe(200)
    expect(ids(res.body.contacts)).not.toContain(DECOY_C)
  })
  it('paren-injection does not crash (200)', async () => {
    const res = await request(makeApp())
      .get('/api/contacts?q=a)(b')
      .set('Authorization', `Bearer ${await token()}`)
    expect(res.status).toBe(200)
  })
  it('POSITIVE CONTROL: plain term finds the decoy', async () => {
    const res = await request(makeApp())
      .get('/api/contacts?q=decoy')
      .set('Authorization', `Bearer ${await token()}`)
    expect(ids(res.body.contacts)).toContain(DECOY_C)
  })
  it("apostrophe preserved: q=O'Brien matches", async () => {
    const res = await request(makeApp())
      .get("/api/contacts?q=O'Brien")
      .set('Authorization', `Bearer ${await token()}`)
    expect(ids(res.body.contacts)).toContain('contact-ob')
  })
})

describe('FILT-1 — search route sanitizes q', () => {
  it('comma-injection does not leak the decoy and returns 200', async () => {
    const res = await request(makeApp())
      .get('/api/search?q=zzz,email.ilike.decoy')
      .set('Authorization', `Bearer ${await token()}`)
    expect(res.status).toBe(200)
    expect(ids(res.body.contacts)).not.toContain(DECOY_C)
  })
  it('paren-injection does not crash (200)', async () => {
    const res = await request(makeApp())
      .get('/api/search?q=a)(b')
      .set('Authorization', `Bearer ${await token()}`)
    expect(res.status).toBe(200)
  })
  it('POSITIVE CONTROL: plain term finds the decoy', async () => {
    const res = await request(makeApp())
      .get('/api/search?q=decoy')
      .set('Authorization', `Bearer ${await token()}`)
    expect(ids(res.body.contacts)).toContain(DECOY_C)
  })
  it("apostrophe preserved: q=O'Brien matches", async () => {
    const res = await request(makeApp())
      .get("/api/search?q=O'Brien")
      .set('Authorization', `Bearer ${await token()}`)
    expect(ids(res.body.contacts)).toContain('contact-ob')
  })
})

describe('FILT-1 — companies route sanitizes q', () => {
  it('comma-injection does not leak the decoy and returns 200', async () => {
    const res = await request(makeApp())
      .get('/api/companies?q=zzz,domain.ilike.decoy')
      .set('Authorization', `Bearer ${await token()}`)
    expect(res.status).toBe(200)
    expect(ids(res.body.companies)).not.toContain(DECOY_CO)
  })
  it('paren-injection does not crash (200)', async () => {
    const res = await request(makeApp())
      .get('/api/companies?q=a)(b')
      .set('Authorization', `Bearer ${await token()}`)
    expect(res.status).toBe(200)
  })
  it('POSITIVE CONTROL: plain term finds the decoy', async () => {
    const res = await request(makeApp())
      .get('/api/companies?q=decoy')
      .set('Authorization', `Bearer ${await token()}`)
    expect(ids(res.body.companies)).toContain(DECOY_CO)
  })
  it("apostrophe preserved: q=O'Brien matches", async () => {
    const res = await request(makeApp())
      .get("/api/companies?q=O'Brien")
      .set('Authorization', `Bearer ${await token()}`)
    expect(ids(res.body.companies)).toContain('co-ob')
  })
})

describe('FILT-1 — snippets route sanitizes q', () => {
  it('comma-injection does not leak the decoy and returns 200', async () => {
    const res = await request(makeApp())
      .get('/api/snippets/search?q=zzz,shortcut.ilike.decoy')
      .set('Authorization', `Bearer ${await token()}`)
    expect(res.status).toBe(200)
    expect(ids(res.body.snippets)).not.toContain(DECOY_S)
  })
  it('paren-injection does not crash (200)', async () => {
    const res = await request(makeApp())
      .get('/api/snippets/search?q=a)(b')
      .set('Authorization', `Bearer ${await token()}`)
    expect(res.status).toBe(200)
  })
  it('POSITIVE CONTROL: plain term finds the decoy', async () => {
    const res = await request(makeApp())
      .get('/api/snippets/search?q=decoy')
      .set('Authorization', `Bearer ${await token()}`)
    expect(ids(res.body.snippets)).toContain(DECOY_S)
  })
  it("apostrophe preserved: q=O'Brien matches", async () => {
    const res = await request(makeApp())
      .get("/api/snippets/search?q=O'Brien")
      .set('Authorization', `Bearer ${await token()}`)
    expect(ids(res.body.snippets)).toContain('snip-ob')
  })
})

describe('FILT-1 — inventory route sanitizes q', () => {
  it('comma-injection does not leak the decoy and returns 200', async () => {
    const res = await request(makeApp())
      .get('/api/inventory?q=zzz,sku.ilike.decoy')
      .set('Authorization', `Bearer ${await token()}`)
    expect(res.status).toBe(200)
    expect(ids(res.body.data)).not.toContain(DECOY_I)
  })
  it('paren-injection does not crash (200)', async () => {
    const res = await request(makeApp())
      .get('/api/inventory?q=a)(b')
      .set('Authorization', `Bearer ${await token()}`)
    expect(res.status).toBe(200)
  })
  it('POSITIVE CONTROL: plain term finds the decoy', async () => {
    const res = await request(makeApp())
      .get('/api/inventory?q=decoy')
      .set('Authorization', `Bearer ${await token()}`)
    expect(ids(res.body.data)).toContain(DECOY_I)
  })
  it("apostrophe preserved: q=O'Brien matches", async () => {
    const res = await request(makeApp())
      .get("/api/inventory?q=O'Brien")
      .set('Authorization', `Bearer ${await token()}`)
    expect(ids(res.body.data)).toContain('inv-ob')
  })
})
