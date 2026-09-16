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

const notifyPlatformTeam = jest.fn<() => Promise<void>>()
jest.unstable_mockModule('../lib/notify-platform-team.js', () => ({ notifyPlatformTeam }))

const PLATFORM_TENANT_ID = 'aaaaaaaa-0000-0000-0000-00000plat001'
const OTHER_TENANT_ID = 'bbbbbbbb-0000-0000-0000-00000plat002'
const PLATFORM_USER_ID = 'platform-user-1'
const SECRET = process.env['AUTH_SECRET'] ?? 'test-secret-for-unit-tests-only-32ch'
process.env['AUTH_SECRET'] = SECRET
process.env['SUPABASE_URL'] = 'https://mock.supabase.co'
process.env['SUPABASE_SERVICE_ROLE_KEY'] = 'mock-service-key'
process.env['PLATFORM_TENANT_ID'] = PLATFORM_TENANT_ID

async function makePlatformToken(): Promise<string> {
  return mintTestToken(
    {
      sub: 'nuatis-1',
      appUserId: PLATFORM_USER_ID,
      tenantId: PLATFORM_TENANT_ID,
      role: 'owner',
    },
    { secret: SECRET }
  )
}
async function makeOtherTenantToken(): Promise<string> {
  return mintTestToken(
    { sub: 'user-1', tenantId: OTHER_TENANT_ID, role: 'owner' },
    { secret: SECRET }
  )
}

const { default: express } = await import('express')
const { default: request } = await import('supertest')
const { default: incidentsRouter } = await import('./admin-console-incidents.js')

function makeApp() {
  const app = express()
  app.use('/api/admin-console/incidents', express.json(), incidentsRouter)
  return app
}

beforeEach(() => {
  store = createStore()
  store.tables['platform_incidents'] = []
  store.tables['platform_incident_events'] = []
  store.tables['platform_oncall_shifts'] = []
  store.tables['platform_incident_tenants'] = []
  store.tables['users'] = [
    { id: PLATFORM_USER_ID, tenant_id: PLATFORM_TENANT_ID, full_name: 'Dana' },
  ]
  store.tables['tenants'] = [{ id: OTHER_TENANT_ID }]
  notifyPlatformTeam.mockClear()
  notifyPlatformTeam.mockResolvedValue(undefined)
})

describe('POST /api/admin-console/incidents', () => {
  it('declares an incident with a SEV reference and an opening event', async () => {
    const res = await request(makeApp())
      .post('/api/admin-console/incidents')
      .set('Authorization', `Bearer ${await makePlatformToken()}`)
      .send({ severity: 'sev1', title: 'Register cannot take payment', component: 'api' })

    expect(res.status).toBe(201)
    expect(res.body.incident.reference).toMatch(/^SEV-\d{4}-\d{3}$/)
    expect(res.body.incident.status).toBe('detected')
    const events = (store.tables['platform_incident_events'] ?? []) as Row[]
    expect(events).toHaveLength(1)
    expect(events[0]!['kind']).toBe('detected')
  })

  it('assigns the person on call at detection time', async () => {
    store.tables['platform_oncall_shifts'] = [
      {
        id: 's1',
        user_id: 'user-dana',
        starts_at: '2000-01-01T00:00:00.000Z',
        ends_at: '2099-01-01T00:00:00.000Z',
        is_override: false,
      },
    ]
    const res = await request(makeApp())
      .post('/api/admin-console/incidents')
      .set('Authorization', `Bearer ${await makePlatformToken()}`)
      .send({ severity: 'sev2', title: 'POS socket dropping' })

    expect(res.body.incident.assigned_to_user_id).toBe('user-dana')
  })

  it('leaves the assignee empty when nobody is on call', async () => {
    const res = await request(makeApp())
      .post('/api/admin-console/incidents')
      .set('Authorization', `Bearer ${await makePlatformToken()}`)
      .send({ severity: 'sev2', title: 'POS socket dropping' })

    expect(res.body.incident.assigned_to_user_id).toBeNull()
  })

  it('stamps an ack deadline from severity', async () => {
    const res = await request(makeApp())
      .post('/api/admin-console/incidents')
      .set('Authorization', `Bearer ${await makePlatformToken()}`)
      .send({ severity: 'sev1', title: 'x' })

    const detected = new Date(res.body.incident.detected_at as string).getTime()
    const due = new Date(res.body.incident.ack_due_at as string).getTime()
    expect(due - detected).toBe(15 * 60_000)
  })

  it('leaves SEV4 with no ack deadline', async () => {
    const res = await request(makeApp())
      .post('/api/admin-console/incidents')
      .set('Authorization', `Bearer ${await makePlatformToken()}`)
      .send({ severity: 'sev4', title: 'typo in the footer' })

    expect(res.body.incident.ack_due_at).toBeNull()
  })

  it('alerts the platform team, never the merchant', async () => {
    await request(makeApp())
      .post('/api/admin-console/incidents')
      .set('Authorization', `Bearer ${await makePlatformToken()}`)
      .send({ severity: 'sev1', title: 'Register cannot take payment' })

    expect(notifyPlatformTeam).toHaveBeenCalledTimes(1)
  })

  it('rejects a severity outside the scale', async () => {
    const res = await request(makeApp())
      .post('/api/admin-console/incidents')
      .set('Authorization', `Bearer ${await makePlatformToken()}`)
      .send({ severity: 'sev9', title: 'x' })
    expect(res.status).toBe(400)
  })

  it('requires a title', async () => {
    const res = await request(makeApp())
      .post('/api/admin-console/incidents')
      .set('Authorization', `Bearer ${await makePlatformToken()}`)
      .send({ severity: 'sev3' })
    expect(res.status).toBe(400)
  })

  it('rejects a component outside the allowed set', async () => {
    // The column carries a CHECK constraint; catching it here turns a 500 into
    // a message someone can act on.
    const res = await request(makeApp())
      .post('/api/admin-console/incidents')
      .set('Authorization', `Bearer ${await makePlatformToken()}`)
      .send({ severity: 'sev3', title: 'x', component: 'toaster' })
    expect(res.status).toBe(400)
  })

  it('refuses a non-platform tenant', async () => {
    const res = await request(makeApp())
      .post('/api/admin-console/incidents')
      .set('Authorization', `Bearer ${await makeOtherTenantToken()}`)
      .send({ severity: 'sev1', title: 'x' })
    expect(res.status).toBe(403)
    expect(store.tables['platform_incidents'] ?? []).toHaveLength(0)
  })
})

