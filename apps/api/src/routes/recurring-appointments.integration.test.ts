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

const TENANT_ID = 'aaaaaaaa-0000-0000-0000-00000ra00001'
const CONTACT_ID = 'contact-1'
const SECRET = process.env['AUTH_SECRET'] ?? 'test-secret-for-unit-tests-only-32ch'
process.env['AUTH_SECRET'] = SECRET
process.env['SUPABASE_URL'] = 'https://mock.supabase.co'
process.env['SUPABASE_SERVICE_ROLE_KEY'] = 'mock-service-key'

async function makeToken(): Promise<string> {
  return mintTestToken({ sub: 'user-1', tenantId: TENANT_ID, role: 'owner' }, { secret: SECRET })
}

const { default: express } = await import('express')
const { default: request } = await import('supertest')
const { default: recurringAppointmentsRouter } = await import('./recurring-appointments.js')

function makeApp() {
  const app = express()
  app.use('/api/recurring-appointments', express.json(), recurringAppointmentsRouter)
  return app
}

beforeEach(() => {
  store = createStore()
  store.tables['tenants'] = [{ id: TENANT_ID, modules: { scheduling: true } }]
  store.tables['contacts'] = [{ id: CONTACT_ID, tenant_id: TENANT_ID, full_name: 'Jane' }]
  store.tables['recurring_appointment_rules'] = []
})

describe('POST /api/recurring-appointments', () => {
  it('creates a weekly rule', async () => {
    const token = await makeToken()
    const res = await request(makeApp())
      .post('/api/recurring-appointments')
      .set('Authorization', `Bearer ${token}`)
      .send({
        contact_id: CONTACT_ID,
        title: 'Weekly haircut',
        duration_minutes: 45,
        frequency: 'weekly',
        day_of_week: 2,
        start_time: '10:00',
      })

    expect(res.status).toBe(201)
    expect(res.body.frequency).toBe('weekly')
    expect(res.body.enabled).toBe(true)
  })

  it('400s a weekly rule without day_of_week', async () => {
    const token = await makeToken()
    const res = await request(makeApp())
      .post('/api/recurring-appointments')
      .set('Authorization', `Bearer ${token}`)
      .send({
        contact_id: CONTACT_ID,
        title: 'X',
        duration_minutes: 30,
        frequency: 'weekly',
        start_time: '10:00',
      })
    expect(res.status).toBe(400)
  })

  it('404s an unknown contact', async () => {
    const token = await makeToken()
    const res = await request(makeApp())
      .post('/api/recurring-appointments')
      .set('Authorization', `Bearer ${token}`)
      .send({
        contact_id: 'nope',
        title: 'X',
        duration_minutes: 30,
        frequency: 'weekly',
        day_of_week: 1,
        start_time: '10:00',
      })
    expect(res.status).toBe(404)
  })

  it('400s a malformed start_time', async () => {
    const token = await makeToken()
    const res = await request(makeApp())
      .post('/api/recurring-appointments')
      .set('Authorization', `Bearer ${token}`)
      .send({
        contact_id: CONTACT_ID,
        title: 'X',
        duration_minutes: 30,
        frequency: 'weekly',
        day_of_week: 1,
        start_time: '10am',
      })
    expect(res.status).toBe(400)
  })
})

describe('PUT/DELETE /api/recurring-appointments/:id', () => {
  it('disables a rule', async () => {
    store.tables['recurring_appointment_rules'] = [
      {
        id: 'rule-1',
        tenant_id: TENANT_ID,
        contact_id: CONTACT_ID,
        title: 'X',
        enabled: true,
        deleted_at: null,
      },
    ]
    const token = await makeToken()
    const res = await request(makeApp())
      .put('/api/recurring-appointments/rule-1')
      .set('Authorization', `Bearer ${token}`)
      .send({ enabled: false })

    expect(res.status).toBe(200)
    expect(res.body.enabled).toBe(false)
  })

  it('soft-deletes a rule', async () => {
    store.tables['recurring_appointment_rules'] = [
      {
        id: 'rule-1',
        tenant_id: TENANT_ID,
        contact_id: CONTACT_ID,
        title: 'X',
        enabled: true,
        deleted_at: null,
      },
    ]
    const token = await makeToken()
    const res = await request(makeApp())
      .delete('/api/recurring-appointments/rule-1')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    const row = store.tables['recurring_appointment_rules']?.[0]
    expect(row?.['deleted_at']).toBeTruthy()
    expect(row?.['enabled']).toBe(false)
  })

  it('404s a rule in another tenant', async () => {
    store.tables['recurring_appointment_rules'] = [
      {
        id: 'rule-1',
        tenant_id: 'other-tenant',
        contact_id: CONTACT_ID,
        title: 'X',
        enabled: true,
      },
    ]
    const token = await makeToken()
    const res = await request(makeApp())
      .put('/api/recurring-appointments/rule-1')
      .set('Authorization', `Bearer ${token}`)
      .send({ enabled: false })
    expect(res.status).toBe(404)
  })
})
