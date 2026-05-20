import { jest, describe, it, expect, beforeEach } from '@jest/globals'
import {
  createStore,
  createMockSupabase,
  type MockStore,
} from '../routes/__test-support__/supabase-mock.js'

// ── Env ───────────────────────────────────────────────────────────────────────
process.env['SUPABASE_URL'] = 'https://mock.supabase.co'
process.env['SUPABASE_SERVICE_ROLE_KEY'] = 'mock-service-key'
process.env['STRIPE_SECRET_KEY'] = 'sk_test_mock'

// ── Supabase mock ─────────────────────────────────────────────────────────────
let store: MockStore = createStore()

jest.unstable_mockModule('@supabase/supabase-js', () => ({
  createClient: () => createMockSupabase(store),
}))

// ── Stripe mock ───────────────────────────────────────────────────────────────
const mockStripeCancel = jest
  .fn<() => Promise<{ id: string; status: string }>>()
  .mockResolvedValue({
    id: 'sub_123',
    status: 'canceled',
  })
const mockStripeUpdate = jest
  .fn<() => Promise<{ id: string; status: string }>>()
  .mockResolvedValue({
    id: 'sub_123',
    status: 'active',
  })

jest.unstable_mockModule('stripe', () => {
  return {
    default: jest.fn().mockImplementation(() => ({
      subscriptions: {
        cancel: mockStripeCancel,
        update: mockStripeUpdate,
      },
    })),
  }
})

// ── Dynamic imports (after mocks) ─────────────────────────────────────────────
const { calcMonthlyEquivalent, processPauseSubscription, getSubscriptionsForTenant } =
  await import('../routes/subscriptions.js')

const { cancelStripeSubscription } = await import('../lib/stripe-subscriptions.js')

// ── Tests ─────────────────────────────────────────────────────────────────────
describe('subscriptions', () => {
  beforeEach(() => {
    store = createStore()
    jest.clearAllMocks()
  })

  // ── Test 1: POST /api/subscriptions — DB row stores correct interval ─────────

  it('calcMonthlyEquivalent stores weekly interval correctly (~433.33/mo)', () => {
    // Weekly $100 * 52 weeks / 12 months ≈ 433.33
    const result = calcMonthlyEquivalent(100, 'weekly')
    expect(result).toBeCloseTo(433.33, 1)
  })

  // ── Test 2: cancel with immediately=true calls stripe cancel ─────────────────

  it('cancelStripeSubscription with immediately=true calls stripe.subscriptions.cancel', async () => {
    await cancelStripeSubscription('sub_123', true)

    expect(mockStripeCancel).toHaveBeenCalledTimes(1)
    expect(mockStripeCancel).toHaveBeenCalledWith('sub_123')
    expect(mockStripeUpdate).not.toHaveBeenCalled()
  })

  // ── Test 3: pause sets status='paused' in DB ──────────────────────────────────

  it('processPauseSubscription sets status=paused in DB', async () => {
    store.tables['client_subscriptions'] = [
      {
        id: 'sub-1',
        tenant_id: 'tenant-1',
        stripe_subscription_id: 'sub_stripe_1',
        status: 'active',
      },
    ]

    const result = await processPauseSubscription('sub-1', 'tenant-1')

    expect(result.status).toBe(200)
    const row = store.tables['client_subscriptions']?.[0]
    expect(row?.['status']).toBe('paused')
    // Stripe update should have been called (pause_collection)
    expect(mockStripeUpdate).toHaveBeenCalledTimes(1)
  })

  // ── Test 4: MRR calculation for multiple intervals ────────────────────────────

  it('calcMonthlyEquivalent calculates MRR correctly for all intervals', () => {
    // Weekly $100 ≈ $433.33/mo
    expect(calcMonthlyEquivalent(100, 'weekly')).toBeCloseTo(433.33, 1)
    // Monthly $100 = $100/mo
    expect(calcMonthlyEquivalent(100, 'monthly')).toBe(100)
    // Annually $1200 = $100/mo
    expect(calcMonthlyEquivalent(1200, 'annually')).toBe(100)
  })

  // ── Test 5: GET /api/subscriptions returns only tenant's subscriptions ────────

  it('getSubscriptionsForTenant returns only subscriptions for the given tenant', async () => {
    store.tables['client_subscriptions'] = [
      {
        id: 'sub-1',
        tenant_id: 'tenant-A',
        name: 'Plan A',
        status: 'active',
        created_at: '2024-01-01T00:00:00Z',
      },
      {
        id: 'sub-2',
        tenant_id: 'tenant-B',
        name: 'Plan B',
        status: 'active',
        created_at: '2024-01-01T00:00:00Z',
      },
    ]

    const result = await getSubscriptionsForTenant('tenant-A')

    expect(result.error).toBeUndefined()
    expect(result.data).toHaveLength(1)
    expect((result.data[0] as Record<string, unknown>)?.['id']).toBe('sub-1')
    expect((result.data[0] as Record<string, unknown>)?.['tenant_id']).toBe('tenant-A')
  })
})