describe('GET /api/admin-console/incidents', () => {
  it('filters by status', async () => {
    store.tables['platform_incidents'] = [
      {
        id: 'i1',
        reference: 'SEV-2026-001',
        severity: 'sev1',
        status: 'closed',
        title: 'old',
        detected_at: '2026-01-01T00:00:00Z',
      },
      {
        id: 'i2',
        reference: 'SEV-2026-002',
        severity: 'sev2',
        status: 'mitigating',
        title: 'live',
        detected_at: '2026-06-01T00:00:00Z',
      },
    ]
    const res = await request(makeApp())
      .get('/api/admin-console/incidents?status=mitigating')
      .set('Authorization', `Bearer ${await makePlatformToken()}`)

    expect(res.status).toBe(200)
    expect(res.body.data).toHaveLength(1)
    expect(res.body.data[0].id).toBe('i2')
  })

  it('refuses a non-platform tenant', async () => {
    const res = await request(makeApp())
      .get('/api/admin-console/incidents')
      .set('Authorization', `Bearer ${await makeOtherTenantToken()}`)
    expect(res.status).toBe(403)
  })
})

describe('GET /api/admin-console/incidents/:id', () => {
  it('returns the incident with its timeline in order', async () => {
    store.tables['platform_incidents'] = [
      {
        id: 'i1',
        reference: 'SEV-2026-001',
        severity: 'sev1',
        status: 'detected',
        title: 'x',
        detected_at: '2026-01-01T00:00:00Z',
      },
    ]
    store.tables['platform_incident_events'] = [
      {
        id: 'e2',
        incident_id: 'i1',
        at: '2026-01-01T02:00:00Z',
        kind: 'acknowledged',
        actor_kind: 'user',
        detail: {},
      },
      {
        id: 'e1',
        incident_id: 'i1',
        at: '2026-01-01T00:00:00Z',
        kind: 'detected',
        actor_kind: 'user',
        detail: {},
      },
    ]
    const res = await request(makeApp())
      .get('/api/admin-console/incidents/i1')
      .set('Authorization', `Bearer ${await makePlatformToken()}`)

    expect(res.body.events.map((e: { id: string }) => e.id)).toEqual(['e1', 'e2'])
  })

  it('404s for an id that does not exist', async () => {
    const res = await request(makeApp())
      .get('/api/admin-console/incidents/nope')
      .set('Authorization', `Bearer ${await makePlatformToken()}`)
    expect(res.status).toBe(404)
  })
})
