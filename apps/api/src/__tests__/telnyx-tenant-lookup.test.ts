import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals'
import {
  createStore,
  createMockSupabase,
  type MockStore,
} from '../routes/__test-support__/supabase-mock.js'

process.env['SUPABASE_URL'] = 'https://mock.supabase.co'
process.env['SUPABASE_SERVICE_ROLE_KEY'] = 'mock-service-key'
delete process.env['TELNYX_TENANT_MAP']

let store: MockStore = createStore()
// When true, the mocked supabase client hangs forever (for timeout coverage).
let hangForever = false

function makeHangingClient(): unknown {
  const q: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'order', 'limit']) {
    q[m] = () => q
  }
  q['maybeSingle'] = () => new Promise(() => {})
  return { from: () => q }
}

jest.unstable_mockModule('@supabase/supabase-js', () => ({
  createClient: () => (hangForever ? makeHangingClient() : createMockSupabase(store)),
}))

const { getTenantPhoneNumber } = await import('../lib/telnyx-tenant-lookup.js')

beforeEach(() => {
  store = createStore()
  store.tables['telnyx_numbers'] = []
  hangForever = false
})

afterEach(() => {
  jest.restoreAllMocks()
})

describe('getTenantPhoneNumber', () => {
  it('returns the primary active number when one exists', async () => {
    store.tables['telnyx_numbers'] = [
      { tenant_id: 'tenant-1', phone_number: '+15550000001', status: 'active', is_primary: false },
      { tenant_id: 'tenant-1', phone_number: '+15550000002', status: 'active', is_primary: true },
    ]
    const result = await getTenantPhoneNumber('tenant-1')
    expect(result).toBe('+15550000002')
  })

  it('returns the non-primary active number when no primary exists', async () => {
    store.tables['telnyx_numbers'] = [
      { tenant_id: 'tenant-1', phone_number: '+15550000003', status: 'active', is_primary: false },
    ]
    const result = await getTenantPhoneNumber('tenant-1')
    expect(result).toBe('+15550000003')
  })

  it('returns null when the tenant has no active numbers', async () => {
    store.tables['telnyx_numbers'] = [
      { tenant_id: 'tenant-1', phone_number: '+15550000004', status: 'inactive', is_primary: true },
      { tenant_id: 'tenant-2', phone_number: '+15550000005', status: 'active', is_primary: true },
    ]
    const result = await getTenantPhoneNumber('tenant-1')
    expect(result).toBeNull()
  })

  it('returns null and warns on a Supabase error', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    store.tableErrors = { telnyx_numbers: { message: 'connection reset' } }
    const result = await getTenantPhoneNumber('tenant-1')
    expect(result).toBeNull()
    expect(warn).toHaveBeenCalledWith(
      '[getTenantPhoneNumber] lookup failed for tenant %s: %s',
      'tenant-1',
      'connection reset'
    )
  })

  it('returns null on a 2s timeout', async () => {
    jest.useFakeTimers()
    hangForever = true
    try {
      const pending = getTenantPhoneNumber('tenant-1')
      await jest.advanceTimersByTimeAsync(2000)
      const result = await pending
      expect(result).toBeNull()
    } finally {
      jest.useRealTimers()
    }
  })
})
