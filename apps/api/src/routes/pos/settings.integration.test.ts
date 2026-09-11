import { jest, describe, it, expect, beforeEach } from '@jest/globals'
import { mintTestToken } from '../__test-support__/jwt.js'
import {
  createStore,
  createMockSupabase,
  type MockStore,
} from '../__test-support__/supabase-mock.js'
import { seedEntitledTenant } from '../__test-support__/tenant-fixture.js'

let store: MockStore = createStore()

jest.unstable_mockModule('@supabase/supabase-js', () => ({
  createClient: () => createMockSupabase(store),
}))

const TENANT_ID = 'aaaaaaaa-0000-0000-0000-00000set0001'
const OTHER_TENANT_ID = 'aaaaaaaa-0000-0000-0000-00000set0002'
const LOCATION_ID = 'bbbbbbbb-0000-0000-0000-00000loc0001'
const SECRET = process.env['AUTH_SECRET'] ?? 'test-secret-for-unit-tests-only-32ch'
process.env['AUTH_SECRET'] = SECRET
process.env['SUPABASE_URL'] = 'https://mock.supabase.co'
process.env['SUPABASE_SERVICE_ROLE_KEY'] = 'mock-service-key'

async function makeToken(): Promise<string> {
  return mintTestToken(
    { sub: 'u1', tenantId: TENANT_ID, role: 'owner', vertical: 'restaurant' },
    { secret: SECRET }
  )
}

const { default: express } = await import('express')
const { default: request } = await import('supertest')
const { default: settingsRouter } = await import('./settings.js')

function makeApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/pos/settings', settingsRouter)
  return app
}

beforeEach(() => {
  store = createStore()
  seedEntitledTenant(store, TENANT_ID, {
    modules: { pos: true },
    name: 'Demo Diner',
    tax_rate: '8.75',
  })
  store.tables['locations'] = [{ id: LOCATION_ID, tenant_id: TENANT_ID, name: 'Demo Location' }]
})

describe('GET /api/pos/settings', () => {
  it('converts the tenant tax percentage to basis points', async () => {
    const res = await request(makeApp())
      .get(`/api/pos/settings?location_id=${LOCATION_ID}`)
      .set('Authorization', `Bearer ${await makeToken()}`)

    expect(res.status).toBe(200)
    // 8.75% → 875 bps, which is what cartTotals expects.
    expect(res.body.tax_rate_bps).toBe(875)
  })

  it('returns the business and location names for the header', async () => {
    const res = await request(makeApp())
      .get(`/api/pos/settings?location_id=${LOCATION_ID}`)
      .set('Authorization', `Bearer ${await makeToken()}`)

    expect(res.body.business_name).toBe('Demo Diner')
    expect(res.body.location_name).toBe('Demo Location')
  })

  it('treats a null tax rate as zero rather than NaN', async () => {
    seedEntitledTenant(store, TENANT_ID, { modules: { pos: true }, tax_rate: null })
    const res = await request(makeApp())
      .get(`/api/pos/settings?location_id=${LOCATION_ID}`)
      .set('Authorization', `Bearer ${await makeToken()}`)

    expect(res.body.tax_rate_bps).toBe(0)
  })

  it('rounds a fractional basis point rather than emitting a fraction', async () => {
    // 8.125% is 812.5 bps; cartTotals multiplies by an integer bps value.
    seedEntitledTenant(store, TENANT_ID, { modules: { pos: true }, tax_rate: '8.125' })
    const res = await request(makeApp())
      .get(`/api/pos/settings?location_id=${LOCATION_ID}`)
      .set('Authorization', `Bearer ${await makeToken()}`)

    expect(Number.isInteger(res.body.tax_rate_bps)).toBe(true)
    expect(res.body.tax_rate_bps).toBe(813)
  })

  it('requires a location_id', async () => {
    const res = await request(makeApp())
      .get('/api/pos/settings')
      .set('Authorization', `Bearer ${await makeToken()}`)

    expect(res.status).toBe(400)
  })

  it('404s for a location belonging to another tenant', async () => {
    store.tables['locations'] = [{ id: LOCATION_ID, tenant_id: OTHER_TENANT_ID, name: 'Theirs' }]
    const res = await request(makeApp())
      .get(`/api/pos/settings?location_id=${LOCATION_ID}`)
      .set('Authorization', `Bearer ${await makeToken()}`)

    expect(res.status).toBe(404)
  })

  it('403s when the pos module is disabled', async () => {
    seedEntitledTenant(store, TENANT_ID, { modules: { pos: false } })
    const res = await request(makeApp())
      .get(`/api/pos/settings?location_id=${LOCATION_ID}`)
      .set('Authorization', `Bearer ${await makeToken()}`)

    expect(res.status).toBe(403)
  })
})
