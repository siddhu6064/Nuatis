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

const TENANT_ID = 'aaaaaaaa-0000-0000-0000-00000osq0001'
const OTHER_TENANT_ID = 'aaaaaaaa-0000-0000-0000-00000osq0099'
const CONTACT_ID = 'bbbbbbbb-0000-0000-0000-00000osq0002'
const SECRET = process.env['AUTH_SECRET'] ?? 'test-secret-for-unit-tests-only-32ch'
process.env['AUTH_SECRET'] = SECRET
process.env['SUPABASE_URL'] = 'https://mock.supabase.co'
process.env['SUPABASE_SERVICE_ROLE_KEY'] = 'mock-service-key'

async function makeToken(): Promise<string> {
  return mintTestToken(
    { sub: 'user-1', appUserId: 'user-1', tenantId: TENANT_ID, role: 'owner', vertical: 'dental' },
    { secret: SECRET }
  )
}

const { default: express } = await import('express')
const { default: request } = await import('supertest')
const { default: outreachRouter } = await import('./outreach-sequences.js')

function makeApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/outreach-sequences', outreachRouter)
  return app
}

function entitledTenant(overrides: Row = {}): Row {
  return {
    id: TENANT_ID,
    modules: { automation: true },
    subscription_status: 'active',
    subscription_plan: 'pro',
    ...overrides,
  }
}

beforeEach(() => {
  store = createStore()
  store.tables['tenants'] = [entitledTenant()]
  store.tables['contacts'] = [{ id: CONTACT_ID, tenant_id: TENANT_ID, full_name: 'Jane Client' }]
  store.tables['outreach_sequences'] = []
  store.tables['outreach_sequence_steps'] = []
  store.tables['outreach_sequence_enrollments'] = []
})

const STEPS = [
  { channel: 'sms', days_after: 1, template: 'Hi {name}' },
  { channel: 'email', days_after: 3, template: 'Following up', subject: 'Checking in' },
]

describe('POST /api/outreach-sequences', () => {
  it('creates a sequence with steps', async () => {
    const token = await makeToken()
    const res = await request(makeApp())
      .post('/api/outreach-sequences')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Cold lead nurture', steps: STEPS })

    expect(res.status).toBe(201)
    expect(res.body.name).toBe('Cold lead nurture')
    expect(res.body.steps).toHaveLength(2)
  })

  it('400s with no steps', async () => {
    const token = await makeToken()
    const res = await request(makeApp())
      .post('/api/outreach-sequences')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Empty', steps: [] })

    expect(res.status).toBe(400)
  })

  it('400s a step with an invalid channel', async () => {
    const token = await makeToken()
    const res = await request(makeApp())
      .post('/api/outreach-sequences')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Bad', steps: [{ channel: 'carrier_pigeon', days_after: 1, template: 'x' }] })

    expect(res.status).toBe(400)
  })
})

describe('GET /api/outreach-sequences', () => {
  it('lists sequences with steps and active_enrollments count', async () => {
    store.tables['outreach_sequences'] = [
      { id: 'seq-1', tenant_id: TENANT_ID, name: 'Nurture', enabled: true },
    ]
    store.tables['outreach_sequence_steps'] = [
      {
        id: 's1',
        sequence_id: 'seq-1',
        step_order: 0,
        channel: 'sms',
        days_after: 1,
        template: 'x',
      },
    ]
    store.tables['outreach_sequence_enrollments'] = [
      {
        id: 'enr-1',
        tenant_id: TENANT_ID,
        sequence_id: 'seq-1',
        contact_id: CONTACT_ID,
        status: 'active',
      },
    ]

    const token = await makeToken()
    const res = await request(makeApp())
      .get('/api/outreach-sequences')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.data).toHaveLength(1)
    expect(res.body.data[0].steps).toHaveLength(1)
    expect(res.body.data[0].active_enrollments).toBe(1)
  })
})

