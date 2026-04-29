import { jest, describe, test, expect, beforeEach } from '@jest/globals'
import {
  createStore,
  createMockSupabase,
  type MockStore,
} from '../routes/__test-support__/supabase-mock.js'

// ── Module-level mocks (must precede all dynamic imports) ─────────────────────

let store: MockStore = createStore()

jest.unstable_mockModule('@supabase/supabase-js', () => ({
  createClient: () => createMockSupabase(store),
}))

process.env['SUPABASE_URL'] = 'https://mock.supabase.co'
process.env['SUPABASE_SERVICE_ROLE_KEY'] = 'mock-service-key'
process.env['TELNYX_API_KEY'] = 'mock-telnyx-key'

const mockFetch = jest.fn()
global.fetch = mockFetch as unknown as typeof fetch

// ── Dynamic imports (after all unstable_mockModule calls) ─────────────────────

const { checkTcpaOptIn, grantTcpaOptIn } = await import('../lib/tcpa.js')
const { sendSms } = await import('../lib/sms.js')

// ── Constants ─────────────────────────────────────────────────────────────────

const TENANT_ID = 'aaaaaaaa-0000-0000-0000-000tcpa0001'
const CONTACT_ID = 'cccccccc-0000-0000-0000-000tcpa0001'

// ── checkTcpaOptIn ────────────────────────────────────────────────────────────

describe('checkTcpaOptIn', () => {
  beforeEach(() => {
    store = createStore()
  })

  test('returns true when sms_opt_in is true', async () => {
    store.tables['contacts'] = [{ id: CONTACT_ID, tenant_id: TENANT_ID, sms_opt_in: true }]
    expect(await checkTcpaOptIn(CONTACT_ID, TENANT_ID)).toBe(true)
  })

  test('returns false when sms_opt_in is false', async () => {
    store.tables['contacts'] = [{ id: CONTACT_ID, tenant_id: TENANT_ID, sms_opt_in: false }]
    expect(await checkTcpaOptIn(CONTACT_ID, TENANT_ID)).toBe(false)
  })

  test('returns false when sms_opt_in is null', async () => {
    store.tables['contacts'] = [{ id: CONTACT_ID, tenant_id: TENANT_ID, sms_opt_in: null }]
    expect(await checkTcpaOptIn(CONTACT_ID, TENANT_ID)).toBe(false)
  })

  test('returns false when contact not found', async () => {
    store.tables['contacts'] = []
    expect(await checkTcpaOptIn(CONTACT_ID, TENANT_ID)).toBe(false)
  })

  test('returns false on supabase error — never throws', async () => {
    const saved = process.env['SUPABASE_URL']
    delete process.env['SUPABASE_URL']
    await expect(checkTcpaOptIn(CONTACT_ID, TENANT_ID)).resolves.toBe(false)
    process.env['SUPABASE_URL'] = saved
  })
})

// ── grantTcpaOptIn ────────────────────────────────────────────────────────────

describe('grantTcpaOptIn', () => {
  beforeEach(() => {
    store = createStore()
    store.tables['contacts'] = [{ id: CONTACT_ID, tenant_id: TENANT_ID, sms_opt_in: false }]
  })

  test('updates sms_opt_in to true for correct contact', async () => {
    await grantTcpaOptIn(CONTACT_ID, TENANT_ID)
    expect(store.tables['contacts']?.[0]?.['sms_opt_in']).toBe(true)
  })

  test('never throws on supabase error', async () => {
    const saved = process.env['SUPABASE_URL']
    delete process.env['SUPABASE_URL']
    await expect(grantTcpaOptIn(CONTACT_ID, TENANT_ID)).resolves.toBeUndefined()
    process.env['SUPABASE_URL'] = saved
  })
})

// ── sendSms — TCPA gate ───────────────────────────────────────────────────────

describe('sendSms — TCPA gate', () => {
  beforeEach(() => {
    store = createStore()
    mockFetch.mockReset()
  })

  function mockFetchSuccess() {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: { id: 'msg-123' } }),
    } as unknown as Response)
  }

  test('calls checkTcpaOptIn when contactId + tenantId present in options', async () => {
    store.tables['contacts'] = [{ id: CONTACT_ID, tenant_id: TENANT_ID, sms_opt_in: false }]
    await sendSms('+10000000001', '+10000000002', 'hi', {
      tenantId: TENANT_ID,
      contactId: CONTACT_ID,
    })
    // TCPA gate ran — fetch must not have been called
    expect(mockFetch).not.toHaveBeenCalled()
  })

  test('returns early without sending when checkTcpaOptIn false', async () => {
    store.tables['contacts'] = [{ id: CONTACT_ID, tenant_id: TENANT_ID, sms_opt_in: false }]
    const result = await sendSms('+10000000001', '+10000000002', 'hi', {
      tenantId: TENANT_ID,
      contactId: CONTACT_ID,
    })
    expect(result).toEqual({ success: false })
    expect(mockFetch).not.toHaveBeenCalled()
  })

  test('sends when checkTcpaOptIn returns true', async () => {
    store.tables['contacts'] = [{ id: CONTACT_ID, tenant_id: TENANT_ID, sms_opt_in: true }]
    mockFetchSuccess()
    const result = await sendSms('+10000000001', '+10000000002', 'hi', {
      tenantId: TENANT_ID,
      contactId: CONTACT_ID,
    })
    expect(mockFetch).toHaveBeenCalledTimes(1)
    expect(result.success).toBe(true)
  })

  test('skips TCPA check when options has no contactId', async () => {
    store.tables['contacts'] = [{ id: CONTACT_ID, tenant_id: TENANT_ID, sms_opt_in: false }]
    mockFetchSuccess()
    const result = await sendSms('+10000000001', '+10000000002', 'hi', {
      tenantId: TENANT_ID,
      // no contactId
    })
    expect(mockFetch).toHaveBeenCalledTimes(1)
    expect(result.success).toBe(true)
  })
})
