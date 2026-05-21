import { describe, it, expect, jest, beforeEach } from '@jest/globals'
import {
  createStore,
  createMockSupabase,
  type MockStore,
  type Row,
} from '../routes/__test-support__/supabase-mock.js'

process.env['SUPABASE_URL'] = 'https://mock.supabase.co'
process.env['SUPABASE_SERVICE_ROLE_KEY'] = 'mock-service-key'

let store: MockStore = createStore()

jest.unstable_mockModule('@supabase/supabase-js', () => ({
  createClient: () => createMockSupabase(store),
}))

jest.unstable_mockModule('../lib/auth.js', () => ({
  requireAuth: (
    _req: { tenantId: string; userId: string; role: string },
    _res: unknown,
    next: () => void
  ) => {
    _req.tenantId = 'tenant-1'
    _req.userId = 'user-1'
    _req.role = 'admin'
    next()
  },
  requireModule: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}))

// Dynamic imports AFTER mocks
const [
  { default: express },
  { default: request },
  { default: referralsRouter },
  { generateReferralCode },
] = await Promise.all([
  import('express'),
  import('supertest'),
  import('../routes/referrals.js'),
  import('../lib/referral.js'),
])

function makeApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/referrals', referralsRouter)
  return app
}

beforeEach(() => {
  store = createStore()
  store.tables['referral_codes'] = []
  store.tables['referral_signups'] = []
  store.tables['tenants'] = []
})

// ── Test 1: generateReferralCode — code format ────────────────────────────────
describe('generateReferralCode — code format', () => {
  it('generates code matching PREFIX-XXXX format (uppercase letters only)', async () => {
    store.tables['tenants'] = [{ id: 'tenant-1', business_name: 'Dental Associates' }]
    // generateReferralCode inserts into referral_codes
    const code = await generateReferralCode('tenant-1', 'Dental Associates')
    // Should match DENTAL-XXXX where XXXX is 4 uppercase letters
    expect(code).toMatch(/^DENTAL-[A-Z]{4}$/)
    // Should be stored in the mock
    const rows = store.tables['referral_codes'] as Row[]
    expect(rows.length).toBe(1)
    expect(rows[0]?.['commission_rate']).toBe(10)
  })
})

// ── Test 2: GET /api/referrals/my-code — auto-generate ───────────────────────
it('auto-generates a referral code if tenant has none, returns referral_url', async () => {
  store.tables['tenants'] = [{ id: 'tenant-1', business_name: 'Green Salon' }]
  // No existing referral_codes for tenant-1

  const res = await request(makeApp())
    .get('/api/referrals/my-code')

  expect(res.status).toBe(200)
  expect(res.body.code).toMatch(/^GREEN-[A-Z]{4}$/)
  expect(res.body.referral_url).toContain('https://app.nuatis.com/signup?ref=GREEN-')
})

// ── Test 3: GET /api/referrals/track/:code — click increment + redirect ───────
it('increments click count and redirects to signup URL', async () => {
  store.tables['referral_codes'] = [{
    id: 'code-1',
    tenant_id: 'tenant-1',
    code: 'SALON-WXYZ',
    clicks: 3,
    signups: 0,
    status: 'active',
    commission_rate: 10,
  }]

  const res = await request(makeApp())
    .get('/api/referrals/track/SALON-WXYZ')
    .redirects(0)  // don't follow redirects

  expect(res.status).toBe(302)
  expect(res.headers['location']).toBe('https://app.nuatis.com/signup?ref=SALON-WXYZ')

  // Verify click was incremented
  const rows = store.tables['referral_codes'] as Row[]
  expect(rows[0]?.['clicks']).toBe(4)
})

// ── Test 4: POST /api/referrals/signup — invalid code returns 404 ─────────────
it('returns 404 when referral code does not exist', async () => {
  const res = await request(makeApp())
    .post('/api/referrals/signup')
    .send({ code: 'INVALID-XXXX', email: 'test@example.com' })

  expect(res.status).toBe(404)
  expect(res.body.error).toMatch(/invalid.*referral.*code/i)
})

// ── Test 5: POST /api/referrals/signup — successful signup ───────────────────
it('creates referral_signup row and increments signups count', async () => {
  store.tables['referral_codes'] = [{
    id: 'code-1',
    tenant_id: 'tenant-1',
    code: 'SALON-ABCD',
    clicks: 0,
    signups: 0,
    status: 'active',
    commission_rate: 10,
  }]

  const res = await request(makeApp())
    .post('/api/referrals/signup')
    .send({ code: 'SALON-ABCD', email: 'newbiz@example.com' })

  expect(res.status).toBe(201)
  expect(res.body.ok).toBe(true)

  // Signup row created
  const signupRows = store.tables['referral_signups'] as Row[]
  expect(signupRows.length).toBe(1)
  expect(signupRows[0]?.['referred_email']).toBe('newbiz@example.com')
  expect(signupRows[0]?.['status']).toBe('signed_up')

  // Signups counter incremented
  const codeRows = store.tables['referral_codes'] as Row[]
  expect(codeRows[0]?.['signups']).toBe(1)
})

// ── Test 6: GET /api/referrals/signups — estimated_mrr calculation ────────────
it('calculates estimated_mrr: 3 active signups * $149 * 0.10 = $44.70', async () => {
  store.tables['referral_codes'] = [{
    id: 'code-1',
    tenant_id: 'tenant-1',
    code: 'DENTAL-ABCD',
    clicks: 0,
    signups: 3,
    status: 'active',
    commission_rate: 10,
  }]
  store.tables['referral_signups'] = [
    { id: 'sig-1', referring_tenant_id: 'tenant-1', referred_email: 'a@example.com', status: 'active', referral_code_id: 'code-1', created_at: new Date().toISOString() },
    { id: 'sig-2', referring_tenant_id: 'tenant-1', referred_email: 'b@example.com', status: 'active', referral_code_id: 'code-1', created_at: new Date().toISOString() },
    { id: 'sig-3', referring_tenant_id: 'tenant-1', referred_email: 'c@example.com', status: 'active', referral_code_id: 'code-1', created_at: new Date().toISOString() },
  ]

  const res = await request(makeApp())
    .get('/api/referrals/signups')

  expect(res.status).toBe(200)
  expect(res.body.estimated_mrr).toBeCloseTo(44.70, 2)
  expect(res.body.total).toBe(3)
})