describe('PUT /api/outreach-sequences/:id', () => {
  it('replaces steps and returns the new set', async () => {
    store.tables['outreach_sequences'] = [
      { id: 'seq-1', tenant_id: TENANT_ID, name: 'Nurture', enabled: true },
    ]
    store.tables['outreach_sequence_steps'] = [
      {
        id: 's1',
        sequence_id: 'seq-1',
        step_order: 0,
        channel: 'sms',
        days_after: 1,
        template: 'old',
      },
    ]

    const token = await makeToken()
    const res = await request(makeApp())
      .put('/api/outreach-sequences/seq-1')
      .set('Authorization', `Bearer ${token}`)
      .send({ steps: [{ channel: 'email', days_after: 2, template: 'new', subject: 'Hi' }] })

    expect(res.status).toBe(200)
    expect(res.body.steps).toHaveLength(1)
    expect(res.body.steps[0].template).toBe('new')
  })

  it('404s a sequence in another tenant', async () => {
    store.tables['outreach_sequences'] = [
      { id: 'seq-1', tenant_id: OTHER_TENANT_ID, name: 'Nurture', enabled: true },
    ]
    const token = await makeToken()
    const res = await request(makeApp())
      .put('/api/outreach-sequences/seq-1')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Renamed' })

    expect(res.status).toBe(404)
  })
})

describe('POST /api/outreach-sequences/:id/enroll', () => {
  it('enrolls a contact', async () => {
    store.tables['outreach_sequences'] = [
      { id: 'seq-1', tenant_id: TENANT_ID, name: 'Nurture', enabled: true },
    ]

    const token = await makeToken()
    const res = await request(makeApp())
      .post('/api/outreach-sequences/seq-1/enroll')
      .set('Authorization', `Bearer ${token}`)
      .send({ contact_id: CONTACT_ID })

    expect(res.status).toBe(201)
    expect(res.body.results).toEqual([{ contact_id: CONTACT_ID, enrolled: true }])

    const enrollments = store.tables['outreach_sequence_enrollments'] as Row[]
    expect(enrollments).toHaveLength(1)
    expect(enrollments[0]?.['status']).toBe('active')
  })

  it('re-enrolling an already-stopped contact resets it to active/step 0', async () => {
    store.tables['outreach_sequences'] = [
      { id: 'seq-1', tenant_id: TENANT_ID, name: 'Nurture', enabled: true },
    ]
    store.tables['outreach_sequence_enrollments'] = [
      {
        id: 'enr-1',
        tenant_id: TENANT_ID,
        sequence_id: 'seq-1',
        contact_id: CONTACT_ID,
        status: 'stopped',
        current_step: 1,
      },
    ]

    const token = await makeToken()
    const res = await request(makeApp())
      .post('/api/outreach-sequences/seq-1/enroll')
      .set('Authorization', `Bearer ${token}`)
      .send({ contact_id: CONTACT_ID })

    expect(res.status).toBe(201)
    const enrollments = store.tables['outreach_sequence_enrollments'] as Row[]
    expect(enrollments).toHaveLength(1)
    expect(enrollments[0]?.['status']).toBe('active')
    expect(enrollments[0]?.['current_step']).toBe(0)
  })

  it('reports enrolled:false for a contact outside the tenant', async () => {
    store.tables['outreach_sequences'] = [
      { id: 'seq-1', tenant_id: TENANT_ID, name: 'Nurture', enabled: true },
    ]

    const token = await makeToken()
    const res = await request(makeApp())
      .post('/api/outreach-sequences/seq-1/enroll')
      .set('Authorization', `Bearer ${token}`)
      .send({ contact_id: 'not-a-real-contact' })

    expect(res.status).toBe(201)
    expect(res.body.results).toEqual([{ contact_id: 'not-a-real-contact', enrolled: false }])
  })
})

describe('POST /api/outreach-sequences/:id/enrollments/:enrollmentId/stop', () => {
  it('stops an enrollment', async () => {
    store.tables['outreach_sequences'] = [
      { id: 'seq-1', tenant_id: TENANT_ID, name: 'Nurture', enabled: true },
    ]
    store.tables['outreach_sequence_enrollments'] = [
      {
        id: 'enr-1',
        tenant_id: TENANT_ID,
        sequence_id: 'seq-1',
        contact_id: CONTACT_ID,
        status: 'active',
      },
    ]

    const token = await makeToken()
    const res = await request(makeApp())
      .post('/api/outreach-sequences/seq-1/enrollments/enr-1/stop')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    const enrollments = store.tables['outreach_sequence_enrollments'] as Row[]
    expect(enrollments[0]?.['status']).toBe('stopped')
  })
})
