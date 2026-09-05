import { jest, describe, it, expect, beforeEach } from '@jest/globals'
import {
  createStore,
  createMockSupabase,
  type MockStore,
} from '../routes/__test-support__/supabase-mock.js'

let store: MockStore = createStore()

jest.unstable_mockModule('@supabase/supabase-js', () => ({
  createClient: () => createMockSupabase(store),
}))

const { linkReferralSignup } = await import('./referral-signup-link.js')
const { createClient } = await import('@supabase/supabase-js')
let supabase = createClient('https://mock.supabase.co', 'mock-key')

beforeEach(() => {
  store = createStore()
  // Re-create — the mock factory binds to whatever `store` object existed at
  // the moment createClient() was called, so a client built before this reset
  // would keep pointing at the old (now-discarded) store.
  supabase = createClient('https://mock.supabase.co', 'mock-key')
  store.tables['referral_codes'] = [
    { id: 'code-1', tenant_id: 'referring-tenant', code: 'REFCO', status: 'active' },
  ]
  store.tables['referral_signups'] = []
})

describe('linkReferralSignup', () => {
  it('links a pre-existing lead-capture signup by matching email + code', async () => {
    store.tables['referral_signups'] = [
      {
        id: 'signup-1',
        referral_code_id: 'code-1',
        referred_email: 'new@owner.co',
        referred_tenant_id: null,
        status: 'signed_up',
      },
    ]

    await linkReferralSignup(supabase, 'REFCO', 'new@owner.co', 'new-tenant-id')

    expect(store.tables['referral_signups']?.[0]?.['referred_tenant_id']).toBe('new-tenant-id')
  })

  it('creates a fresh signup row when no lead-capture row exists', async () => {
    await linkReferralSignup(supabase, 'REFCO', 'new@owner.co', 'new-tenant-id')

    expect(store.tables['referral_signups']).toHaveLength(1)
    expect(store.tables['referral_signups']?.[0]).toMatchObject({
      referral_code_id: 'code-1',
      referring_tenant_id: 'referring-tenant',
      referred_email: 'new@owner.co',
      referred_tenant_id: 'new-tenant-id',
      status: 'signed_up',
    })
  })

  it('silently no-ops for an unknown code', async () => {
    await linkReferralSignup(supabase, 'NOPE', 'new@owner.co', 'new-tenant-id')
    expect(store.tables['referral_signups']).toHaveLength(0)
  })

  it('silently no-ops for a paused/inactive code', async () => {
    store.tables['referral_codes'] = [
      { id: 'code-1', tenant_id: 'referring-tenant', code: 'REFCO', status: 'paused' },
    ]
    await linkReferralSignup(supabase, 'REFCO', 'new@owner.co', 'new-tenant-id')
    expect(store.tables['referral_signups']).toHaveLength(0)
  })
})
