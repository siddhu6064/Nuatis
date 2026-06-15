import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals'
import {
  createStore,
  createMockSupabase,
  type MockStore,
} from '../routes/__test-support__/supabase-mock.js'

// ── Env ───────────────────────────────────────────────────────────────────────
process.env['SUPABASE_URL'] = 'https://mock.supabase.co'
process.env['SUPABASE_SERVICE_ROLE_KEY'] = 'mock-service-key'
// square.ts now imports lib/redis (OAuth nonce store); lazyConnect means no real
// connection, but redis.ts requires REDIS_URL to be set at import time.
process.env['REDIS_URL'] = 'redis://localhost:6379'

// ── Mocks ─────────────────────────────────────────────────────────────────────
let store: MockStore = createStore()

jest.unstable_mockModule('@supabase/supabase-js', () => ({
  createClient: () => createMockSupabase(store),
}))

// ── Dynamic imports ───────────────────────────────────────────────────────────
const { createSquarePayment } = await import('../lib/square-client.js')
const { getSquareConnectionStatus } = await import('../routes/square.js')

// ── Tests ─────────────────────────────────────────────────────────────────────
describe('square', () => {
  beforeEach(() => {
    store = createStore()
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  // ── Test 1: getSquareConnectionStatus returns connected=false when no row ────

  it('getSquareConnectionStatus returns { connected: false } when no square_connections row for tenant', async () => {
    store.tables['square_connections'] = []

    const result = await getSquareConnectionStatus('tenant-1')

    expect(result.connected).toBe(false)
  })

  // ── Test 2: createSquarePayment throws if no square_connections row ──────────

  it('createSquarePayment throws when no square_connections row found for tenant', async () => {
    store.tables['square_connections'] = []

    await expect(
      createSquarePayment({
        tenantId: 'tenant-1',
        amountCents: 1000,
        sourceId: 'nonce-abc',
        currency: 'USD',
      })
    ).rejects.toThrow('No Square connection found for tenant tenant-1')
  })

  // ── Test 3: createSquarePayment succeeds with valid row + mocked fetch ───────

  it('createSquarePayment resolves with paymentId when a valid square_connections row exists', async () => {
    store.tables['square_connections'] = [
      {
        id: 'conn-1',
        tenant_id: 'tenant-1',
        access_token: 'tok',
        refresh_token: 'ref',
        token_expires_at: new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString(),
        square_merchant_id: 'M1',
        square_location_id: 'L1',
      },
    ]

    jest.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        payment: {
          id: 'sq-pay-1',
          status: 'COMPLETED',
          receipt_url: 'https://r.sq/1',
          amount_money: { amount: 1000, currency: 'USD' },
        },
      }),
    } as Response)

    const result = await createSquarePayment({
      tenantId: 'tenant-1',
      amountCents: 1000,
      sourceId: 'nonce-abc',
      currency: 'USD',
    })

    expect(result.paymentId).toBe('sq-pay-1')
    expect(result.status).toBe('COMPLETED')
    expect(result.receiptUrl).toBe('https://r.sq/1')
  })

  // ── Test 4: getSquareConnectionStatus returns connected=true when row exists ─

  it('getSquareConnectionStatus returns { connected: true, merchant_id } when a row exists', async () => {
    store.tables['square_connections'] = [
      {
        id: 'conn-1',
        tenant_id: 'tenant-1',
        access_token: 'tok',
        refresh_token: 'ref',
        token_expires_at: new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString(),
        square_merchant_id: 'M1',
        square_location_id: 'L1',
      },
    ]

    const result = await getSquareConnectionStatus('tenant-1')

    expect(result.connected).toBe(true)
    expect(result.merchant_id).toBe('M1')
    expect(result.location_id).toBe('L1')
  })
})
