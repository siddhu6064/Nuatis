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

const TENANT_ID = 'aaaaaaaa-0000-0000-0000-00000ap00001'
const SECRET = process.env['AUTH_SECRET'] ?? 'test-secret-for-unit-tests-only-32ch'
process.env['AUTH_SECRET'] = SECRET
process.env['SUPABASE_URL'] = 'https://mock.supabase.co'
process.env['SUPABASE_SERVICE_ROLE_KEY'] = 'mock-service-key'

async function makeToken(): Promise<string> {
  return mintTestToken({ sub: 'user-1', tenantId: TENANT_ID, role: 'owner' }, { secret: SECRET })
}

const { default: express } = await import('express')
const { default: request } = await import('supertest')
const { default: appointmentsRouter } = await import('./appointments.js')

function makeApp() {
  const app = express()
  app.use('/api/appointments', express.json(), appointmentsRouter)
  return app
}

const STAFF_ID = 'staff-1'

beforeEach(() => {
  store = createStore()
  store.tables['tenants'] = [{ id: TENANT_ID, modules: { scheduling: true } }]
  store.tables['appointments'] = [
    {
      id: 'appt-fixed',
      tenant_id: TENANT_ID,
      assigned_staff_id: STAFF_ID,
      status: 'scheduled',
      start_time: '2026-09-01T14:00:00.000Z',
      end_time: '2026-09-01T15:00:00.000Z',
    },
    {
      id: 'appt-movable',
      tenant_id: TENANT_ID,
      assigned_staff_id: STAFF_ID,
      status: 'scheduled',
      start_time: '2026-09-01T09:00:00.000Z',
      end_time: '2026-09-01T10:00:00.000Z',
    },
  ]
  store.tables['locations'] = []
  store.tables['resource_bookings'] = []
})

describe('PATCH /api/appointments/:id — reschedule conflict check', () => {
  it("409s when the drop target overlaps the same staff member's existing appointment", async () => {
    const token = await makeToken()
    const res = await request(makeApp())
      .patch('/api/appointments/appt-movable')
      .set('Authorization', `Bearer ${token}`)
      .send({ start_time: '2026-09-01T14:30:00.000Z', end_time: '2026-09-01T15:30:00.000Z' })

    expect(res.status).toBe(409)
    expect(res.body.conflict).toBe(true)
  })

  it('succeeds when moved to a free slot for the same staff member', async () => {
    const token = await makeToken()
    const res = await request(makeApp())
      .patch('/api/appointments/appt-movable')
      .set('Authorization', `Bearer ${token}`)
      .send({ start_time: '2026-09-01T11:00:00.000Z', end_time: '2026-09-01T12:00:00.000Z' })

    expect(res.status).toBe(200)
    expect(res.body.data.start_time).toBe('2026-09-01T11:00:00.000Z')
  })

  it('a cancelled appointment does not block a move onto its old slot', async () => {
    store.tables['appointments']![0]!['status'] = 'canceled'
    const token = await makeToken()
    const res = await request(makeApp())
      .patch('/api/appointments/appt-movable')
      .set('Authorization', `Bearer ${token}`)
      .send({ start_time: '2026-09-01T14:00:00.000Z', end_time: '2026-09-01T15:00:00.000Z' })

    expect(res.status).toBe(200)
  })

  it('404s for an appointment in another tenant', async () => {
    store.tables['appointments'] = [{ id: 'other', tenant_id: 'other-tenant', status: 'scheduled' }]
    const token = await makeToken()
    const res = await request(makeApp())
      .patch('/api/appointments/other')
      .set('Authorization', `Bearer ${token}`)
      .send({ start_time: '2026-09-01T11:00:00.000Z', end_time: '2026-09-01T12:00:00.000Z' })
    expect(res.status).toBe(404)
  })
})
