import { jest, describe, it, expect, beforeEach } from '@jest/globals'
import { mintTestToken } from './__test-support__/jwt.js'
import {
  createStore,
  createMockSupabase,
  type MockStore,
} from './__test-support__/supabase-mock.js'

let store: MockStore = createStore()

let webhookEvent: unknown = null
const mockConstructEvent = jest.fn(() => webhookEvent)
const mockSubRetrieve = jest.fn()

jest.unstable_mockModule('@supabase/supabase-js', () => ({
  createClient: () => createMockSupabase(store),
}))
jest.unstable_mockModule('stripe', () => ({
  default: jest.fn().mockImplementation(() => ({
    webhooks: { constructEvent: mockConstructEvent },
    subscriptions: { retrieve: mockSubRetrieve },
  })),
}))

const TENANT_ID = 'aaaaaaaa-0000-0000-0000-00000rp00001'
const SECRET = process.env['AUTH_SECRET'] ?? 'test-secret-for-unit-tests-only-32ch'
process.env['AUTH_SECRET'] = SECRET
process.env['SUPABASE_URL'] = 'https://mock.supabase.co'
process.env['SUPABASE_SERVICE_ROLE_KEY'] = 'mock-service-key'
process.env['STRIPE_SECRET_KEY'] = 'sk_test_mock'
process.env['STRIPE_WEBHOOK_SECRET'] = 'whsec_mock'
process.env['PLATFORM_TENANT_ID'] = 'platform-tenant'
process.env['REDIS_URL'] = 'redis://localhost:6379'
process.env['STRIPE_PRICE_CORE_MONTHLY'] = 'price_core_m'
process.env['STRIPE_PRICE_PRO_MONTHLY'] = 'price_pro_m'
process.env['STRIPE_PRICE_SCALE_MONTHLY'] = 'price_scale_m'

async function makePlatformToken(): Promise<string> {
  return mintTestToken(
    { sub: 'nuatis-1', tenantId: 'platform-tenant', role: 'owner' },
    { secret: SECRET }
  )
}

const { default: express } = await import('express')
const { default: request } = await import('supertest')
const { default: webhooksRouter } = await import('./stripe-billing-webhooks.js')
const { default: adminConsoleRouter } = await import('./admin-console.js')

function makeApp() {
  const app = express()
  app.use('/api/webhooks/stripe-billing', express.raw({ type: '*/*' }), webhooksRouter)
  app.use('/api/admin-console', express.json(), adminConsoleRouter)
  return app
}

beforeEach(() => {
  store = createStore()
  store.tables['tenants'] = [
    { id: TENANT_ID, name: 'Referred Co', stripe_customer_id: 'cus_1' },
    { id: 'referring-tenant', name: 'Referring Co' },
  ]
  store.tables['referral_codes'] = [
    {
      id: 'code-1',
      tenant_id: 'referring-tenant',
      code: 'REFCO',
      commission_rate: 20,
      status: 'active',
    },
  ]
  store.tables['referral_signups'] = [
    {
      id: 'signup-1',
      referral_code_id: 'code-1',
      referring_tenant_id: 'referring-tenant',
      referred_email: 'owner@referred.co',
      referred_tenant_id: TENANT_ID,
      status: 'signed_up',
    },
  ]
  mockConstructEvent.mockClear()
  mockSubRetrieve.mockClear()
  webhookEvent = null
})

describe('checkout.session.completed — referral activation', () => {
  it('computes commission and flips the signup to active on first payment', async () => {
    webhookEvent = {
      type: 'checkout.session.completed',
      data: {
        object: {
          subscription: 'sub_1',
          customer: 'cus_1',
          metadata: { tenant_id: TENANT_ID },
        },
      },
    }
    mockSubRetrieve.mockResolvedValue({
      id: 'sub_1',
      status: 'active',
      current_period_end: 0,
      trial_end: 0,
      items: {
        data: [{ id: 'si_1', price: { id: 'price_pro_m', recurring: { usage_type: 'licensed' } } }],
      },
    })

    const res = await request(makeApp())
      .post('/api/webhooks/stripe-billing')
      .set('stripe-signature', 'sig')
      .send(Buffer.from('{}'))

    expect(res.status).toBe(200)
    const signup = store.tables['referral_signups']?.[0]
    expect(signup?.['status']).toBe('active')
    // pro = $299/mo, 20% commission = $59.80
    expect(signup?.['commission_amount']).toBeCloseTo(59.8, 2)
    expect(signup?.['activated_at']).toBeTruthy()
  })

  it('uses the flat fixed reward instead of the percentage when reward_type is fixed', async () => {
    store.tables['referral_codes'] = [
      {
        id: 'code-1',
        tenant_id: 'referring-tenant',
        code: 'REFCO',
        commission_rate: 20,
        reward_type: 'fixed',
        fixed_reward_cents: 5000,
        status: 'active',
      },
    ]
    webhookEvent = {
      type: 'checkout.session.completed',
      data: {
        object: {
          subscription: 'sub_1',
          customer: 'cus_1',
          metadata: { tenant_id: TENANT_ID },
        },
      },
    }
    mockSubRetrieve.mockResolvedValue({
      id: 'sub_1',
      status: 'active',
      current_period_end: 0,
      trial_end: 0,
      items: {
        data: [{ id: 'si_1', price: { id: 'price_pro_m', recurring: { usage_type: 'licensed' } } }],
      },
    })

    const res = await request(makeApp())
      .post('/api/webhooks/stripe-billing')
      .set('stripe-signature', 'sig')
      .send(Buffer.from('{}'))

    expect(res.status).toBe(200)
    const signup = store.tables['referral_signups']?.[0]
    expect(signup?.['commission_amount']).toBe(50)
  })

  it('does nothing when the tenant was never referred', async () => {
    store.tables['referral_signups'] = []
    webhookEvent = {
      type: 'checkout.session.completed',
      data: {
        object: { subscription: 'sub_1', customer: 'cus_1', metadata: { tenant_id: TENANT_ID } },
      },
    }
    mockSubRetrieve.mockResolvedValue({
      id: 'sub_1',
      status: 'active',
      current_period_end: 0,
      trial_end: 0,
      items: { data: [{ id: 'si_1', price: { id: 'price_pro_m', recurring: {} } }] },
    })

    const res = await request(makeApp())
      .post('/api/webhooks/stripe-billing')
      .set('stripe-signature', 'sig')
      .send(Buffer.from('{}'))

    expect(res.status).toBe(200)
  })
})

