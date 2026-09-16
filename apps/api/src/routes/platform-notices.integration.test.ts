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

const TENANT_ID = 'cccccccc-0000-0000-0000-00000notice1'
const SECRET = process.env['AUTH_SECRET'] ?? 'test-secret-for-unit-tests-only-32ch'
process.env['AUTH_SECRET'] = SECRET
process.env['SUPABASE_URL'] = 'https://mock.supabase.co'
process.env['SUPABASE_SERVICE_ROLE_KEY'] = 'mock-service-key'

async function makeTenantToken(): Promise<string> {
  return mintTestToken({ sub: 'user-1', tenantId: TENANT_ID, role: 'owner' }, { secret: SECRET })
}

const { default: express } = await import('express')
const { default: request } = await import('supertest')
const { default: noticesRouter } = await import('./platform-notices.js')

function makeApp() {
  const app = express()
  app.use('/api/platform-notices', express.json(), noticesRouter)
  return app
}

beforeEach(() => {
  store = createStore()
  store.tables['platform_incidents'] = [
    {
      id: 'i1',
      reference: 'SEV-2026-001',
      severity: 'sev1',
      status: 'mitigating',
      title: 'INTERNAL: rotated the stripe key and broke checkout',
      summary: 'INTERNAL: rollback in progress, see runbook',
      component: 'api',
      customer_message: 'Card payments were briefly unavailable this morning.',
      customer_message_published_at: '2026-01-01T09:30:00Z',
      resolved_at: null,
      detected_at: '2026-01-01T09:00:00Z',
    },
  ]
  store.tables['platform_incident_tenants'] = [
    { incident_id: 'i1', tenant_id: TENANT_ID, impact: 'full' },
  ]
})

describe('GET /api/platform-notices', () => {
  it('returns the published customer message for an affected tenant', async () => {
    const res = await request(makeApp())
      .get('/api/platform-notices')
      .set('Authorization', `Bearer ${await makeTenantToken()}`)

    expect(res.status).toBe(200)
    expect(res.body.notices).toHaveLength(1)
    expect(res.body.notices[0].message).toContain('Card payments')
  })

  it('never exposes the internal title, summary or component', async () => {
    // The whole point of the two-column split. If this ever fails, an internal
    // sentence is on its way to a merchant's screen.
    const res = await request(makeApp())
      .get('/api/platform-notices')
      .set('Authorization', `Bearer ${await makeTenantToken()}`)

    const body = JSON.stringify(res.body)
    expect(body).not.toContain('INTERNAL')
    expect(body).not.toContain('rotated the stripe key')
    expect(body).not.toContain('runbook')
    expect(res.body.notices[0]).not.toHaveProperty('title')
    expect(res.body.notices[0]).not.toHaveProperty('summary')
    expect(res.body.notices[0]).not.toHaveProperty('component')
    expect(res.body.notices[0]).not.toHaveProperty('severity')
    expect(res.body.notices[0]).not.toHaveProperty('reference')
  })

  it('hides an unpublished message even from an affected tenant', async () => {
    ;(store.tables['platform_incidents'] as Row[])[0]!['customer_message_published_at'] = null
    const res = await request(makeApp())
      .get('/api/platform-notices')
      .set('Authorization', `Bearer ${await makeTenantToken()}`)

    expect(res.body.notices).toHaveLength(0)
  })

  it('hides it from a tenant that was not affected', async () => {
    store.tables['platform_incident_tenants'] = [
      { incident_id: 'i1', tenant_id: 'someone-else', impact: 'full' },
    ]
    const res = await request(makeApp())
      .get('/api/platform-notices')
      .set('Authorization', `Bearer ${await makeTenantToken()}`)

    expect(res.body.notices).toHaveLength(0)
  })

  it('excludes tenants recorded with impact none', async () => {
    // Recording "we checked, they were fine" is useful internally; showing
    // them a notice about it is not.
    ;(store.tables['platform_incident_tenants'] as Row[])[0]!['impact'] = 'none'
    const res = await request(makeApp())
      .get('/api/platform-notices')
      .set('Authorization', `Bearer ${await makeTenantToken()}`)

    expect(res.body.notices).toHaveLength(0)
  })

  it('returns an empty list rather than erroring when nothing affects the tenant', async () => {
    store.tables['platform_incident_tenants'] = []
    const res = await request(makeApp())
      .get('/api/platform-notices')
      .set('Authorization', `Bearer ${await makeTenantToken()}`)

    expect(res.status).toBe(200)
    expect(res.body.notices).toEqual([])
  })

  it('requires authentication', async () => {
    const res = await request(makeApp()).get('/api/platform-notices')
    expect(res.status).toBe(401)
  })
})
