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

describe('PATCH /api/admin-console/incidents/:id', () => {
  beforeEach(() => {
    store.tables['platform_incidents'] = [
      {
        id: 'i1',
        reference: 'SEV-2026-001',
        severity: 'sev1',
        status: 'detected',
        title: 'x',
        detected_at: '2026-01-01T00:00:00Z',
        acknowledged_at: null,
        acknowledged_by: null,
        postmortem: null,
        postmortem_due_at: null,
      },
    ]
    store.tables['platform_incident_events'] = []
  })

  function row(): Record<string, unknown> {
    return (store.tables['platform_incidents'] as Row[])[0]!
  }

  it('acknowledges, stamping who and when', async () => {
    const res = await request(makeApp())
      .patch('/api/admin-console/incidents/i1')
      .set('Authorization', `Bearer ${await makePlatformToken()}`)
      .send({ status: 'acknowledged' })

    expect(res.status).toBe(200)
    expect(row()['acknowledged_at']).toEqual(expect.any(String))
    expect(row()['acknowledged_by']).toBe(PLATFORM_USER_ID)
  })

  it('refuses to close a resolved SEV1 with no postmortem', async () => {
    // The gate. The only thing standing between "we had an outage" and "we
    // learned something".
    row()['status'] = 'resolved'
    const res = await request(makeApp())
      .patch('/api/admin-console/incidents/i1')
      .set('Authorization', `Bearer ${await makePlatformToken()}`)
      .send({ status: 'closed' })

    expect(res.status).toBe(400)
    expect(String(res.body.error)).toContain('postmortem')
  })

  it('refuses to leave postmortem_due for closed while the postmortem is empty', async () => {
    // postmortem_due -> closed is legal in the map, so without this the gate
    // becomes a box to tick.
    row()['status'] = 'postmortem_due'
    row()['postmortem'] = '   '
    const res = await request(makeApp())
      .patch('/api/admin-console/incidents/i1')
      .set('Authorization', `Bearer ${await makePlatformToken()}`)
      .send({ status: 'closed' })

    expect(res.status).toBe(400)
  })

  it('closes a SEV1 once the postmortem is written', async () => {
    row()['status'] = 'postmortem_due'
    row()['postmortem'] = '## What happened\nThe register could not reach Stripe.'
    const res = await request(makeApp())
      .patch('/api/admin-console/incidents/i1')
      .set('Authorization', `Bearer ${await makePlatformToken()}`)
      .send({ status: 'closed' })

    expect(res.status).toBe(200)
  })

  it('accepts a postmortem written in the same request that closes it', async () => {
    row()['status'] = 'postmortem_due'
    const res = await request(makeApp())
      .patch('/api/admin-console/incidents/i1')
      .set('Authorization', `Bearer ${await makePlatformToken()}`)
      .send({ status: 'closed', postmortem: '## What happened\nStripe key rotation.' })

    expect(res.status).toBe(200)
  })

  it('lets a resolved SEV3 close directly', async () => {
    row()['severity'] = 'sev3'
    row()['status'] = 'resolved'
    const res = await request(makeApp())
      .patch('/api/admin-console/incidents/i1')
      .set('Authorization', `Bearer ${await makePlatformToken()}`)
      .send({ status: 'closed' })

    expect(res.status).toBe(200)
  })

  it('stamps postmortem_due_at when it enters postmortem_due', async () => {
    // Otherwise the column is decorative — it exists in the schema and nothing
    // ever writes it.
    row()['status'] = 'resolved'
    const res = await request(makeApp())
      .patch('/api/admin-console/incidents/i1')
      .set('Authorization', `Bearer ${await makePlatformToken()}`)
      .send({ status: 'postmortem_due' })

    expect(res.status).toBe(200)
    expect(row()['postmortem_due_at']).toEqual(expect.any(String))
  })

  it('refuses a no-op so no empty event row is written', async () => {
    const res = await request(makeApp())
      .patch('/api/admin-console/incidents/i1')
      .set('Authorization', `Bearer ${await makePlatformToken()}`)
      .send({ status: 'detected' })

    expect(res.status).toBe(400)
    expect(store.tables['platform_incident_events']).toHaveLength(0)
  })

  it('stamps resolved_at on resolution', async () => {
    const res = await request(makeApp())
      .patch('/api/admin-console/incidents/i1')
      .set('Authorization', `Bearer ${await makePlatformToken()}`)
      .send({ status: 'resolved' })

    expect(res.status).toBe(200)
    expect(row()['resolved_at']).toEqual(expect.any(String))
  })

  it('reassigns only to a user inside the platform tenant', async () => {
    // users.id is a plain FK with no tenant in it, so nothing in the schema
    // stops an incident being handed to a merchant's account.
    store.tables['users'] = [{ id: 'user-outsider', tenant_id: OTHER_TENANT_ID }]
    const res = await request(makeApp())
      .patch('/api/admin-console/incidents/i1')
      .set('Authorization', `Bearer ${await makePlatformToken()}`)
      .send({ assigned_to_user_id: 'user-outsider' })

    expect(res.status).toBe(400)
  })

  it('accepts a platform teammate as assignee', async () => {
    const res = await request(makeApp())
      .patch('/api/admin-console/incidents/i1')
      .set('Authorization', `Bearer ${await makePlatformToken()}`)
      .send({ assigned_to_user_id: PLATFORM_USER_ID })

    expect(res.status).toBe(200)
    expect(row()['assigned_to_user_id']).toBe(PLATFORM_USER_ID)
  })

  it('writes an event for every change it accepts', async () => {
    await request(makeApp())
      .patch('/api/admin-console/incidents/i1')
      .set('Authorization', `Bearer ${await makePlatformToken()}`)
      .send({ status: 'acknowledged' })

    const events = (store.tables['platform_incident_events'] ?? []) as Row[]
    expect(events).toHaveLength(1)
    expect(events[0]!['kind']).toBe('status_changed')
  })

  it('404s for an id that does not exist', async () => {
    const res = await request(makeApp())
      .patch('/api/admin-console/incidents/nope')
      .set('Authorization', `Bearer ${await makePlatformToken()}`)
      .send({ status: 'acknowledged' })

    expect(res.status).toBe(404)
  })

  it('refuses a non-platform tenant', async () => {
    const res = await request(makeApp())
      .patch('/api/admin-console/incidents/i1')
      .set('Authorization', `Bearer ${await makeOtherTenantToken()}`)
      .send({ status: 'acknowledged' })

    expect(res.status).toBe(403)
  })
})

