/**
 * IDOR-1 security regression — calendar-groups cross-tenant location access.
 *
 * Two tenants: A (acting) and B (victim). Proves a location owned by B cannot
 * be referenced through A's calendar group via the member-insert path, the
 * reorder (members/order) path, or counted in A's load-balanced /assign.
 * Each cross-tenant rejection is paired with a positive control that succeeds.
 */
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

const A_TENANT = 'aaaaaaaa-0000-0000-0000-0000000cg00a1'
const B_TENANT = 'bbbbbbbb-0000-0000-0000-0000000cg00b1'
const SECRET = process.env['AUTH_SECRET'] ?? 'test-secret-for-unit-tests-only-32ch'
process.env['AUTH_SECRET'] = SECRET
process.env['SUPABASE_URL'] = 'https://mock.supabase.co'
process.env['SUPABASE_SERVICE_ROLE_KEY'] = 'mock-service-key'

async function makeToken(tenantId: string, userId: string): Promise<string> {
  return mintTestToken(
    { sub: userId, tenantId, role: 'owner', vertical: 'dental' },
    { secret: SECRET }
  )
}

const [{ default: express }, { default: request }, { default: calendarGroupsRouter }] =
  await Promise.all([import('express'), import('supertest'), import('./calendar-groups.js')])

function makeApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/calendar-groups', calendarGroupsRouter)
  return app
}

const A_GROUP = 'group-a-001'
const A_LOC1 = 'loc-a-001'
const A_LOC2 = 'loc-a-002'
const B_LOC = 'loc-b-001'

beforeEach(() => {
  store = createStore()
  store.tables['tenants'] = [entitledTenantRow(A_TENANT), entitledTenantRow(B_TENANT)]
  store.tables['locations'] = [
    { id: A_LOC1, tenant_id: A_TENANT, name: 'A Location 1' },
    { id: A_LOC2, tenant_id: A_TENANT, name: 'A Location 2' },
    { id: B_LOC, tenant_id: B_TENANT, name: 'B Location' },
  ]
  store.tables['calendar_groups'] = [
    {
      id: A_GROUP,
      tenant_id: A_TENANT,
      name: 'A Group',
      assignment_mode: 'load_balanced',
      last_assigned_index: 0,
    },
  ]
  store.tables['calendar_group_members'] = []
  store.tables['appointments'] = []
})

describe('IDOR-1 — member insert', () => {
  it("rejects (404) a member insert referencing tenant B's location and inserts nothing", async () => {
    const token = await makeToken(A_TENANT, 'user-a')
    const res = await request(makeApp())
      .post(`/api/calendar-groups/${A_GROUP}/members`)
      .set('Authorization', `Bearer ${token}`)
      .send({ locationId: B_LOC })

    expect(res.status).toBe(404)
    const members = store.tables['calendar_group_members'] as Row[]
    expect(members.some((m) => m['location_id'] === B_LOC)).toBe(false)
    expect(members.length).toBe(0)
  })

  it("POSITIVE CONTROL: accepts a member insert of tenant A's own location", async () => {
    const token = await makeToken(A_TENANT, 'user-a')
    const res = await request(makeApp())
      .post(`/api/calendar-groups/${A_GROUP}/members`)
      .set('Authorization', `Bearer ${token}`)
      .send({ locationId: A_LOC1 })

    expect(res.status).toBe(201)
    const members = store.tables['calendar_group_members'] as Row[]
    expect(members.some((m) => m['location_id'] === A_LOC1)).toBe(true)
  })
})

describe('IDOR-1 — reorder (members/order)', () => {
  it("rejects (404) a reorder payload containing tenant B's location and upserts nothing new", async () => {
    // Pre-seed A's own member so we can assert the set is unchanged after rejection.
    ;(store.tables['calendar_group_members'] as Row[]).push({
      group_id: A_GROUP,
      location_id: A_LOC1,
      position: 0,
    })
    const token = await makeToken(A_TENANT, 'user-a')
    const res = await request(makeApp())
      .put(`/api/calendar-groups/${A_GROUP}/members/order`)
      .set('Authorization', `Bearer ${token}`)
      .send({ order: [A_LOC1, B_LOC] })

    expect(res.status).toBe(404)
    const members = store.tables['calendar_group_members'] as Row[]
    expect(members.some((m) => m['location_id'] === B_LOC)).toBe(false)
    // Original membership untouched.
    expect(members.filter((m) => m['location_id'] === A_LOC1).length).toBe(1)
  })

  it("POSITIVE CONTROL: accepts a reorder of tenant A's own locations", async () => {
    const token = await makeToken(A_TENANT, 'user-a')
    const res = await request(makeApp())
      .put(`/api/calendar-groups/${A_GROUP}/members/order`)
      .set('Authorization', `Bearer ${token}`)
      .send({ order: [A_LOC1, A_LOC2] })

    expect(res.status).toBe(200)
    expect(res.body.updated).toBe(true)
  })
})

describe('IDOR-1 — /assign load-balanced count', () => {
  function seedAssignMembers(): void {
    ;(store.tables['calendar_group_members'] as Row[]).push(
      { group_id: A_GROUP, location_id: A_LOC1, position: 0 },
      { group_id: A_GROUP, location_id: A_LOC2, position: 1 }
    )
  }
  const soon = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()

  it("does NOT count tenant B's appointments toward A's load balancing", async () => {
    seedAssignMembers()
    // B has many appointments referencing A_LOC1 (cross-tenant id reuse). If the
    // count query were not tenant-scoped, A_LOC1 would look busy and /assign would
    // pick A_LOC2. Tenant-scoped, both A locations have 0 → first (A_LOC1) wins.
    for (let i = 0; i < 5; i++) {
      ;(store.tables['appointments'] as Row[]).push({
        id: `appt-b-${i}`,
        tenant_id: B_TENANT,
        location_id: A_LOC1,
        start_time: soon,
        status: 'scheduled',
      })
    }
    const token = await makeToken(A_TENANT, 'user-a')
    const res = await request(makeApp())
      .post(`/api/calendar-groups/${A_GROUP}/assign`)
      .set('Authorization', `Bearer ${token}`)
      .send({})

    expect(res.status).toBe(200)
    expect(res.body.locationId).toBe(A_LOC1)
  })

  it("POSITIVE CONTROL: DOES count tenant A's own appointments (balances away from busy A_LOC1)", async () => {
    seedAssignMembers()
    for (let i = 0; i < 3; i++) {
      ;(store.tables['appointments'] as Row[]).push({
        id: `appt-a-${i}`,
        tenant_id: A_TENANT,
        location_id: A_LOC1,
        start_time: soon,
        status: 'scheduled',
      })
    }
    const token = await makeToken(A_TENANT, 'user-a')
    const res = await request(makeApp())
      .post(`/api/calendar-groups/${A_GROUP}/assign`)
      .set('Authorization', `Bearer ${token}`)
      .send({})

    expect(res.status).toBe(200)
    expect(res.body.locationId).toBe(A_LOC2)
  })
})
