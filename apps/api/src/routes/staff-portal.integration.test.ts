import { jest, describe, it, expect, beforeEach } from '@jest/globals'
import { mintTestToken } from './__test-support__/jwt.js'
import {
  createStore,
  createMockSupabase,
  type MockStore,
} from './__test-support__/supabase-mock.js'

let store: MockStore = createStore()
const notifyOwner = jest.fn(async () => undefined)

jest.unstable_mockModule('@supabase/supabase-js', () => ({
  createClient: () => createMockSupabase(store),
}))
jest.unstable_mockModule('../lib/notifications.js', () => ({ notifyOwner }))

const TENANT_ID = 'aaaaaaaa-0000-0000-0000-00000sp00001'
const OTHER_TENANT_ID = 'bbbbbbbb-0000-0000-0000-00000sp00002'
const APP_USER_ID = 'app-user-staff-001'
const STAFF_ID = 'staff-member-001'
const SECRET = process.env['AUTH_SECRET'] ?? 'test-secret-for-unit-tests-only-32ch'
process.env['AUTH_SECRET'] = SECRET
process.env['SUPABASE_URL'] = 'https://mock.supabase.co'
process.env['SUPABASE_SERVICE_ROLE_KEY'] = 'mock-service-key'

async function makeStaffToken(appUserId: string = APP_USER_ID): Promise<string> {
  return mintTestToken(
    { sub: 'authjs-sub', tenantId: TENANT_ID, role: 'staff', portalScope: 'staff', appUserId },
    { secret: SECRET }
  )
}

// Sequential dynamic imports — see staff.integration.test.ts for why.
const { default: express } = await import('express')
const { default: request } = await import('supertest')
const { default: staffPortalRouter } = await import('./staff-portal.js')

function makeApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/staff-portal', staffPortalRouter)
  return app
}

beforeEach(() => {
  store = createStore()
  store.tables['staff_members'] = [
    {
      id: STAFF_ID,
      tenant_id: TENANT_ID,
      user_id: APP_USER_ID,
      name: 'Jane Staff',
      role: 'Receptionist',
      email: 'jane@example.com',
      phone: null,
      color_hex: '#6366F1',
      pay_type: 'hourly',
      hourly_rate_cents: 2500,
      salary_cents: null,
    },
  ]
  store.tables['shifts'] = []
  store.tables['appointments'] = []
  store.tables['time_entries'] = []
  store.tables['time_off_requests'] = []
  notifyOwner.mockClear()
})

describe('GET /api/staff-portal/me', () => {
  it("returns the caller's own staff profile, including pay rate", async () => {
    const token = await makeStaffToken()
    const res = await request(makeApp())
      .get('/api/staff-portal/me')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.name).toBe('Jane Staff')
    expect(res.body.hourly_rate_cents).toBe(2500)
  })

  it('403s when the login has no linked staff_members row', async () => {
    const token = await makeStaffToken('unlinked-user')
    const res = await request(makeApp())
      .get('/api/staff-portal/me')
      .set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(403)
  })
})

describe('GET /api/staff-portal/shifts', () => {
  it("only returns the caller's own shifts, not another staff member's", async () => {
    store.tables['shifts'] = [
      {
        id: 's1',
        tenant_id: TENANT_ID,
        staff_id: STAFF_ID,
        date: '2026-09-01',
        start_time: '09:00',
        end_time: '17:00',
      },
      {
        id: 's2',
        tenant_id: TENANT_ID,
        staff_id: 'someone-else',
        date: '2026-09-01',
        start_time: '09:00',
        end_time: '17:00',
      },
    ]
    const token = await makeStaffToken()
    const res = await request(makeApp())
      .get('/api/staff-portal/shifts')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.data).toHaveLength(1)
    expect(res.body.data[0].id).toBe('s1')
  })
})

describe('GET /api/staff-portal/appointments', () => {
  it('only returns appointments assigned to the caller, cross-tenant scoped', async () => {
    store.tables['appointments'] = [
      {
        id: 'a1',
        tenant_id: TENANT_ID,
        assigned_staff_id: STAFF_ID,
        start_time: '2026-09-01T09:00:00Z',
      },
      {
        id: 'a2',
        tenant_id: TENANT_ID,
        assigned_staff_id: 'someone-else',
        start_time: '2026-09-01T09:00:00Z',
      },
      {
        id: 'a3',
        tenant_id: OTHER_TENANT_ID,
        assigned_staff_id: STAFF_ID,
        start_time: '2026-09-01T09:00:00Z',
      },
    ]
    const token = await makeStaffToken()
    const res = await request(makeApp())
      .get('/api/staff-portal/appointments')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.data).toHaveLength(1)
    expect(res.body.data[0].id).toBe('a1')
  })
})