describe('incident tenant impact', () => {
  beforeEach(() => {
    store.tables['platform_incidents'] = [
      {
        id: 'i1',
        reference: 'SEV-2026-001',
        severity: 'sev2',
        status: 'mitigating',
        title: 'x',
        detected_at: '2026-01-01T00:00:00Z',
      },
    ]
    store.tables['platform_incident_tenants'] = []
    store.tables['tenants'] = [{ id: 'tenant-a' }, { id: 'tenant-b' }]
  })

  it('attaches affected tenants with an impact level', async () => {
    const res = await request(makeApp())
      .put('/api/admin-console/incidents/i1/tenants')
      .set('Authorization', `Bearer ${await makePlatformToken()}`)
      .send({
        tenants: [
          { tenant_id: 'tenant-a', impact: 'full' },
          { tenant_id: 'tenant-b', impact: 'partial' },
        ],
      })

    expect(res.status).toBe(200)
    expect(store.tables['platform_incident_tenants']).toHaveLength(2)
  })

  it('replaces the set rather than appending, so removing a tenant works', async () => {
    store.tables['platform_incident_tenants'] = [
      { incident_id: 'i1', tenant_id: 'tenant-b', impact: 'full' },
    ]
    await request(makeApp())
      .put('/api/admin-console/incidents/i1/tenants')
      .set('Authorization', `Bearer ${await makePlatformToken()}`)
      .send({ tenants: [{ tenant_id: 'tenant-a', impact: 'full' }] })

    const rows = (store.tables['platform_incident_tenants'] ?? []) as Row[]
    expect(rows).toHaveLength(1)
    expect(rows[0]!['tenant_id']).toBe('tenant-a')
  })

  it('clears the set when given an empty list', async () => {
    store.tables['platform_incident_tenants'] = [
      { incident_id: 'i1', tenant_id: 'tenant-a', impact: 'full' },
    ]
    const res = await request(makeApp())
      .put('/api/admin-console/incidents/i1/tenants')
      .set('Authorization', `Bearer ${await makePlatformToken()}`)
      .send({ tenants: [] })

    expect(res.status).toBe(200)
    expect(store.tables['platform_incident_tenants']).toHaveLength(0)
  })

  it('rejects a tenant id that does not exist, without clearing what was there', async () => {
    // Validation must happen before the delete, or a typo wipes the existing
    // impact list and returns an error.
    store.tables['platform_incident_tenants'] = [
      { incident_id: 'i1', tenant_id: 'tenant-a', impact: 'full' },
    ]
    const res = await request(makeApp())
      .put('/api/admin-console/incidents/i1/tenants')
      .set('Authorization', `Bearer ${await makePlatformToken()}`)
      .send({ tenants: [{ tenant_id: 'ghost', impact: 'full' }] })

    expect(res.status).toBe(400)
    expect(store.tables['platform_incident_tenants']).toHaveLength(1)
  })

  it('rejects an impact level outside the scale', async () => {
    const res = await request(makeApp())
      .put('/api/admin-console/incidents/i1/tenants')
      .set('Authorization', `Bearer ${await makePlatformToken()}`)
      .send({ tenants: [{ tenant_id: 'tenant-a', impact: 'catastrophic' }] })

    expect(res.status).toBe(400)
  })

  it('reads the attached tenants back', async () => {
    store.tables['platform_incident_tenants'] = [
      { incident_id: 'i1', tenant_id: 'tenant-a', impact: 'full' },
    ]
    const res = await request(makeApp())
      .get('/api/admin-console/incidents/i1/tenants')
      .set('Authorization', `Bearer ${await makePlatformToken()}`)

    expect(res.status).toBe(200)
    expect(res.body.tenants).toHaveLength(1)
  })

  it('refuses a non-platform tenant', async () => {
    const res = await request(makeApp())
      .put('/api/admin-console/incidents/i1/tenants')
      .set('Authorization', `Bearer ${await makeOtherTenantToken()}`)
      .send({ tenants: [{ tenant_id: 'tenant-a', impact: 'full' }] })

    expect(res.status).toBe(403)
  })
})

