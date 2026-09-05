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

const TENANT_ID = 'aaaaaaaa-0000-0000-0000-00000eh00001'
const OTHER_TENANT_ID = 'aaaaaaaa-0000-0000-0000-00000eh00099'
const SECRET = process.env['AUTH_SECRET'] ?? 'test-secret-for-unit-tests-only-32ch'
process.env['AUTH_SECRET'] = SECRET
process.env['SUPABASE_URL'] = 'https://mock.supabase.co'
process.env['SUPABASE_SERVICE_ROLE_KEY'] = 'mock-service-key'

async function makeToken(): Promise<string> {
  return mintTestToken({ sub: 'user-1', tenantId: TENANT_ID, role: 'owner' }, { secret: SECRET })
}

const { default: express } = await import('express')
const { default: request } = await import('supertest')
const { default: emailHealthRouter } = await import('./email-health.js')

function makeApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/email', emailHealthRouter)
  return app
}

beforeEach(() => {
  store = createStore()
  store.tables['contacts'] = [
    {
      id: 'c-ok',
      tenant_id: TENANT_ID,
      full_name: 'Healthy Contact',
      email: 'ok@example.com',
      email_status: 'ok',
    },
    {
      id: 'c-bounced',
      tenant_id: TENANT_ID,
      full_name: 'Bounced Contact',
      email: 'bounced@example.com',
      email_status: 'hard_bounce',
      email_risk_score: 90,
    },
    {
      id: 'c-unsub',
      tenant_id: TENANT_ID,
      full_name: 'Unsubbed Contact',
      email: 'unsub@example.com',
      email_status: 'unsubscribed',
    },
    {
      id: 'c-other-tenant',
      tenant_id: OTHER_TENANT_ID,
      full_name: 'Other Tenant Contact',
      email: 'other@example.com',
      email_status: 'hard_bounce',
    },
  ]
})

describe('GET /api/email/suppressed', () => {
  it('returns only suppressed contacts for this tenant', async () => {
    const token = await makeToken()
    const res = await request(makeApp())
      .get('/api/email/suppressed')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    const ids = res.body.data.map((c: { id: string }) => c.id)
    expect(ids.sort()).toEqual(['c-bounced', 'c-unsub'])
  })
})

describe('PATCH /api/email/suppressed/:contactId', () => {
  it('reactivates a suppressed contact', async () => {
    const token = await makeToken()
    const res = await request(makeApp())
      .patch('/api/email/suppressed/c-bounced')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.email_status).toBe('ok')
    expect(res.body.email_risk_score).toBe(0)
  })

  it('404s a contact in another tenant', async () => {
    const token = await makeToken()
    const res = await request(makeApp())
      .patch('/api/email/suppressed/c-other-tenant')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(404)
  })
})
