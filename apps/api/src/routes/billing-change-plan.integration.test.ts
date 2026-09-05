import { jest, describe, it, expect, beforeEach } from '@jest/globals'
import { mintTestToken } from './__test-support__/jwt.js'
import {
  createStore,
  createMockSupabase,
  type MockStore,
} from './__test-support__/supabase-mock.js'
import { entitledTenantRow } from './__test-support__/tenant-fixture.js'

let store: MockStore = createStore()

const mockRetrieve = jest.fn(async () => ({
  items: {
    data: [
      { id: 'si_base', price: { id: 'price_pro_m', recurring: { usage_type: 'licensed' } } },
      { id: 'si_overage', price: { id: 'price_pro_o', recurring: { usage_type: 'metered' } } },
    ],
  },
}))
const mockUpdate = jest.fn(async () => ({ id: 'sub_1' }))

jest.unstable_mockModule('@supabase/supabase-js', () => ({
  createClient: () => createMockSupabase(store),
}))
jest.unstable_mockModule('stripe', () => ({
  default: jest.fn().mockImplementation(() => ({
    subscriptions: { retrieve: mockRetrieve, update: mockUpdate },
  })),
}))

const TENANT_ID = 'aaaaaaaa-0000-0000-0000-00000cp00001'
const SECRET = process.env['AUTH_SECRET'] ?? 'test-secret-for-unit-tests-only-32ch'
process.env['AUTH_SECRET'] = SECRET
process.env['SUPABASE_URL'] = 'https://mock.supabase.co'
process.env['SUPABASE_SERVICE_ROLE_KEY'] = 'mock-service-key'
process.env['STRIPE_SECRET_KEY'] = 'sk_test_mock'
process.env['STRIPE_PRICE_CORE_MONTHLY'] = 'price_core_m'
process.env['STRIPE_PRICE_CORE_ANNUAL'] = 'price_core_y'
process.env['STRIPE_PRICE_CORE_OVERAGE'] = 'price_core_o'
process.env['STRIPE_PRICE_PRO_MONTHLY'] = 'price_pro_m'
process.env['STRIPE_PRICE_PRO_ANNUAL'] = 'price_pro_y'
process.env['STRIPE_PRICE_PRO_OVERAGE'] = 'price_pro_o'
process.env['STRIPE_PRICE_SCALE_MONTHLY'] = 'price_scale_m'
process.env['STRIPE_PRICE_SCALE_ANNUAL'] = 'price_scale_y'

async function makeToken(role = 'owner'): Promise<string> {
  return mintTestToken({ sub: 'user-1', tenantId: TENANT_ID, role }, { secret: SECRET })
}

const { default: express } = await import('express')
const { default: request } = await import('supertest')
const { default: billingRouter } = await import('./billing.js')

function makeApp() {
  const app = express()
  app.use('/api/billing', express.json(), billingRouter)
  return app
}

beforeEach(() => {
  store = createStore()
  store.tables['tenants'] = [
    entitledTenantRow(TENANT_ID, {
      subscription_plan: 'pro',
      stripe_subscription_id: 'sub_1',
    }),
  ]
  mockRetrieve.mockClear()
  mockUpdate.mockClear()
})

describe('POST /api/billing/change-plan', () => {
  it('swaps the base price and the metered overage item when upgrading pro -> scale', async () => {
    const token = await makeToken()
    const res = await request(makeApp())
      .post('/api/billing/change-plan')
      .set('Authorization', `Bearer ${token}`)
      .send({ plan: 'scale', interval: 'month' })

    expect(res.status).toBe(200)
    expect(mockUpdate).toHaveBeenCalledTimes(1)
    const [subId, params] = mockUpdate.mock.calls[0] as [string, { items: unknown[] }]
    expect(subId).toBe('sub_1')
    // scale has no overage price — the metered item must be deleted, not swapped
    expect(params.items).toContainEqual({ id: 'si_base', price: 'price_scale_m' })
    expect(params.items).toContainEqual({ id: 'si_overage', deleted: true })
  })

  it('swaps both items when downgrading (target plan still has an overage price)', async () => {
    store.tables['tenants'] = [
      entitledTenantRow(TENANT_ID, {
        subscription_plan: 'scale',
        stripe_subscription_id: 'sub_1',
      }),
    ]
    mockRetrieve.mockResolvedValueOnce({
      items: {
        data: [
          { id: 'si_base', price: { id: 'price_scale_m', recurring: { usage_type: 'licensed' } } },
        ],
      },
    } as never)

    const token = await makeToken()
    const res = await request(makeApp())
      .post('/api/billing/change-plan')
      .set('Authorization', `Bearer ${token}`)
      .send({ plan: 'pro', interval: 'month' })

    expect(res.status).toBe(200)
    const [, params] = mockUpdate.mock.calls[0] as [string, { items: unknown[] }]
    expect(params.items).toContainEqual({ id: 'si_base', price: 'price_pro_m' })
    expect(params.items).toContainEqual({ price: 'price_pro_o' })
  })

  it('400s when already on the requested plan', async () => {
    const token = await makeToken()
    const res = await request(makeApp())
      .post('/api/billing/change-plan')
      .set('Authorization', `Bearer ${token}`)
      .send({ plan: 'pro', interval: 'month' })
    expect(res.status).toBe(400)
  })

  it('400s when the tenant has no active subscription', async () => {
    store.tables['tenants'] = [
      entitledTenantRow(TENANT_ID, { subscription_plan: null, stripe_subscription_id: null }),
    ]
    const token = await makeToken()
    const res = await request(makeApp())
      .post('/api/billing/change-plan')
      .set('Authorization', `Bearer ${token}`)
      .send({ plan: 'scale', interval: 'month' })
    expect(res.status).toBe(400)
  })

  it('403s a non-owner/admin role', async () => {
    const token = await makeToken('staff')
    const res = await request(makeApp())
      .post('/api/billing/change-plan')
      .set('Authorization', `Bearer ${token}`)
      .send({ plan: 'scale', interval: 'month' })
    expect(res.status).toBe(403)
  })

  it('400s an invalid plan key', async () => {
    const token = await makeToken()
    const res = await request(makeApp())
      .post('/api/billing/change-plan')
      .set('Authorization', `Bearer ${token}`)
      .send({ plan: 'enterprise', interval: 'month' })
    expect(res.status).toBe(400)
  })
})
