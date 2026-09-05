import { jest, describe, it, expect, beforeEach } from '@jest/globals'
import { mintTestToken } from './__test-support__/jwt.js'
import {
  createStore,
  createMockSupabase,
  type MockStore,
  type Row,
} from './__test-support__/supabase-mock.js'
import { seedEntitledTenant } from './__test-support__/tenant-fixture.js'

let store: MockStore = createStore()

jest.unstable_mockModule('@supabase/supabase-js', () => ({
  createClient: () => createMockSupabase(store),
}))
jest.unstable_mockModule('../lib/lead-score-queue.js', () => ({
  enqueueScoreCompute: jest.fn(),
}))
jest.unstable_mockModule('../lib/notifications.js', () => ({ notifyOwner: jest.fn() }))
jest.unstable_mockModule('../lib/activity.js', () => ({ logActivity: jest.fn() }))
jest.unstable_mockModule('../lib/contact-enrichment.js', () => ({
  autoEnrichContact: jest.fn(() => ({ updates: {}, suggestedCompany: null })),
}))

const TENANT_ID = 'aaaaaaaa-0000-0000-0000-00000fd00001'
const SECRET = process.env['AUTH_SECRET'] ?? 'test-secret-for-unit-tests-only-32ch'
process.env['AUTH_SECRET'] = SECRET
process.env['SUPABASE_URL'] = 'https://mock.supabase.co'
process.env['SUPABASE_SERVICE_ROLE_KEY'] = 'mock-service-key'

async function makeToken(): Promise<string> {
  return mintTestToken({ sub: 'user-1', tenantId: TENANT_ID, role: 'owner' }, { secret: SECRET })
}

const [{ default: express }, { default: request }, { default: contactsRouter }] = await Promise.all(
  [import('express'), import('supertest'), import('./contacts.js')]
)

function makeApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/contacts', contactsRouter)
  return app
}

beforeEach(() => {
  store = createStore()
  seedEntitledTenant(store, TENANT_ID)
})

describe('GET /api/contacts/field-definitions', () => {
  it('returns the vertical field list for a dental tenant', async () => {
    ;(store.tables['tenants'] as Row[])[0]!['vertical'] = 'dental'
    const token = await makeToken()
    const res = await request(makeApp())
      .get('/api/contacts/field-definitions')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.vertical).toBe('dental')
    expect(Array.isArray(res.body.fields)).toBe(true)
    expect(res.body.fields.length).toBeGreaterThan(0)
    expect(res.body.fields[0]).toHaveProperty('key')
    expect(res.body.fields[0]).toHaveProperty('label')
    expect(res.body.fields[0]).toHaveProperty('type')
  })

  it('returns an empty field list for a tenant with no vertical set', async () => {
    const token = await makeToken()
    const res = await request(makeApp())
      .get('/api/contacts/field-definitions')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.fields).toEqual([])
  })

  it('does not fall through to the :id route (real route, not treated as a contact id)', async () => {
    const token = await makeToken()
    const res = await request(makeApp())
      .get('/api/contacts/field-definitions')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).not.toBe(404)
  })
})