describe('Admin console referral payout', () => {
  it('lists commissions with the referring tenant name resolved', async () => {
    store.tables['referral_signups'] = [
      {
        id: 'signup-1',
        referring_tenant_id: 'referring-tenant',
        referred_email: 'owner@referred.co',
        status: 'active',
        commission_amount: 59.8,
        activated_at: '2026-06-01T00:00:00Z',
        paid_at: null,
      },
    ]
    const token = await makePlatformToken()
    const res = await request(makeApp())
      .get('/api/admin-console/referrals')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.data[0].referring_tenant_name).toBe('Referring Co')
  })

  it('marks a referral paid, and rejects marking it twice', async () => {
    store.tables['referral_signups'] = [
      {
        id: 'signup-1',
        referring_tenant_id: 'referring-tenant',
        referred_email: 'owner@referred.co',
        status: 'active',
        commission_amount: 59.8,
      },
    ]
    const token = await makePlatformToken()
    const res1 = await request(makeApp())
      .post('/api/admin-console/referrals/signup-1/mark-paid')
      .set('Authorization', `Bearer ${token}`)
    expect(res1.status).toBe(200)
    expect(res1.body.status).toBe('paid')

    const res2 = await request(makeApp())
      .post('/api/admin-console/referrals/signup-1/mark-paid')
      .set('Authorization', `Bearer ${token}`)
    expect(res2.status).toBe(409)
  })
})

describe('Admin console referral codes — reward structure', () => {
  it('lists codes with reward_type/commission_rate and the tenant name resolved', async () => {
    store.tables['referral_codes'] = [
      {
        id: 'code-1',
        tenant_id: 'referring-tenant',
        code: 'REFCO',
        commission_rate: 20,
        reward_type: 'percent',
        fixed_reward_cents: null,
        status: 'active',
      },
    ]
    const token = await makePlatformToken()
    const res = await request(makeApp())
      .get('/api/admin-console/referral-codes')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.data[0].tenant_name).toBe('Referring Co')
    expect(res.body.data[0].reward_type).toBe('percent')
  })

  it('sets a fixed reward via PATCH', async () => {
    const token = await makePlatformToken()
    const res = await request(makeApp())
      .patch('/api/admin-console/referral-codes/code-1')
      .set('Authorization', `Bearer ${token}`)
      .send({ reward_type: 'fixed', fixed_reward_cents: 5000 })

    expect(res.status).toBe(200)
    expect(res.body.reward_type).toBe('fixed')
    expect(res.body.fixed_reward_cents).toBe(5000)
  })

  it('400s a fixed reward with no amount', async () => {
    const token = await makePlatformToken()
    const res = await request(makeApp())
      .patch('/api/admin-console/referral-codes/code-1')
      .set('Authorization', `Bearer ${token}`)
      .send({ reward_type: 'fixed' })

    expect(res.status).toBe(400)
  })

  it('reverts to percent', async () => {
    store.tables['referral_codes'] = [
      {
        id: 'code-1',
        tenant_id: 'referring-tenant',
        code: 'REFCO',
        commission_rate: 20,
        reward_type: 'fixed',
        fixed_reward_cents: 5000,
        status: 'active',
      },
    ]
    const token = await makePlatformToken()
    const res = await request(makeApp())
      .patch('/api/admin-console/referral-codes/code-1')
      .set('Authorization', `Bearer ${token}`)
      .send({ reward_type: 'percent' })

    expect(res.status).toBe(200)
    expect(res.body.reward_type).toBe('percent')
  })
})
