/**
 * ENUM-1 security regression — gift-card balance route.
 *
 * The balance route was made authed + tenant-scoped this session. Proves it
 * rejects unauthenticated callers (401) and cannot read another tenant's card
 * (404), with a positive control reading the owner's own card.
 *
 * NOTE: the per-IP rate limiter on this route is intentionally NOT tested —
 * it is bypassed under NODE_ENV==='test' via skip: () => NODE_ENV==='test',
 * so it never engages in the test harness.
 */
import { jest, describe, it, expect, beforeEach } from '@jest/globals'
import { mintTestToken } from './__test-support__/jwt.js'
import {
  createStore,
  createMockSupabase,
  type MockStore,
} from './__test-support__/supabase-mock.js'
import { entitledTenantRow } from './__test-support__/tenant-fixture.js'

let store: MockStore = createStore()

jest.unstable_mockModule('@supabase/supabase-js', () => ({
  createClient: () => createMockSupabase(store),
}))

const A_TENANT = 'aaaaaaaa-0000-0000-0000-0000000gc00a1'
const B_TENANT = 'bbbbbbbb-0000-0000-0000-0000000gc00b1'
const SECRET = process.env['AUTH_SECRET'] ?? 'test-secret-for-unit-tests-only-32ch'
process.env['AUTH_SECRET'] = SECRET
process.env['SUPABASE_URL'] = 'https://mock.supabase.co'
process.env['SUPABASE_SERVICE_ROLE_KEY'] = 'mock-service-key'

async function makeToken(tenantId: string, userId: string): Promise<string> {
  return mintTestToken(
    { sub: userId, tenantId, role: 'owner', vertical: 'dental' },
    { secret: SECRET }
  )
}

const [{ default: express }, { default: request }, { default: giftCardsRouter }] =
  await Promise.all([import('express'), import('supertest'), import('./gift-cards.js')])

function makeApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/gift-cards', giftCardsRouter)
  return app
}

beforeEach(() => {
  store = createStore()
  store.tables['tenants'] = [entitledTenantRow(A_TENANT), entitledTenantRow(B_TENANT)]
  store.tables['gift_cards'] = [
    {
      id: 'gc-b-1',
      tenant_id: B_TENANT,
      code: 'GIFTB',
      amount_cents: 5000,
      balance_cents: 5000,
      status: 'active',
      expires_at: null,
    },
    {
      id: 'gc-a-1',
      tenant_id: A_TENANT,
      code: 'GIFTA',
      amount_cents: 2000,
      balance_cents: 2000,
      status: 'active',
      expires_at: null,
    },
  ]
})

describe('ENUM-1 — gift-card balance', () => {
  it('rejects an unauthenticated balance lookup with 401', async () => {
    const res = await request(makeApp()).get('/api/gift-cards/GIFTB/balance')
    expect(res.status).toBe(401)
  })

  it("rejects (404) tenant A reading tenant B's gift-card balance", async () => {
    const token = await makeToken(A_TENANT, 'user-a')
    const res = await request(makeApp())
      .get('/api/gift-cards/GIFTB/balance')
      .set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(404)
  })

  it('POSITIVE CONTROL: tenant B reads its own gift-card balance (200)', async () => {
    const token = await makeToken(B_TENANT, 'user-b')
    const res = await request(makeApp())
      .get('/api/gift-cards/GIFTB/balance')
      .set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(200)
    expect(res.body.balance_cents).toBe(5000)
  })
})
