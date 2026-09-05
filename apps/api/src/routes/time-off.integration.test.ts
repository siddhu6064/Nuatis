import { jest, describe, it, expect, beforeEach } from '@jest/globals'
import { mintTestToken } from './__test-support__/jwt.js'
import {
  createStore,
  createMockSupabase,
  type MockStore,
} from './__test-support__/supabase-mock.js'

let store: MockStore = createStore()

jest.unstable_mockModule('@supabase/supabase-js', () => ({
  createClient: () => createMockSupabase(store),
}))

const TENANT_ID = 'aaaaaaaa-0000-0000-0000-00000to00001'
const STAFF_ID = 'staff-to-001'
const SECRET = process.env['AUTH_SECRET'] ?? 'test-secret-for-unit-tests-only-32ch'
process.env['AUTH_SECRET'] = SECRET
process.env['SUPABASE_URL'] = 'https://mock.supabase.co'
process.env['SUPABASE_SERVICE_ROLE_KEY'] = 'mock-service-key'

async function makeOwnerToken(): Promise<string> {
  return mintTestToken({ sub: 'owner-1', tenantId: TENANT_ID, role: 'owner' }, { secret: SECRET })
}

async function makeStaffRoleToken(): Promise<string> {
  return mintTestToken({ sub: 'staff-1', tenantId: TENANT_ID, role: 'staff' }, { secret: SECRET })
}

const { default: express } = await import('express')
const { default: request } = await import('supertest')
const { default: timeOffRouter } = await import('./time-off.js')

function makeApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/time-off', timeOffRouter)
  return app
}

beforeEach(() => {
  store = createStore()
  store.tables['tenants'] = [{ id: TENANT_ID, modules: { crm: true } }]
  store.tables['staff_members'] = [
    { id: STAFF_ID, tenant_id: TENANT_ID, name: 'Jane Staff', color_hex: '#6366F1' },
  ]
  store.tables['time_off_requests'] = [
    {
      id: 'req-1',
      tenant_id: TENANT_ID,
      staff_id: STAFF_ID,
      start_date: '2026-09-01',
      end_date: '2026-09-05',
      reason: 'Vacation',
      status: 'pending',
    },
  ]
  store.tables['shifts'] = []
  store.tables['activity_log'] = []
})

describe('GET /api/time-off', () => {
  it('lists requests with the staff member joined', async () => {
    const token = await makeOwnerToken()
    const res = await request(makeApp())
      .get('/api/time-off')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.data).toHaveLength(1)
    expect(res.body.data[0].staff_members.name).toBe('Jane Staff')
  })

  it('filters by status', async () => {
    store.tables['time_off_requests']!.push({
      id: 'req-2',
      tenant_id: TENANT_ID,
      staff_id: STAFF_ID,
      start_date: '2026-11-01',
      end_date: '2026-11-02',
      status: 'approved',
    })
    const token = await makeOwnerToken()
    const res = await request(makeApp())
      .get('/api/time-off?status=approved')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.data).toHaveLength(1)
    expect(res.body.data[0].id).toBe('req-2')
  })
})

describe('POST /api/time-off/:id/approve', () => {
  it('approves a pending request', async () => {
    const token = await makeOwnerToken()
    const res = await request(makeApp())
      .post('/api/time-off/req-1/approve')
      .set('Authorization', `Bearer ${token}`)
      .send({ note: 'Enjoy!' })

    expect(res.status).toBe(200)
    expect(res.body.status).toBe('approved')
    expect(res.body.approval_note).toBe('Enjoy!')
    expect(res.body.shift_conflicts).toBe(null)
  })

  it('surfaces shift_conflicts when a shift overlaps the approved range', async () => {
    store.tables['shifts'] = [
      {
        id: 'shift-1',
        tenant_id: TENANT_ID,
        staff_id: STAFF_ID,
        date: '2026-09-03',
        start_time: '09:00',
        end_time: '17:00',
      },
    ]
    const token = await makeOwnerToken()
    const res = await request(makeApp())
      .post('/api/time-off/req-1/approve')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.shift_conflicts).toHaveLength(1)
    expect(res.body.shift_conflicts[0].id).toBe('shift-1')
  })

  it('400s a non-pending request', async () => {
    store.tables['time_off_requests'] = [
      { id: 'req-1', tenant_id: TENANT_ID, staff_id: STAFF_ID, status: 'approved' },
    ]
    const token = await makeOwnerToken()
    const res = await request(makeApp())
      .post('/api/time-off/req-1/approve')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(400)
  })

  it('403s a non-owner/admin role', async () => {
    const token = await makeStaffRoleToken()
    const res = await request(makeApp())
      .post('/api/time-off/req-1/approve')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(403)
  })
})

describe('POST /api/time-off/:id/reject', () => {
  it('rejects a pending request', async () => {
    const token = await makeOwnerToken()
    const res = await request(makeApp())
      .post('/api/time-off/req-1/reject')
      .set('Authorization', `Bearer ${token}`)
      .send({ note: 'Short-staffed that week' })

    expect(res.status).toBe(200)
    expect(res.body.status).toBe('rejected')
    expect(res.body.approval_note).toBe('Short-staffed that week')
  })

  it('400s a non-pending request', async () => {
    store.tables['time_off_requests'] = [
      { id: 'req-1', tenant_id: TENANT_ID, staff_id: STAFF_ID, status: 'rejected' },
    ]
    const token = await makeOwnerToken()
    const res = await request(makeApp())
      .post('/api/time-off/req-1/reject')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(400)
  })
})