describe('customer message', () => {
  beforeEach(() => {
    store.tables['platform_incidents'] = [
      {
        id: 'i1',
        reference: 'SEV-2026-001',
        severity: 'sev1',
        status: 'mitigating',
        title: 'Internal: stripe key rotation broke checkout',
        detected_at: '2026-01-01T00:00:00Z',
        customer_message: null,
        customer_message_published_at: null,
      },
    ]
    store.tables['platform_incident_events'] = []
  })

  function row(): Record<string, unknown> {
    return (store.tables['platform_incidents'] as Row[])[0]!
  }

  it('saves a draft without publishing it', async () => {
    const res = await request(makeApp())
      .put('/api/admin-console/incidents/i1/customer-message')
      .set('Authorization', `Bearer ${await makePlatformToken()}`)
      .send({ customer_message: 'Card payments were unavailable between 09:00 and 09:20.' })

    expect(res.status).toBe(200)
    expect(row()['customer_message']).toContain('Card payments')
    // Saved is not sent.
    expect(row()['customer_message_published_at']).toBeNull()
  })

  it('refuses to publish while the text is empty', async () => {
    const res = await request(makeApp())
      .post('/api/admin-console/incidents/i1/customer-message/publish')
      .set('Authorization', `Bearer ${await makePlatformToken()}`)
      .send({})

    expect(res.status).toBe(400)
  })

  it('refuses to publish whitespace', async () => {
    row()['customer_message'] = '   \n  '
    const res = await request(makeApp())
      .post('/api/admin-console/incidents/i1/customer-message/publish')
      .set('Authorization', `Bearer ${await makePlatformToken()}`)
      .send({})

    expect(res.status).toBe(400)
  })

  it('publishes once the text is written', async () => {
    row()['customer_message'] = 'Card payments were unavailable.'
    const res = await request(makeApp())
      .post('/api/admin-console/incidents/i1/customer-message/publish')
      .set('Authorization', `Bearer ${await makePlatformToken()}`)
      .send({})

    expect(res.status).toBe(200)
    expect(row()['customer_message_published_at']).toEqual(expect.any(String))
  })

  it('records publishing on the timeline', async () => {
    row()['customer_message'] = 'text'
    await request(makeApp())
      .post('/api/admin-console/incidents/i1/customer-message/publish')
      .set('Authorization', `Bearer ${await makePlatformToken()}`)
      .send({})

    const events = (store.tables['platform_incident_events'] ?? []) as Row[]
    expect(events.some((e) => e['kind'] === 'customer_message_published')).toBe(true)
  })

  it('can be unpublished, because a wrong notice must be retractable', async () => {
    row()['customer_message'] = 'text'
    row()['customer_message_published_at'] = '2026-01-01T00:00:00Z'
    const res = await request(makeApp())
      .post('/api/admin-console/incidents/i1/customer-message/publish')
      .set('Authorization', `Bearer ${await makePlatformToken()}`)
      .send({ published: false })

    expect(res.status).toBe(200)
    expect(row()['customer_message_published_at']).toBeNull()
  })

  it('records a retraction on the timeline too', async () => {
    row()['customer_message'] = 'text'
    row()['customer_message_published_at'] = '2026-01-01T00:00:00Z'
    await request(makeApp())
      .post('/api/admin-console/incidents/i1/customer-message/publish')
      .set('Authorization', `Bearer ${await makePlatformToken()}`)
      .send({ published: false })

    const events = (store.tables['platform_incident_events'] ?? []) as Row[]
    expect(events.some((e) => e['kind'] === 'customer_message_retracted')).toBe(true)
  })

  it('editing a published message does not silently unpublish it', async () => {
    // The merchant is already reading it; a typo fix must not make the notice
    // vanish from their dashboard.
    row()['customer_message'] = 'text'
    row()['customer_message_published_at'] = '2026-01-01T00:00:00Z'
    await request(makeApp())
      .put('/api/admin-console/incidents/i1/customer-message')
      .set('Authorization', `Bearer ${await makePlatformToken()}`)
      .send({ customer_message: 'text, corrected' })

    expect(row()['customer_message_published_at']).toBe('2026-01-01T00:00:00Z')
  })

  it('404s for an id that does not exist', async () => {
    const res = await request(makeApp())
      .post('/api/admin-console/incidents/nope/customer-message/publish')
      .set('Authorization', `Bearer ${await makePlatformToken()}`)
      .send({})
    expect(res.status).toBe(404)
  })

  it('refuses a non-platform tenant', async () => {
    const res = await request(makeApp())
      .put('/api/admin-console/incidents/i1/customer-message')
      .set('Authorization', `Bearer ${await makeOtherTenantToken()}`)
      .send({ customer_message: 'sneaky' })
    expect(res.status).toBe(403)
  })
})

describe('declaration alerting is fire-and-forget', () => {
  it('still declares the incident when the alert throws', async () => {
    // An unhandled rejection from a fire-and-forget call terminates the
    // process. A failing alert must cost the alert, not the API.
    store.tables['platform_incidents'] = []
    notifyPlatformTeam.mockRejectedValue(new Error('push is down'))

    const res = await request(makeApp())
      .post('/api/admin-console/incidents')
      .set('Authorization', `Bearer ${await makePlatformToken()}`)
      .send({ severity: 'sev1', title: 'Register cannot take payment' })

    expect(res.status).toBe(201)
    expect(store.tables['platform_incidents']).toHaveLength(1)
  })
})