describe('Time clock', () => {
  it('clock-in creates an open entry, clock-out closes it', async () => {
    const token = await makeStaffToken()
    const app = makeApp()

    const inRes = await request(app)
      .post('/api/staff-portal/clock-in')
      .set('Authorization', `Bearer ${token}`)
    expect(inRes.status).toBe(201)
    // The mock doesn't evaluate DB NULLs for unset columns — an absent
    // clock_out_at key is the "still open" signal here, not a JSON null.
    expect(inRes.body.clock_out_at).toBeFalsy()

    const outRes = await request(app)
      .post('/api/staff-portal/clock-out')
      .set('Authorization', `Bearer ${token}`)
    expect(outRes.status).toBe(200)
    expect(outRes.body.clock_out_at).toBeTruthy()

    const timesheetRes = await request(app)
      .get('/api/staff-portal/timesheet')
      .set('Authorization', `Bearer ${token}`)
    expect(timesheetRes.body.data).toHaveLength(1)
  })

  it('409s clocking in twice without clocking out', async () => {
    const token = await makeStaffToken()
    const app = makeApp()

    await request(app).post('/api/staff-portal/clock-in').set('Authorization', `Bearer ${token}`)
    const second = await request(app)
      .post('/api/staff-portal/clock-in')
      .set('Authorization', `Bearer ${token}`)
    expect(second.status).toBe(409)
  })

  it('409s clocking out when not clocked in', async () => {
    const token = await makeStaffToken()
    const res = await request(makeApp())
      .post('/api/staff-portal/clock-out')
      .set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(409)
  })
})

describe('POST /api/staff-portal/time-off', () => {
  it('creates a pending request', async () => {
    const token = await makeStaffToken()
    const res = await request(makeApp())
      .post('/api/staff-portal/time-off')
      .set('Authorization', `Bearer ${token}`)
      .send({ start_date: '2026-09-01', end_date: '2026-09-05', reason: 'Vacation' })

    expect(res.status).toBe(201)
    expect(res.body.status).toBe('pending')
    expect(res.body.staff_id).toBe(STAFF_ID)

    expect(notifyOwner).toHaveBeenCalledTimes(1)
    const [tenantId, eventKey, payload] = notifyOwner.mock.calls[0]!
    expect(tenantId).toBe(TENANT_ID)
    expect(eventKey).toBe('time_off_requested')
    expect((payload as { pushBody: string }).pushBody).toContain('Jane Staff')
  })

  it('400s when end_date is before start_date', async () => {
    const token = await makeStaffToken()
    const res = await request(makeApp())
      .post('/api/staff-portal/time-off')
      .set('Authorization', `Bearer ${token}`)
      .send({ start_date: '2026-09-05', end_date: '2026-09-01' })

    expect(res.status).toBe(400)
  })

  it('400s a malformed date', async () => {
    const token = await makeStaffToken()
    const res = await request(makeApp())
      .post('/api/staff-portal/time-off')
      .set('Authorization', `Bearer ${token}`)
      .send({ start_date: 'not-a-date', end_date: '2026-09-01' })

    expect(res.status).toBe(400)
  })
})

describe('GET /api/staff-portal/time-off', () => {
  it("returns only the caller's own requests", async () => {
    store.tables['time_off_requests'] = [
      {
        id: 'req-mine',
        tenant_id: TENANT_ID,
        staff_id: STAFF_ID,
        start_date: '2026-09-01',
        end_date: '2026-09-05',
        status: 'pending',
      },
      {
        id: 'req-other',
        tenant_id: TENANT_ID,
        staff_id: 'some-other-staff',
        start_date: '2026-10-01',
        end_date: '2026-10-02',
        status: 'pending',
      },
    ]
    const token = await makeStaffToken()
    const res = await request(makeApp())
      .get('/api/staff-portal/time-off')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.data).toHaveLength(1)
    expect(res.body.data[0].id).toBe('req-mine')
  })
})

describe('Role gate', () => {
  it('rejects a non-staff role', async () => {
    const ownerToken = await mintTestToken(
      { sub: 'owner-1', tenantId: TENANT_ID, role: 'owner', appUserId: APP_USER_ID },
      { secret: SECRET }
    )
    const res = await request(makeApp())
      .get('/api/staff-portal/me')
      .set('Authorization', `Bearer ${ownerToken}`)
    expect(res.status).toBe(403)
  })
})
